/**
 * RoomManager - 房间与匹配管理器
 * 管理房间创建、快速匹配、机器人填充、房间码系统
 * 对应 REQ-M5 快速开局与房间系统
 */

class RoomManager {
  constructor(config = {}) {
    this.config = {
      maxPlayersPerRoom: config.maxPlayersPerRoom || 8,
      botFillTarget: config.botFillTarget || 8,
      matchmakingTimeout: config.matchmakingTimeout || 3000,
      botFillMin: config.botFillMin || 4,
    };

    this.rooms = new Map();
    this.matchQueue = [];        // 匹配队列: [{ playerId, name, joinedAt }]
    this.roomCodes = new Map();  // code -> roomId
    this.playerRoom = new Map(); // playerId -> roomId
    this._matchTimer = null;
  }

  /**
   * 创建房间并分配唯一 6 位码
   * @returns {{ roomId, roomCode, room }}
   */
  createRoom(roomId, roomConfig = {}) {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId);
    }

    const roomCode = this._generateRoomCode();
    const room = {
      id: roomId,
      code: roomCode,
      config: {
        maxPlayers: roomConfig.maxPlayers || this.config.maxPlayersPerRoom,
        gameMode: roomConfig.gameMode || 'ffa',
        ...roomConfig,
      },
      players: [],
      status: 'waiting', // waiting | playing | finished
      createdAt: Date.now(),
      startedAt: null,
    };

    this.rooms.set(roomId, room);
    this.roomCodes.set(roomCode, roomId);
    return { roomId, roomCode, room };
  }

  /**
   * 加入匹配队列
   * 当队列累积够人数或超时触发，分配玩家到房间
   * @param {string} playerId
   * @param {string} playerName
   * @param {function} onMatched(roomId, players) - 匹配成功回调
   */
  joinMatchmaking(playerId, playerName, onMatched) {
    // 已在匹配中或已在房间中，跳过
    if (this.matchQueue.find(p => p.id === playerId)) return;
    if (this.playerRoom.has(playerId)) return;

    this.matchQueue.push({
      id: playerId,
      name: playerName,
      joinedAt: Date.now(),
    });

    // 如果队列已满或未启动，重置定时器
    this._scheduleMatch(onMatched);
  }

  /**
   * 通过房间码加入
   * @returns {{ roomId, room } | null}
   */
  joinRoomByCode(playerId, playerName, code) {
    const roomId = this.roomCodes.get(code);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'waiting') return null;
    if (room.players.length >= room.config.maxPlayers) return null;

    room.players.push({ id: playerId, name: playerName });
    this.playerRoom.set(playerId, roomId);
    return { roomId, room };
  }

  /**
   * 为房间填充机器人
   * @returns {Array} 新增的 bot 信息
   */
  fillWithBots(roomId, targetCount, botNamePrefix = 'Bot') {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const current = room.players.length;
    const toAdd = Math.max(0, targetCount - current);
    const bots = [];

    for (let i = 0; i < toAdd; i++) {
      const botId = `bot_${roomId}_${Date.now()}_${i}`;
      const botName = `${botNamePrefix}_${this._randomSuffix()}`;
      bots.push({ id: botId, name: botName, isBot: true });
      room.players.push({ id: botId, name: botName, isBot: true });
      this.playerRoom.set(botId, roomId);
    }

    return bots;
  }

  /**
   * 移除玩家 (离开/断连)
   */
  removePlayer(playerId) {
    this.playerRoom.delete(playerId);

    // 从匹配队列移除
    this.matchQueue = this.matchQueue.filter(p => p.id !== playerId);

    // 从房间移除
    for (const room of this.rooms.values()) {
      room.players = room.players.filter(p => p.id !== playerId);
    }
  }

  /**
   * 获取房间信息
   */
  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  /**
   * 获取玩家所在房间 ID
   */
  getPlayerRoom(playerId) {
    return this.playerRoom.get(playerId) || null;
  }

  /**
   * 获取可加入的等待中房间
   */
  getJoinableRooms() {
    const result = [];
    for (const room of this.rooms.values()) {
      if (room.status === 'waiting' && room.players.length < room.config.maxPlayers) {
        result.push({
          roomId: room.id,
          code: room.code,
          players: room.players.length,
          maxPlayers: room.config.maxPlayers,
          mode: room.config.gameMode,
        });
      }
    }
    return result;
  }

  /**
   * 获取匹配状态 (供客户端查询)
   */
  getMatchStatus(playerId) {
    const inQueue = this.matchQueue.find(p => p.id === playerId);
    const inRoom = this.playerRoom.get(playerId);
    return {
      inQueue: !!inQueue,
      queuePosition: inQueue ? this.matchQueue.indexOf(inQueue) + 1 : 0,
      inRoom: !!inRoom,
      roomId: inRoom || null,
    };
  }

  /**
   * 设置房间状态
   */
  setRoomStatus(roomId, status) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.status = status;
      if (status === 'playing' && !room.startedAt) {
        room.startedAt = Date.now();
      }
    }
  }

  /**
   * 清理已结束的房间
   */
  cleanupFinishedRooms() {
    for (const [roomId, room] of this.rooms) {
      if (room.status === 'finished') {
        // 清理玩家引用
        for (const p of room.players) {
          this.playerRoom.delete(p.id);
        }
        // 清理房间码
        this.roomCodes.delete(room.code);
        this.rooms.delete(roomId);
      }
    }
  }

  // ===== Private =====

  /**
   * 调度匹配: 在指定超时后触发
   */
  _scheduleMatch(onMatched) {
    if (this._matchTimer) clearTimeout(this._matchTimer);

    this._matchTimer = setTimeout(() => {
      this._executeMatch(onMatched);
    }, this.config.matchmakingTimeout);
  }

  /**
   * 执行匹配: 将队列中的玩家分入房间
   */
  _executeMatch(onMatched) {
    const queuePlayers = [...this.matchQueue];
    this.matchQueue = [];

    if (queuePlayers.length === 0) return;

    // 分组: 每组最多 maxPlayersPerRoom 人
    const groups = [];
    for (let i = 0; i < queuePlayers.length; i += this.config.maxPlayersPerRoom) {
      groups.push(queuePlayers.slice(i, i + this.config.maxPlayersPerRoom));
    }

    for (const group of groups) {
      const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      const { room, roomCode } = this.createRoom(roomId, {
        maxPlayers: this.config.maxPlayersPerRoom,
        gameMode: 'ffa',
      });

      // 添加人类玩家
      for (const player of group) {
        room.players.push({ id: player.id, name: player.name });
        this.playerRoom.set(player.id, roomId);
      }

      // 填充机器人
      if (room.players.length < this.config.botFillMin) {
        this.fillWithBots(roomId, this.config.botFillMin);
      }

      if (onMatched) {
        onMatched(roomId, room.players);
      }
    }
  }

  /**
   * 生成 6 位随机房间码 (大写字母+数字)
   */
  _generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除混淆字符 0O1I
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.roomCodes.has(code));
    return code;
  }

  /**
   * 随机后缀 (机器人命名)
   */
  _randomSuffix() {
    const adjectives = ['Swift', 'Brave', 'Clever', 'Fierce', 'Calm', 'Bold', 'Wise', 'Quick'];
    const nouns = ['Wolf', 'Eagle', 'Shark', 'Fox', 'Bear', 'Hawk', 'Lynx', 'Puma'];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]}_${nouns[Math.floor(Math.random() * nouns.length)]}`;
  }
}

module.exports = RoomManager;
