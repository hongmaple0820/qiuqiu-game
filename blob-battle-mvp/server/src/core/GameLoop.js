/**
 * Game Loop - 游戏主循环核心 (新架构)
 * Tick 流程: 1.清理吞噬实体 -> 2.AgentBrain 决策 -> 3.应用玩家输入
 *          -> 4.物理更新 -> 5.生成食物/Virus -> 6.网络同步 -> 7.检查淘汰与游戏结束
 * 对应 REQ-1, REQ-10, REQ-11
 */

const PhysicsEngine = require('../physics/PhysicsEngine');
const { AgentBrain, AgentTier } = require('../ai/AgentBrain');
const PerceptionManager = require('./PerceptionManager');
const ActionValidator = require('../validator/ActionValidator');
const DecisionEvidence = require('./DecisionEvidence');
const InterestManager = require('../gateway/InterestManager');
const GameConfig = require('../config/GameConfig');

// Tick 序号跟踪器
class TickCounter {
  constructor() { this.current = 0; }
  next() { return ++this.current; }
  get() { return this.current; }
}

class GameLoop {
  constructor(config = {}) {
    this.config = {
      tickRate: config.tickRate || GameConfig.TICK_RATE,
      sendRate: config.sendRate || GameConfig.SEND_RATE,
      mapWidth: config.mapWidth || GameConfig.MAP_WIDTH,
      mapHeight: config.mapHeight || GameConfig.MAP_HEIGHT,
    };

    this.rooms = new Map();
    this.players = new Map();

    // 主 Tick 计数器
    this.ticker = new TickCounter();

    // 核心组件
    this.physics = new PhysicsEngine({ mapWidth: this.config.mapWidth, mapHeight: this.config.mapHeight });
    this.agentBrain = new AgentBrain();
    this.perception = new PerceptionManager();
    this.validator = new ActionValidator();
    this.evidence = new DecisionEvidence({ verbose: false });
    this.interest = new InterestManager({ cellSize: 400 });

    // 食物和 Virus 生成 tick
    this._lastFoodSpawnTick = 0;
    this._lastVirusSpawnTick = 0;

    this.isRunning = false;
    this.tickInterval = null;
    this.lastSendTime = 0;
  }

  // ===== Room Management (backward compatible) =====

  createRoom(roomId, options = {}) {
    const room = {
      id: roomId,
      players: [],
      entities: [],
      viruses: [],
      pendingAgentActions: new Map(), // agentId -> AtomicAction
      createdAt: Date.now(),
      status: 'waiting',
      config: {
        maxPlayers: options.maxPlayers || 10,
        gameMode: options.gameMode || 'classic',
      },
    };
    this.rooms.set(roomId, room);
    return room;
  }

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

    // 生成实体位置
    const startX = Math.random() * (this.config.mapWidth - 400) + 200;
    const startY = Math.random() * (this.config.mapHeight - 400) + 200;

    // 本体
    const masterEntity = {
      entity_id: player.masterEntityId,
      type: 'master',
      player_id: playerId,
      x: startX, y: startY,
      radius: GameConfig.DEFAULT_RADIUS, mass: GameConfig.DEFAULT_MASS,
      vx: 0, vy: 0,
      skin_id: 'skin_blue_01',
      name: playerName,
      status: 'alive',
      teamId: playerId, // solo 模式每个人独立队伍
      isMaster: true,
    };

    // AI 分身
    const agentEntity = {
      entity_id: player.agentEntityId,
      type: 'agent',
      player_id: playerId,
      x: startX + 30, y: startY + 30,
      radius: 18, mass: GameConfig.DEFAULT_MASS,
      vx: 0, vy: 0,
      skin_id: 'skin_robot_01',
      name: `${playerName}-AI`,
      status: 'alive',
      teamId: playerId,
      isAgent: true,
      personality: 'balanced',
    };

    room.entities.push(masterEntity, agentEntity);
    this.players.set(playerId, player);

    // 注册 Agent 到 AgentBrain
    this.agentBrain.registerAgent(
      player.agentEntityId, playerId, AgentTier.TACTICAL_AUTONOMOUS, {
        mass: GameConfig.DEFAULT_MASS,
        radius: 18,
        position: { x: startX + 30, y: startY + 30 },
        teamId: playerId,
      }
    );

