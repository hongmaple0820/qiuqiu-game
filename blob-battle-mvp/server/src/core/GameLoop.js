/**
 * 游戏主循环核心
 * 负责：游戏状态管理、物理更新、AI 决策调度、网络同步
 */

const PhysicsEngine = require('../physics/Collider');
const DecisionMaker = require('../ai/DecisionMaker');

class GameLoop {
  constructor(config = {}) {
    this.config = {
      tickRate: config.tickRate || 60,          // 逻辑更新频率 (Hz)
      sendRate: config.sendRate || 10,          // 网络发送频率 (Hz)
      mapWidth: config.mapWidth || 2000,
      mapHeight: config.mapHeight || 2000,
    };
    
    // 游戏状态
    this.entities = [];
    this.players = new Map();  // playerId -> player data
    this.rooms = new Map();    // roomId -> room data
    
    // 组件
    this.physics = new PhysicsEngine({
      mapWidth: this.config.mapWidth,
      mapHeight: this.config.mapHeight,
    });
    
    // 运行时
    this.lastTickTime = 0;
    this.lastSendTime = 0;
    this.isRunning = false;
    this.tickInterval = null;
  }

  /**
   * 创建房间
   */
  createRoom(roomId, options = {}) {
    const room = {
      id: roomId,
      players: [],
      entities: [],
      createdAt: Date.now(),
      status: 'waiting',
      config: {
        maxPlayers: options.maxPlayers || 4,
        gameMode: options.gameMode || 'classic',
      },
    };
    
    this.rooms.set(roomId, room);
    return room;
  }

