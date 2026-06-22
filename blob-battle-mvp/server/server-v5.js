/**
 * Blob Battle: Symbiotic Sphere - Server v5 (Mobile First)
 * 移动端优先服务入口
 * 集成: RoomManager + MobileGameConfig + Gateway + InterestManager + GameLoop
 *
 * 启动: node server-v5.js
 * HTTP: http://localhost:8085
 * WebSocket: ws://localhost:8085
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const { GameLoop } = require('./src/core/GameLoop');
const Gateway = require('./src/gateway/Gateway');
const MobileGameConfig = require('./src/config/MobileGameConfig');
const RoomManager = require('./src/room/RoomManager');

class MobileGameServer {
  constructor(options = {}) {
    this.port = options.port || 8085;
    this.clientDir = options.clientDir || path.join(__dirname, '..', 'client-v2');

    // HTTP + WebSocket 共用
    this.httpServer = http.createServer((req, res) => this._serveStatic(req, res));
    this.wss = new WebSocket.Server({ server: this.httpServer });

    this.playerSockets = new Map();
    this.playerRooms = new Map();
    this.playerNames = new Map();

    // 房间管理器
    this.roomManager = new RoomManager({
      maxPlayersPerRoom: MobileGameConfig.MAX_PLAYERS_PER_ROOM,
      botFillTarget: MobileGameConfig.BOT_FILL_TARGET,
      matchmakingTimeout: MobileGameConfig.MATCHMAKING_TIMEOUT,
      botFillMin: MobileGameConfig.BOT_FILL_MIN,
    });

    // 游戏循环 (使用移动端配置)
    this.gameLoop = new GameLoop({
      tickRate: MobileGameConfig.TICK_RATE,
      sendRate: MobileGameConfig.MOBILE_SEND_RATE,
      mapWidth: MobileGameConfig.MAP_WIDTH,
      mapHeight: MobileGameConfig.MAP_HEIGHT,
    });

    // 网关 (注入 RoomManager)
    this.gateway = new Gateway({
      agentBrain: this.gameLoop.getAgentBrain(),
      playerSockets: this.playerSockets,
      playerRooms: this.playerRooms,
      roomManager: this.roomManager,
      sendToPlayer: (pid, msg) => this.sendToPlayer(pid, msg),
    });

    // GameLoop 网络回调
    this.gameLoop._sendToPlayer = (pid, msg) => this.sendToPlayer(pid, msg);
    this.gameLoop._sendToAllPlayers = (room, msg) => this.broadcastToRoom(room.id, msg);

    this.setupWebSocket();
    this.startHealthCheck();

    this.httpServer.listen(this.port, () => {
      console.log(`[Server v5] Mobile-first server on http://localhost:${this.port}`);
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      this.playerSockets.set(playerId, ws);

      console.log(`[Server v5] Player connected: ${playerId.substr(-8)}`);

      // 发送欢迎包
      this.sendToPlayer(playerId, {
        proto_id: 9001,
        data: {
          message: 'Welcome to Symbiotic Sphere Mobile',
          player_id: playerId,
          version: '5.0-mobile',
        },
      });

      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw);
          this.handleMessage(playerId, data);
        } catch (err) {
          console.error('[Server v5] Parse error:', err.message);
        }
      });

      ws.on('close', () => {
        console.log(`[Server v5] Player disconnected: ${playerId.substr(-8)}`);
        this.handlePlayerDisconnect(playerId);
      });
    });
  }

  handleMessage(playerId, data) {
    const tick = this.gameLoop.ticker.get();

    // 先走 Gateway 移动端协议路由
    const gwResult = this.gateway.handleMessage(playerId, data, tick);
    if (gwResult.handled) {
      if (gwResult.ack) {
        this.sendToPlayer(playerId, gwResult.ack);
      }
      return;
    }

    const { proto_id, data: payload } = data;

    switch (proto_id) {
      case 9001: // 加入房间
        this.handleJoinRoom(playerId, payload);
        break;

      case 1001: // 移动输入
        this.handleMoveInput(playerId, payload);
        break;

      case 2001: // 聊天指令
        this.handleChatCommand(playerId, payload);
        break;

      default:
        // 未识别协议,静默忽略
        break;
    }
  }

  handleJoinRoom(playerId, payload) {
    const playerName = payload.player_name || `Player_${playerId.substr(-4)}`;

    // 从匹配队列/房间码找到应加入的房间
    let roomId = this.roomManager.getPlayerRoom(playerId);

    // 如果没有预分配房间,创建或加入默认房间
    if (!roomId) {
      // 找一个可加入的房间,或创建新的
      const rooms = this.roomManager.getJoinableRooms();
      if (rooms.length > 0) {
        roomId = rooms[0].roomId;
        const room = this.roomManager.getRoom(roomId);
        if (room) {
          room.players.push({ id: playerId, name: playerName });
        }
      }
    }

    if (!roomId) {
      // 创建新房间
      const { roomId: newRoomId } = this.roomManager.createRoom(
        `room_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        { maxPlayers: MobileGameConfig.MAX_PLAYERS_PER_ROOM, gameMode: 'ffa' }
      );
      roomId = newRoomId;
      const room = this.roomManager.getRoom(roomId);
      if (room) {
        room.players.push({ id: playerId, name: playerName });
      }
    }

    this.playerNames.set(playerId, playerName);
    this.playerRooms.set(playerId, roomId);

    // 检查房间是否已在 GameLoop 中
    let room = this.gameLoop.rooms.get(roomId);
    if (!room) {
      room = this.gameLoop.createRoom(roomId, {
        maxPlayers: MobileGameConfig.MAX_PLAYERS_PER_ROOM,
        gameMode: 'ffa',
      });

      // 填充机器人
      const humanCount = this.roomManager.getRoom(roomId)?.players.filter(p => !p.isBot)?.length || 1;
      const botsNeeded = Math.max(0, MobileGameConfig.BOT_FILL_TARGET - humanCount);
      if (botsNeeded > 0) {
        const bots = this.roomManager.fillWithBots(roomId, botsNeeded);
        for (const bot of bots) {
          this.playerNames.set(bot.id, bot.name);
          this.playerRooms.set(bot.id, roomId);
          this.gameLoop.joinPlayer(roomId, bot.id, bot.name);
        }
      }

      this.gameLoop.startGame(roomId);
    }

    // 加入真人玩家
    const { player, masterEntity, agentEntity } = this.gameLoop.joinPlayer(
      roomId, playerId, playerName
    );

    // 标记房间为 playing
    this.roomManager.setRoomStatus(roomId, 'playing');

    // 应用移动端优化
    if (this.gateway.isMobilePlayer(playerId)) {
      const interestMgr = this.gameLoop.interest;
      if (interestMgr && interestMgr.setMobileMode) {
        interestMgr.setMobileMode(playerId, true);
      }
    }

    // 发送初始实体信息
    this.sendToPlayer(playerId, {
      proto_id: 9001,
      data: {
        player_id: playerId,
        room_id: roomId,
        master_entity_id: masterEntity.entity_id,
        agent_entity_id: agentEntity.entity_id,
        master: {
          entity_id: masterEntity.entity_id,
          type: masterEntity.type,
          x: masterEntity.x,
          y: masterEntity.y,
          radius: masterEntity.radius,
          mass: masterEntity.mass,
          name: masterEntity.name,
        },
        agent: {
          entity_id: agentEntity.entity_id,
          type: agentEntity.type,
          x: agentEntity.x,
          y: agentEntity.y,
          radius: agentEntity.radius,
          mass: agentEntity.mass,
          name: agentEntity.name,
          isAgent: true,
        },
        mapWidth: MobileGameConfig.MAP_WIDTH,
        mapHeight: MobileGameConfig.MAP_HEIGHT,
      },
    });

    console.log(`[Server v5] Player ${playerId.substr(-8)} joined room ${roomId}`);
  }

  handleMoveInput(playerId, payload) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;

    const entities = this.gameLoop.getRoomEntities(roomId);
    const master = entities.find(
      e => e.type === 'master' && e.player_id === playerId && e.status === 'alive'
    );
    if (!master) return;

    // 摇杆输入: 直接设置 target (由 GameLoop 转为速度向量)
    // 或 velocity 向量 (由触屏计算)
    if (payload.vx !== undefined && payload.vy !== undefined) {
      // 速度向量模式 (摇杆)
      const maxSpeed = MobileGameConfig.SPEED_V_MAX;
      master.vx = Math.max(-maxSpeed, Math.min(maxSpeed, payload.vx * maxSpeed));
      master.vy = Math.max(-maxSpeed, Math.min(maxSpeed, payload.vy * maxSpeed));
    } else if (payload.x !== undefined && payload.y !== undefined) {
      // 绝对位置模式 (桌面端兼容)
      master.targetX = payload.x;
      master.targetY = payload.y;
    }
  }

  handleChatCommand(playerId, payload) {
    const tick = this.gameLoop.ticker.get();
    const gwResult = this.gateway.handleMessage(playerId, {
      proto_id: 2001,
      data: payload,
    }, tick);

    if (gwResult.ack) {
      this.sendToPlayer(playerId, gwResult.ack);
    }
  }

  handlePlayerDisconnect(playerId) {
    this.gameLoop.handlePlayerDisconnect(playerId);
    this.playerSockets.delete(playerId);

    // 保留 room 分配 30s (允许重连)
    setTimeout(() => {
      if (!this.playerSockets.has(playerId)) {
        this.playerRooms.delete(playerId);
        this.roomManager.removePlayer(playerId);
      }
    }, MobileGameConfig.DISCONNECT_KEEP_ALIVE_SEC * 1000);
  }

  // ===== Network =====

  sendToPlayer(playerId, message) {
    const socket = this.playerSockets.get(playerId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  broadcastToRoom(roomId, message) {
    for (const [pid, sock] of this.playerSockets) {
      if (this.playerRooms.get(pid) === roomId && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify(message));
      }
    }
  }

  // ===== Health Check =====

  startHealthCheck() {
    setInterval(() => {
      const roomCount = this.gameLoop.rooms.size;
      const playerCount = this.playerSockets.size;
      const matchQueue = this.roomManager.matchQueue.length;
      const activeRooms = Array.from(this.gameLoop.rooms.values()).filter(r => r.status === 'playing').length;

      console.log(`[Health] Players: ${playerCount} | Rooms: ${roomCount} (active: ${activeRooms}) | Queue: ${matchQueue} | Tick: ${this.gameLoop.ticker.get()}`);
    }, 15000);
  }

  // ===== Static File Server =====

  _serveStatic(req, res) {
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return;

    let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    filePath = path.join(this.clientDir, filePath);

    if (!filePath.startsWith(this.clientDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    // SPA fallback: 所有不存在的路径回退到 index.html
    if (!fs.existsSync(filePath) && !path.extname(filePath)) {
      filePath = path.join(this.clientDir, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };

    const mime = mimeTypes[ext] || 'application/octet-stream';

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch (err) {
      res.writeHead(404);
      res.end('Not Found');
    }
  }
}

// 启动
if (require.main === module) {
  new MobileGameServer({ port: process.env.PORT || 8085 });
}

module.exports = MobileGameServer;
