/**
 * Blob Battle: Symbiotic Sphere - Server v4
 * 完整新架构入口: PhysicsEngine v2 + AgentBrain(三层决策) + Gateway + InterestManager
 * 同时提供 HTTP 静态文件 (客户端) + WebSocket 游戏协议
 * 对应 REQ-1~14
 *
 * 启动: node server-v4.js
 * HTTP: http://localhost:8084
 * WebSocket: ws://localhost:8084
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { GameLoop } = require('./src/core/GameLoop');
const Gateway = require('./src/gateway/Gateway');
const GameConfig = require('./src/config/GameConfig');

class BlobBattleV4Server {
  constructor(options = {}) {
    this.port = options.port || 8084;
    this.clientDir = options.clientDir || path.join(__dirname, '..', 'client');

    // HTTP + WebSocket 共用服务器
    this.httpServer = http.createServer((req, res) => this._serveStatic(req, res));
    this.wss = new WebSocket.Server({ server: this.httpServer });

    this.playerSockets = new Map();
    this.playerRooms = new Map();
    this.playerNames = new Map();

    this.gameLoop = new GameLoop({
      tickRate: GameConfig.TICK_RATE,
      sendRate: GameConfig.SEND_RATE,
      mapWidth: GameConfig.MAP_WIDTH,
      mapHeight: GameConfig.MAP_HEIGHT,
    });

    this.gateway = new Gateway({
      agentBrain: this.gameLoop.getAgentBrain(),
      playerSockets: this.playerSockets,
      playerRooms: this.playerRooms,
      getRoomGameState: () => ({}),
    });

    this.gameLoop._sendToPlayer = (pid, msg) => this.sendToPlayer(pid, msg);
    this.gameLoop._sendToAllPlayers = (room, msg) => this.broadcastToRoom(room.id, msg);

    this.setupWebSocket();
    this.createDefaultRoom();
    this.startHealthCheck();

    // 启动 HTTP 服务器 (WebSocket 绑定在同一端口)
    this.httpServer.listen(this.port, () => {
      console.log(`[Server v4] HTTP + WebSocket on http://localhost:${this.port}`);
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      console.log(`[Server v4] Player connected: ${playerId}`);

      this.playerSockets.set(playerId, ws);

      // 发送欢迎包
      this.sendToPlayer(playerId, {
        proto_id: 9001,
        timestamp: Date.now(),
        data: {
          message: 'Welcome to Symbiotic Sphere: Human-AI Collaborative Blob Battle',
          player_id: playerId,
          room_id: 'room_default',
          version: '4.0',
        },
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(playerId, data);
        } catch (err) {
          console.error('[Server v4] Parse error:', err.message);
        }
      });

      ws.on('close', () => {
        console.log(`[Server v4] Player disconnected: ${playerId}`);
        this.handlePlayerDisconnect(playerId);
      });

      ws.on('error', (err) => {
        console.error(`[Server v4] Player ${playerId} socket error:`, err.message);
      });
    });
  }

  createDefaultRoom() {
    const room = this.gameLoop.createRoom('room_default', {
      maxPlayers: 10,
      gameMode: 'classic',
    });

    // 添加一些 Bot 用于测试
    this._addBot('room_default', 'Bot_Alpha');
    this._addBot('room_default', 'Bot_Beta');

    // 启动游戏循环
    this.gameLoop.startGame('room_default');

    console.log(`[Server v4] Default room created with ${room.players.length} players`);
  }

  handleMessage(playerId, data) {
    const tick = this.gameLoop.ticker.get();

    // 先尝试 Gateway Intent 协议路由
    const gwResult = this.gateway.handleMessage(playerId, data, tick);
    if (gwResult.handled) {
      if (gwResult.ack) {
        this.sendToPlayer(playerId, gwResult.ack);
      }
      return;
    }

    const { proto_id, data: payload } = data;

    switch (proto_id) {
      case 9001: // 加入房间请求
        this.handleJoinRoom(playerId, payload);
        break;

      case 1001: // 位置更新
        this.handlePositionUpdate(playerId, payload);
        break;

      case 2001: // 聊天指令
        this.handleChatCommand(playerId, payload);
        break;

      case 4001: // 分裂
        this.handleSplit(playerId, payload);
        break;

      case 5001: // 吐孢子
        this.handleEjectMass(playerId, payload);
        break;

      default:
        console.log(`[Server v4] Unknown proto_id: ${proto_id}`);
    }
  }

  handleJoinRoom(playerId, payload) {
    const playerName = payload?.player_name || `Player-${playerId.substr(-4)}`;
    this.playerNames.set(playerId, playerName);

    try {
      const { player, masterEntity, agentEntity } = this.gameLoop.joinPlayer(
        'room_default', playerId, playerName
      );
      this.playerRooms.set(playerId, 'room_default');

      // 发送初始实体信息
      this.sendToPlayer(playerId, {
        proto_id: 9001,
        timestamp: Date.now(),
        data: {
          player_id: playerId,
          master_entity_id: masterEntity.entity_id,
          agent_entity_id: agentEntity.entity_id,
          master: {
            entity_id: masterEntity.entity_id,
            x: masterEntity.x,
            y: masterEntity.y,
            radius: masterEntity.radius,
            mass: masterEntity.mass,
          },
          agent: {
            entity_id: agentEntity.entity_id,
            x: agentEntity.x,
            y: agentEntity.y,
            radius: agentEntity.radius,
            mass: agentEntity.mass,
          },
          room_id: 'room_default',
        },
      });

      console.log(`[Server v4] Player ${playerId} joined room_default`);
    } catch (err) {
      console.error('[Server v4] Join room error:', err.message);
      this.sendToPlayer(playerId, {
        proto_id: 9999,
        data: { error: err.message },
      });
    }
  }

  handlePositionUpdate(playerId, payload) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;

    const entities = this.gameLoop.getRoomEntities(roomId);
    const master = entities.find(
      e => e.type === 'master' && e.player_id === playerId
    );

    if (master && payload.x !== undefined) {
      master.x = payload.x;
      master.y = payload.y;

      // 计算速度方向
      const speed = this._calcSpeed(master.mass || GameConfig.DEFAULT_MASS);
      if (payload.vx !== undefined) {
        master.vx = Math.max(-speed, Math.min(speed, payload.vx));
        master.vy = Math.max(-speed, Math.min(speed, payload.vy));
      }
    }
  }

  handleChatCommand(playerId, payload) {
    // 聊天指令也走 Gateway 关键词解析
    const tick = this.gameLoop.ticker.get();
    const gwResult = this.gateway.handleMessage(playerId, {
      proto_id: 2001,
      data: payload,
    }, tick);

    if (gwResult.ack) {
      this.sendToPlayer(playerId, gwResult.ack);
    }
  }

  handleSplit(playerId, payload) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;

    const entities = this.gameLoop.getRoomEntities(roomId);
    const master = entities.find(
      e => e.type === 'master' && e.player_id === playerId && e.status === 'alive'
    );
    if (!master) return;

    const angle = payload.angle || Math.random() * Math.PI * 2;
    this.gameLoop.physics.splitEntity(master, angle, entities);
  }

  handleEjectMass(playerId, payload) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;

    const entities = this.gameLoop.getRoomEntities(roomId);
    const master = entities.find(
      e => e.type === 'master' && e.player_id === playerId && e.status === 'alive'
    );
    if (!master) return;

    const angle = payload.angle || Math.random() * Math.PI * 2;
    this.gameLoop.physics.ejectMass(master, angle);
  }

  handlePlayerDisconnect(playerId) {
    this.gameLoop.handlePlayerDisconnect(playerId);
    this.playerSockets.delete(playerId);

    // 不清除 playerRooms,允许 30s 内重连
  }

  // ===== Network Helpers =====

  sendToPlayer(playerId, message) {
    const socket = this.playerSockets.get(playerId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  broadcastToRoom(roomId, message) {
    for (const [playerId, socket] of this.playerSockets) {
      if (this.playerRooms.get(playerId) === roomId) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      }
    }
  }

  // ===== Health Check =====

  startHealthCheck() {
    setInterval(() => {
      const room = this.gameLoop.rooms.get('room_default');
      if (!room) return;

      const aliveCount = room.entities.filter(e => e.status === 'alive').length;
      const playerCount = this.playerSockets.size;
      const evidence = this.gameLoop.evidence.getStats('room_default');

      console.log(`[Health] Players: ${playerCount} | Entities: ${aliveCount}/${room.entities.length} | Evidence: ${evidence?.totalRecords || 0} records | Tick: ${this.gameLoop.ticker.get()}`);
    }, 10000); // 每 10 秒
  }

  // ===== Bot Generation =====

  _addBot(roomId, botName) {
    const botId = `bot_${botName}_${Date.now()}`;
    try {
      this.playerNames.set(botId, botName);
      this.playerRooms.set(botId, roomId);
      this.gameLoop.joinPlayer(roomId, botId, botName);
    } catch (_) {
      // Room might be full
    }
  }

  _calcSpeed(mass) {
    const effectiveMass = Math.max(mass, GameConfig.SPEED_MASS_MIN);
    return GameConfig.SPEED_V_MAX * Math.pow(GameConfig.SPEED_MASS_MIN / effectiveMass, GameConfig.SPEED_A);
  }

  // ===== Static File Serving =====

  _serveStatic(req, res) {
    // WebSocket upgrade 请求不处理 (交给 ws 包)
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return;

    let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    filePath = path.join(this.clientDir, filePath);

    // 安全: 防止目录穿越
    if (!filePath.startsWith(this.clientDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not Found');
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  }

  // ===== Shutdown =====

  shutdown() {
    console.log('[Server v4] Shutting down...');
    this.gameLoop.stop();
    this.wss.close();
    this.httpServer.close();
  }
}

// 启动
if (require.main === module) {
  const server = new BlobBattleV4Server({ port: process.env.PORT || 8084 });

  process.on('SIGINT', () => server.shutdown());
  process.on('SIGTERM', () => server.shutdown());
}

module.exports = BlobBattleV4Server;
