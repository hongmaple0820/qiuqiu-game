/**
 * 球球大作战：智械分身 - 增强版服务器
 * 集成物理引擎、AI 决策、房间管理
 */

const WebSocket = require('ws');
const GameLoop = require('./src/core/GameLoop');

class BlobBattleServer {
  constructor(options = {}) {
    this.port = options.port || 8080;
    this.wss = new WebSocket.Server({ port: this.port });
    
    // 游戏管理器
    this.gameLoops = new Map();  // roomId -> GameLoop instance
    this.playerSockets = new Map();  // playerId -> WebSocket
    this.playerRooms = new Map();  // playerId -> roomId
    
    // 默认房间
    this.defaultRoomId = 'room_default';
    
    this.setupWebSocket();
    this.createDefaultRoom();
    
    console.log(`[Server] Blob Battle Server started on ws://localhost:${this.port}`);
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`[Server] Player connected: ${playerId}`);
      
      this.playerSockets.set(playerId, ws);
      
      // 发送欢迎包
      this.sendToPlayer(playerId, {
        proto_id: 9001,
        timestamp: Date.now(),
        data: {
          message: 'Welcome to Blob Battle: AI Avatar',
          player_id: playerId,
          room_id: this.defaultRoomId,
        },
      });
      
      // 玩家加入默认房间
      try {
        this.joinRoom(this.defaultRoomId, playerId, `Player-${playerId.substr(-4)}`);
      } catch (err) {
        console.error('[Server] Join room error:', err.message);
      }
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(playerId, data);
        } catch (err) {
          console.error('[Server] Parse message error:', err.message);
        }
      });
      
      ws.on('close', () => {
        console.log(`[Server] Player disconnected: ${playerId}`);
        this.playerSockets.delete(playerId);
        this.handlePlayerDisconnect(playerId);
      });
      
      ws.on('error', (err) => {
        console.error(`[Server] Player ${playerId} socket error:`, err.message);
      });
    });
  }

  createDefaultRoom() {
    const gameLoop = new GameLoop({
      tickRate: 60,
      sendRate: 10,
      mapWidth: 2000,
      mapHeight: 2000,
    });
    
    gameLoop.createRoom(this.defaultRoomId, { maxPlayers: 10 });
    this.gameLoops.set(this.defaultRoomId, gameLoop);
  }

  joinRoom(roomId, playerId, playerName) {
    let gameLoop = this.gameLoops.get(roomId);
    
    if (!gameLoop) {
      gameLoop = new GameLoop({ tickRate: 60, sendRate: 10 });
      gameLoop.createRoom(roomId, { maxPlayers: 10 });
      this.gameLoops.set(roomId, gameLoop);
    }
    
    const result = gameLoop.joinPlayer(roomId, playerId, playerName);
    this.playerRooms.set(playerId, roomId);
    
    // 绑定 WebSocket 到 GameLoop
    gameLoop.getPlayerSocket = (pid) => this.playerSockets.get(pid);
    gameLoop._sendToAllPlayers = (room, message) => {
      room.players.forEach(p => {
        const socket = this.playerSockets.get(p.id);
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      });
    };
    gameLoop._sendToPlayer = (pid, message) => {
      const socket = this.playerSockets.get(pid);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };
    
    // 如果房间只有这一个玩家，自动开始游戏
    if (room.players.length === 1 && gameLoop.isRunning === false) {
      gameLoop.startGame(roomId);
    }
    
    console.log(`[Server] Player ${playerId} joined room ${roomId}`);
    return result;
  }

  handleMessage(playerId, data) {
    const { proto_id, data: payload } = data;
    
    switch (proto_id) {
      case 1001: // 位置更新
        this.handlePositionUpdate(playerId, payload);
        break;
      
      case 2001: // 聊天/指令
        this.handleChatCommand(playerId, payload);
        break;
      
      case 4001: // 玩家移动输入
        this.handlePlayerInput(playerId, payload);
        break;
      
      default:
        console.log(`[Server] Unknown proto_id: ${proto_id}`);
    }
  }

  handlePositionUpdate(playerId, payload) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;
    
    const gameLoop = this.gameLoops.get(roomId);
    if (!gameLoop) return;
    
    // 更新玩家本体位置（由客户端计算，服务器验证）
    const player = gameLoop.players.get(playerId);
    if (player && payload.entities) {
      payload.entities.forEach(entity => {
        if (entity.entity_id === player.masterEntityId) {
          const master = gameLoop.rooms.get(roomId).entities.find(e => e.entity_id === entity.entity_id);
          if (master) {
            master.x = entity.x;
            master.y = entity.y;
            master.vx = entity.vx;
            master.vy = entity.vy;
          }
        }
      });
    }
  }

  handleChatCommand(playerId, payload) {
    const { content, target_id } = payload;
    console.log(`[Server] Chat from ${playerId}: ${content}`);
    
    // 解析指令意图（简化版）
    const intent = this.parseCommandIntent(content);
    
    // 将指令传递给 GameLoop（由 AI 决策系统处理）
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;
    
    const gameLoop = this.gameLoops.get(roomId);
    if (!gameLoop) return;
    
    // 存储待处理指令（简化实现：直接存储在内存中）
    gameLoop._pendingCommands = gameLoop._pendingCommands || new Map();
    gameLoop._pendingCommands.set(playerId, {
      action: intent.action,
      priority: intent.priority,
      target_pos: intent.target_pos,
      timestamp: Date.now(),
    });
    
    // 回复确认
    this.sendToPlayer(playerId, {
      proto_id: 2002,
      timestamp: Date.now(),
      data: {
        status: 'command_received',
        original_content: content,
        parsed_intent: intent,
      },
    });
  }

  handlePlayerInput(playerId, payload) {
    const { direction, speed, split, eject } = payload;
    
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;
    
    const gameLoop = this.gameLoops.get(roomId);
    if (!gameLoop) return;
    
    const player = gameLoop.players.get(playerId);
    if (!player) return;
    
    const room = gameLoop.rooms.get(roomId);
    const master = room.entities.find(e => e.entity_id === player.masterEntityId);
    
    if (master && direction) {
      // 应用移动方向
      const angle = direction.angle || 0;
      const moveSpeed = speed || 10;
      master.vx = Math.cos(angle) * moveSpeed;
      master.vy = Math.sin(angle) * moveSpeed;
    }
    
    if (split && master) {
      // 分裂操作
      const angle = direction ? direction.angle : Math.atan2(master.vy, master.vx);
      if (master.radius > 25) {
        const newEntities = gameLoop.physics.splitEntity(master, angle, 1);
        // 将新实体添加到房间
        newEntities.forEach(e => room.entities.push(e));
        console.log(`[Server] Player ${playerId} split!`);
      }
    }
  }

  parseCommandIntent(content) {
    const lowerContent = content.toLowerCase();
    
    // 中文指令识别
    if (lowerContent.includes('保护') || lowerContent.includes('保我') || lowerContent.includes('defend')) {
      return { action: 'defend', priority: 'high' };
    }
    if (lowerContent.includes('进攻') || lowerContent.includes('攻击') || lowerContent.includes('attack')) {
      return { action: 'attack', priority: 'normal' };
    }
    if (lowerContent.includes('集合') || lowerContent.includes('过来') || lowerContent.includes('follow')) {
      return { action: 'follow', priority: 'normal' };
    }
    if (lowerContent.includes('逃跑') || lowerContent.includes('快跑') || lowerContent.includes('flee')) {
      return { action: 'flee', priority: 'high' };
    }
    if (lowerContent.includes('分裂') || lowerContent.includes('split')) {
      return { action: 'split', priority: 'normal' };
    }
    if (lowerContent.includes('吃') || lowerContent.includes('采集') || lowerContent.includes('gather')) {
      return { action: 'gather', priority: 'low' };
    }
    
    // 默认：自由模式
    return { action: 'free', priority: 'low' };
  }

  handlePlayerDisconnect(playerId) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;
    
    const gameLoop = this.gameLoops.get(roomId);
    if (!gameLoop) return;
    
    // 从房间移除玩家（简化版：不清除实体）
    const room = gameLoop.rooms.get(roomId);
    if (room) {
      room.players = room.players.filter(p => p.id !== playerId);
    }
    
    this.playerRooms.delete(playerId);
    
    // 如果房间没人了，停止游戏
    if (room && room.players.length === 0) {
      gameLoop.stop();
      console.log(`[Server] Room ${roomId} is empty, stopped.`);
    }
  }

  sendToPlayer(playerId, message) {
    const ws = this.playerSockets.get(playerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcastToRoom(roomId, message) {
    const gameLoop = this.gameLoops.get(roomId);
    if (!gameLoop) return;
    
    const room = gameLoop.rooms.get(roomId);
    if (!room) return;
    
    room.players.forEach(player => {
      this.sendToPlayer(player.id, message);
    });
  }
}

// 启动服务器
const server = new BlobBattleServer({ port: 8080 });

// 优雅退出
process.on('SIGINT', () => {
  console.log('[Server] Shutting down...');
  server.wss.close();
  process.exit(0);
});

module.exports = BlobBattleServer;