    return { player, masterEntity, agentEntity };
  }

  startGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.players.length < 1) throw new Error('Not enough players');

    room.status = 'playing';
    this.isRunning = true;

    // Initialize food first
    this._spawnInitialFood(room);

    const tickInterval = 1000 / this.config.tickRate;
    this.tickInterval = setInterval(() => this.tick(room), tickInterval);

    // Force first send on next tick
    this.lastSendTime = 0;

    console.log(`[GameLoop] Room ${roomId} started with ${room.players.length} players`);
    return room;
  }

  // ===== Main Tick =====

  tick(room) {
    const tick = this.ticker.next();

    // 0. 检查淘汰 (必须在清理前,因为要找到被吞噬的实体)
    this._checkEliminations(room, tick);

    // 1. 清理被吞噬的实体
    this._cleanEatenEntities(room, tick);

    // 2. AgentBrain 决策 (REQ-10.AC2)
    for (const entity of room.entities) {
      if (entity.isAgent && entity.status === 'alive') {
        this._processAgentTick(entity, room, tick);
      }
    }

    // 3. 应用所有已校验的 Agent 动作
    this._applyAgentActions(room, tick);

    // 4. 应用玩家输入
    this._applyPlayerInputs(room);

    // 5. 物理更新 (PhysicsEngine v2)
    this.physics.update(room.entities, 1000 / this.config.tickRate);

    // 6. 生成食物和 Virus
    this._spawnFoods(room, tick);
    this._spawnViruses(room, tick);

    // 7. 更新 Interests 网格 (for network sync)
    this.interest.updateGrid(room.id, room.entities);

    // 8. 网络同步 (按 sendRate, per-player viewport)
    const now = Date.now();
    if (now - this.lastSendTime >= 1000 / this.config.sendRate) {
      this._broadcastPerPlayer(room);
      this.lastSendTime = now;
    }

    // 9. 检查断连/游戏结束
    this._checkDisconnectedPlayers(room, tick);
    this._checkGameOver(room);
  }

  // ===== Agent Processing =====

  /**
   * 计算速度 (design.md 公式)
   * v = v_max * (mass_min / mass)^a
   */
  _calcSpeed(mass) {
    const effectiveMass = Math.max(mass || GameConfig.DEFAULT_MASS, GameConfig.SPEED_MASS_MIN);
    return GameConfig.SPEED_V_MAX * Math.pow(GameConfig.SPEED_MASS_MIN / effectiveMass, GameConfig.SPEED_A);
  }

  _processAgentTick(entity, room, tick) {
    // 获取感知快照
    const allFoods = room.entities.filter(e => e.type === 'food' && e.status === 'alive');
    const allViruses = room.entities.filter(e => e.type === 'virus' && e.status === 'alive');

    const snapshot = this.perception.buildSnapshot(
      entity,                    // agent entity with x, y, mass, entity_id, teamId
      room.entities,             // all entities (enemies, other agents, masters)
      allFoods,
      allViruses,
      [],                        // team broadcasts (populated separately)
      tick
    );

    if (!snapshot) return;

    // 获取待处理 Intent (通过 AgentBrain 的 pendingIntent)
    const agentState = this.agentBrain.getAgentState(entity.entity_id);
    const pendingIntent = agentState ? agentState.pendingIntent : null;

    // 调用 AgentBrain 决策
    const result = this.agentBrain.processTick(
      entity.entity_id, snapshot, pendingIntent, tick
    );

    if (!result || !result.action) return;

    // ActionValidator 校验
    const validation = this.validator.validate(
      { mass: entity.mass, radius: entity.radius, splitCount: entity.splitCount || 0 },
      result.action, tick
    );

    const finalAction = validation.valid
      ? result.action
      : (validation.correctedAction || null);

    if (finalAction) {
      room.pendingAgentActions.set(entity.entity_id, finalAction);
    }

    // 记录证据链
    if (result.evidence) {
      this.evidence.record({
        agentId: entity.entity_id,
        tick,
        roomId: room.id,
        inputSnapshot: {
          threatCount: snapshot.visibleEntities.filter(
            e => e.type === 'enemy' && entity.mass && e.mass > entity.mass
          ).length,
          preyCount: snapshot.visibleEntities.filter(
            e => e.type === 'enemy' && entity.mass && e.mass <= entity.mass
          ).length,
          foodCount: snapshot.visibleFoods.length,
          dangerLevel: snapshot.threatAssessment.dangerLevel || 0,
        },
        outputAction: finalAction,
        reason: result.evidence.reflex ? `reflex:${result.evidence.reflex.actionType}` : 'tactical',
      });
    }
  }

  _applyAgentActions(room, tick) {
    for (const [agentId, action] of room.pendingAgentActions) {
      const entity = room.entities.find(e => e.entity_id === agentId);
      if (!entity) continue;

      switch (action.action) {
        case 'moveTo':
          if (action.params && action.params.dx !== undefined) {
            const speed = this._calcSpeed(entity.mass);
            entity.vx = action.params.dx * speed;
            entity.vy = action.params.dy * speed;
          }
          break;
        case 'split':
          this.physics.splitEntity(entity, action.params?.direction || Math.random() * Math.PI * 2, room.entities);
          break;
        case 'ejectMass':
          this.physics.ejectMass(entity, action.params?.direction || Math.random() * Math.PI * 2);
          break;
        // idle: no action
      }
    }
    room.pendingAgentActions.clear();
  }

  // ===== Player Input =====

  _applyPlayerInputs(room) {
    // 将玩家目标位置 (targetX/Y, 由 WebSocket 输入设置) 转换为速度向量
    for (const entity of room.entities) {
      if (entity.isMaster && entity.status === 'alive') {
        // 如果有目标位置,计算朝向目标的速度
        if (entity.targetX !== undefined && entity.targetY !== undefined) {
          const dx = entity.targetX - entity.x;
          const dy = entity.targetY - entity.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > 1) {
            const maxSpeed = this._calcSpeed(entity.mass);
            // 距离越近越慢,但不低于最低速度的 20%
            const speedFactor = Math.min(1.0, dist / 100);
            const desiredSpeed = Math.max(maxSpeed * 0.1, maxSpeed * speedFactor);
            entity.vx = (dx / dist) * desiredSpeed;
            entity.vy = (dy / dist) * desiredSpeed;
          } else {
            entity.vx = 0;
            entity.vy = 0;
          }
        }

        // 速度 clamping (安全边界)
        const speed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
        const maxSpeed = this._calcSpeed(entity.mass);
        if (speed > maxSpeed) {
          entity.vx = (entity.vx / speed) * maxSpeed;
          entity.vy = (entity.vy / speed) * maxSpeed;
        }
      }
    }
  }

  // ===== Spawning =====

  _spawnInitialFood(room) {
    for (let i = 0; i < 100; i++) {
      room.entities.push(this._makeFood());
    }
  }

  _spawnFoods(room, tick) {
    if (tick - this._lastFoodSpawnTick < 5) return;
    this._lastFoodSpawnTick = tick;

    // 维持地图上约 200 个食物
    const foodCount = room.entities.filter(e => e.type === 'food').length;
    if (foodCount < 200) {
      const toSpawn = Math.min(10, 200 - foodCount);
      for (let i = 0; i < toSpawn; i++) {
        room.entities.push(this._makeFood());
      }
    }
  }

  _spawnViruses(room, tick) {
    if (tick - this._lastVirusSpawnTick < 200) return;
    this._lastVirusSpawnTick = tick;

    const virusCount = room.entities.filter(e => e.type === 'virus').length;
    if (virusCount < 5) {
      room.entities.push({
        entity_id: `virus_${tick}_${Math.random().toString(36).substr(2, 4)}`,
        type: 'virus',
        x: Math.random() * this.config.mapWidth,
        y: Math.random() * this.config.mapHeight,
        radius: 25,
        mass: 5000,
        vx: 0, vy: 0,
        status: 'alive',
      });
    }
  }

  _makeFood() {
    return {
      entity_id: `food_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'food',
      x: Math.random() * this.config.mapWidth,
      y: Math.random() * this.config.mapHeight,
      radius: 4 + Math.random() * 3,
      mass: 10 + Math.random() * 15,
      vx: 0, vy: 0,
      status: 'alive',
      foodValue: 1,
    };
  }

  // ===== Cleanup & Elimination =====

  _cleanEatenEntities(room, tick) {
    room.entities = room.entities.filter(e => e.status !== 'eaten');
  }

  _checkEliminations(room, tick) {
    for (const entity of room.entities) {
      if (entity.isMaster && entity.status === 'eaten') {
        // 主人被淘汰 -> 淘汰名下 Agent (REQ-14)
        const agentEntity = room.entities.find(
          e => e.isAgent && e.player_id === entity.player_id
        );
        if (agentEntity) {
          agentEntity.status = 'eaten';
          this.agentBrain.eliminateAgent(agentEntity.entity_id, tick);
        }
      }
    }
  }

  // ===== Disconnect Handling (EH-3) =====

  /**
   * 处理玩家断连
   * 保留实体 30 秒,Agent 按最后一次指令自主行动
   */
  handlePlayerDisconnect(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    player.disconnectedAt = Date.now();
    player.connected = false;
    console.log(`[GameLoop] Player ${playerId} disconnected, keeping alive for ${GameConfig.DISCONNECT_KEEP_ALIVE_SEC}s`);
  }

  /**
   * 处理玩家重连
   */
  handlePlayerReconnect(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    player.disconnectedAt = null;
    player.connected = true;
    console.log(`[GameLoop] Player ${playerId} reconnected`);
  }

  /**
   * 检查断连超时玩家 (每个 tick)
   */
  _checkDisconnectedPlayers(room, tick) {
    const now = Date.now();
    const timeoutMs = GameConfig.DISCONNECT_KEEP_ALIVE_SEC * 1000;

    for (const player of room.players) {
      if (!player.disconnectedAt || player.connected) continue;

      if (now - player.disconnectedAt >= timeoutMs) {
        // 超时: 移除玩家实体
        console.log(`[GameLoop] Player ${player.id} timed out after disconnect`);

        // 标记主人的实体为 eaten
        const master = room.entities.find(e => e.entity_id === player.masterEntityId);
        if (master) master.status = 'eaten';

        const agent = room.entities.find(e => e.entity_id === player.agentEntityId);
        if (agent) {
          agent.status = 'eaten';
          this.agentBrain.eliminateAgent(agent.entity_id, tick);
        }

        // 清理
        this.interest.removePlayer(player.id);
        room.players = room.players.filter(p => p.id !== player.id);
      }
    }
  }

  // ===== Network =====

  /**
   * Per-player broadcast with Interest Management (REQ-11)
   * Each player only receives entities within their viewport
   */
  _broadcastPerPlayer(room) {
    const tick = this.ticker.get();

    for (const player of room.players) {
      // Find player's master entity for viewport center
      const master = room.entities.find(e => e.entity_id === player.masterEntityId);
      if (!master || master.status !== 'alive') continue;

      const viewportRadius = this.interest.calcViewportRadius(master.mass || GameConfig.DEFAULT_MASS);
      const currentView = this.interest.getEntitiesInView(
        room.id, player.id,
        { x: master.x, y: master.y, mass: master.mass || GameConfig.DEFAULT_MASS },
        viewportRadius
      );

      const message = this.interest.buildSyncMessage(room.id, player.id, currentView, tick);
      this._sendToPlayer(player.id, message);
    }
  }

  _broadcastState(room) {
    const state = {
      proto_id: 1001,
      timestamp: Date.now(),
      data: {
        room_id: room.id,
        tick: this.ticker.get(),
        entities: room.entities.map(e => ({
          entity_id: e.entity_id,
          type: e.type,
          player_id: e.player_id || '',
          x: e.x,
          y: e.y,
          radius: e.radius,
          mass: e.mass || 0,
          vx: e.vx,
          vy: e.vy,
          skin_id: e.skin_id || '',
          name: e.name || '',
          status: e.status,
          isAgent: e.isAgent || false,
        })),
      },
    };

    this._sendToAllPlayers(room, state);
  }

  // ===== Game State =====

  /**
   * 获取玩家待处理的 Intent (供 Gateway 使用)
   */
  getPendingIntent(playerId) {
    const player = this.players.get(playerId);
    if (!player) return null;
    const state = this.agentBrain.getAgentState(player.agentEntityId);
    return state ? state.pendingIntent : null;
  }

  /**
   * 获取 AgentBrain 实例 (供 Gateway 使用)
   */
  getAgentBrain() {
    return this.agentBrain;
  }

  /**
   * 获取房间实体列表 (供外部查询)
   */
  getRoomEntities(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.entities : [];
  }

  _checkGameOver(room) {
    const aliveMasters = room.entities.filter(
      e => e.isMaster && e.status === 'alive'
    );
    if (aliveMasters.length <= 1 && room.players.length > 1) {
      const winner = aliveMasters[0];
      this.endGame(room.id, winner ? winner.player_id : null);
    }
  }

  endGame(roomId, winnerId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.status = 'finished';
    this.isRunning = false;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    // 保存本局证据链
    const exportData = this.evidence.exportRoom(roomId);
    console.log(`[GameLoop] Room ${roomId} evidence records: ${exportData.length}`);

    const endMessage = {
      proto_id: 9999,
      timestamp: Date.now(),
      data: { event: 'game_over', winner_id: winnerId },
    };
    this._sendToAllPlayers(room, endMessage);
    console.log(`[GameLoop] Room ${roomId} finished. Winner: ${winnerId}`);
  }

  stop() {
    this.isRunning = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.agentBrain.reset();
    this.interest.reset();
  }

  // ===== Network placeholders (implemented by WebSocket server layer) =====
  _sendToAllPlayers(room, message) {}
  _sendToPlayer(playerId, message) {}
  getPlayerSocket(playerId) { return null; }
}

module.exports = { GameLoop, TickCounter };