  /**
   * 玩家加入房间
   */
  joinPlayer(roomId, playerId, playerName) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.players.length >= room.config.maxPlayers) {
      throw new Error('Room is full');
    }
    
    const player = {
      id: playerId,
      name: playerName,
      joinedAt: Date.now(),
      masterEntityId: `master_${playerId}`,
      agentEntityId: `agent_${playerId}`,
    };
    
    room.players.push(player);
    
    // 创建玩家实体（本体 +AI 分身）
    const startX = Math.random() * (this.config.mapWidth - 200) + 100;
    const startY = Math.random() * (this.config.mapHeight - 200) + 100;
    
    // 本体
    const masterEntity = {
      entity_id: player.masterEntityId,
      type: 'master',
      player_id: playerId,
      x: startX,
      y: startY,
      radius: 20,
      vx: 0,
      vy: 0,
      skin_id: 'skin_blue_01',
      name: playerName,
      status: 'normal',
      teamId: playerId,
    };
    
    // AI 分身
    const agentEntity = {
      entity_id: player.agentEntityId,
      type: 'agent',
      player_id: playerId,
      x: startX + 30,
      y: startY + 30,
      radius: 18,
      vx: 0,
      vy: 0,
      skin_id: 'skin_robot_01',
      name: `${playerName}-AI`,
      status: 'follow',
      teamId: playerId,
      isAgent: true,
      personality: 'balanced',
    };
    
    room.entities.push(masterEntity, agentEntity);
    this.players.set(playerId, player);
    
    return { player, masterEntity, agentEntity };
  }

  /**
   * 开始游戏
   */
  startGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.players.length < 1) {
      throw new Error('Not enough players');
    }
    
    room.status = 'playing';
    this.isRunning = true;
    this.lastTickTime = Date.now();
    this.lastSendTime = Date.now();
    
    // 启动游戏循环
    const tickInterval = 1000 / this.config.tickRate;
    this.tickInterval = setInterval(() => this.tick(room), tickInterval);
    
    console.log(`[GameLoop] Room ${roomId} started with ${room.players.length} players`);
    return room;
  }

  /**
   * 游戏_tick（固定时间步长）
   */
  tick(room) {
    const now = Date.now();
    const deltaTime = now - this.lastTickTime;
    this.lastTickTime = now;
    
    // 1. 清理被吞噬的实体
    room.entities = room.entities.filter(e => e.status !== 'eaten');
    
    // 2. 为每个 AI 分身做决策
    room.entities.forEach(entity => {
      if (entity.type === 'agent' && entity.status === 'normal') {
        const player = this.players.get(entity.player_id);
        if (player) {
          const master = room.entities.find(e => e.entity_id === player.masterEntityId);
          if (master) {
            const decisionMaker = new DecisionMaker();
            const command = this._getPendingCommand(entity.player_id);
            
            const decision = decisionMaker.decide(
              entity,
              master,
              room.entities,
              command
            );
            
            // 执行 AI 决策
            this._applyAIDecision(entity, decision);
            
            // 可选：发送 AI 思考过程给客户端
            this._sendAIDecision(entity.player_id, decision);
          }
        }
      }
    });
    
    // 3. 应用玩家输入（移动方向等）
    this._applyPlayerInputs(room);
    
    // 4. 物理更新
    this.physics.update(room.entities, deltaTime);
    
    // 5. 生成食物（简化版）
    if (Math.random() < 0.1) {
      this._spawnFood(room);
    }
    
    // 6. 网络同步（按 sendRate 频率）
    if (now - this.lastSendTime >= 1000 / this.config.sendRate) {
      this._broadcastState(room);
      this.lastSendTime = now;
    }
    
    // 7. 检查游戏结束条件
    this._checkGameOver(room);
  }

  /**
   * 应用 AI 决策到实体
   */
  _applyAIDecision(agent, decision) {
    if (!decision || !decision.actions) return;
    
    decision.actions.forEach(action => {
      switch (action.type) {
        case 'move_to':
          {
            const { x, y } = action.params;
            const dx = x - agent.x;
            const dy = y - agent.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 5) {
              const speed = 8;
              agent.vx = (dx / dist) * speed;
              agent.vy = (dy / dist) * speed;
            }
          }
          break;
        
        case 'split':
          {
            const { direction_angle, count = 1 } = action.params;
            if (agent.radius > 25) {
              const newEntities = this.physics.splitEntity(agent, direction_angle, count);
              // 将新实体添加到房间（需要访问 room，这里简化处理）
              console.log(`[AI] ${agent.name} split into ${newEntities.length} parts`);
            }
          }
          break;
        
        case 'follow':
          {
            // 跟随逻辑已在 DecisionMaker 中计算出目标位置
          }
          break;
      }
    });
  }

  /**
   * 应用玩家输入
   */
  _applyPlayerInputs(room) {
    // 从玩家输入队列中读取并应用
    // 简化版：这里假设玩家输入已经直接修改了实体的 vx/vy
  }

  /**
   * 生成食物
   */
  _spawnFood(room) {
    const food = {
      entity_id: `food_${Date.now()}_${Math.random()}`,
      type: 'food',
      x: Math.random() * this.config.mapWidth,
      y: Math.random() * this.config.mapHeight,
      radius: 5 + Math.random() * 3,
      vx: 0,
      vy: 0,
      status: 'normal',
      foodValue: 2,
    };
    
    room.entities.push(food);
  }

  /**
   * 广播游戏状态
   */
  _broadcastState(room) {
    const state = {
      proto_id: 1001,
      timestamp: Date.now(),
      data: {
        room_id: room.id,
        entities: room.entities.map(e => ({
          entity_id: e.entity_id,
          type: e.type,
          x: e.x,
          y: e.y,
          radius: e.radius,
          vx: e.vx,
          vy: e.vy,
          skin_id: e.skin_id,
          name: e.name,
          status: e.status,
        })),
      },
    };
    
    // 发送给所有连接的客户端
    this._sendToAllPlayers(room, state);
  }

  /**
   * 发送 AI 决策给玩家
   */
  _sendAIDecision(playerId, decision) {
    const message = {
      proto_id: 3001,
      timestamp: Date.now(),
      data: {
        agent_id: `agent_${playerId}`,
        decision_reason: decision.thought,
        chat_response: decision.chat_response,
        actions: decision.actions,
      },
    };
    
    this._sendToPlayer(playerId, message);
  }

  /**
   * 获取待处理指令
   */
  _getPendingCommand(playerId) {
    // 从指令队列中获取（简化版返回 null）
    return null;
  }

  /**
   * 检查游戏结束
   */
  _checkGameOver(room) {
    // 简化版：只剩一个队伍时游戏结束
    const teams = new Set(room.entities.filter(e => e.type === 'master').map(e => e.teamId));
    
    if (teams.size <= 1 && room.players.length > 1) {
      const winner = teams.values().next().value;
      this.endGame(room.id, winner);
    }
  }

  /**
   * 结束游戏
   */
  endGame(roomId, winnerId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    room.status = 'finished';
    this.isRunning = false;
    
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    
    const endMessage = {
      proto_id: 9999,
      timestamp: Date.now(),
      data: {
        event: 'game_over',
        winner_id: winnerId,
      },
    };
    
    this._sendToAllPlayers(room, endMessage);
    console.log(`[GameLoop] Room ${roomId} finished. Winner: ${winnerId}`);
  }

  /**
   * 停止游戏
   */
  stop() {
    this.isRunning = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  // ========== 网络通信占位方法（由 WebSocket 层实现）==========
  
  _sendToAllPlayers(room, message) {
    // 由 WebSocket 服务器实现
    // room.players.forEach(player => {
    //   const ws = this.getPlayerSocket(player.id);
    //   if (ws && ws.readyState === WebSocket.OPEN) {
    //     ws.send(JSON.stringify(message));
    //   }
    // });
  }

  _sendToPlayer(playerId, message) {
    // 由 WebSocket 服务器实现
  }

  getPlayerSocket(playerId) {
    // 由 WebSocket 服务器实现
    return null;
  }
}

module.exports = GameLoop;
