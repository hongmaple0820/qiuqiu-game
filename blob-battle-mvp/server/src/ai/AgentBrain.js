/**
 * Agent Brain - 三层决策调度器 (Agent 决策系统核心)
 * 整合 ReflexLayer + TacticalLayer + StrategicLayer(预留) 为统一决策引擎
 * 负责: 每 tick 调度、降级链、Intent 抢占、Agent 生命周期
 * 对应 REQ-2, REQ-3, REQ-14, CP-2
 */

const ReflexLayer = require('./ReflexLayer');
const TacticalLayer = require('./TacticalLayer');
const NoiseInjector = require('./NoiseInjector');
const TeamBroadcastChannel = require('./TeamBroadcastChannel');
const { AgentMemoryRuntime } = require('./AgentMemory');
const ActionValidator = require('../validator/ActionValidator');
const { AtomicAction } = require('../schema/AtomicAction');
const GameConfig = require('../config/GameConfig');

// AgentTier 枚举 (REQ-3)
const AgentTier = Object.freeze({
  FOLLOWER: 0,              // L0: 仅 Reflex,无脑跟随主人
  COMMANDER_DIRECTED: 1,     // L1: 人类指令驱动 + Reflex 基础生存
  TACTICAL_AUTONOMOUS: 2,   // L2: 完整 Reflex + Tactical
  PERSONA: 3,               // L3: 完整三层 + Strategic LLM (后续)
});

class AgentBrain {
  constructor(config = {}) {
    // 子模块
    this.reflexLayer = new ReflexLayer(config.reflex || {});
    this.tacticalLayer = new TacticalLayer(config.tactical || {});
    this.noiseInjector = new NoiseInjector(config.noise || {});
    this.validator = new ActionValidator(config.validator || {});
    this.broadcastChannel = new TeamBroadcastChannel(config.broadcast || {});
    this.memoryRuntime = new AgentMemoryRuntime(config.memory || {});

    // Agent 注册表: agentId -> AgentRuntimeState
    this.agents = new Map();

    // Strategic Layer 配置 (预留,后续 LLM 接入)
    this.strategicConfig = {
      enabled: config.strategic?.enabled || false,
      callIntervalTicks: config.strategic?.callIntervalTicks || 900, // 30s @30Hz
      timeoutMs: config.strategic?.timeoutMs || 3000,
    };

    // 降级记录
    this.degradationLog = [];
  }

  /**
   * 注册新 Agent
   * @param {string} agentId
   * @param {string} playerId - 所属玩家 ID
   * @param {number} tier - AgentTier 级别
   * @param {Object} initialState - { mass, radius, position: {x,y}, teamId }
   */
  registerAgent(agentId, playerId, tier = AgentTier.TACTICAL_AUTONOMOUS, initialState = {}) {
    const state = {
      agentId,
      playerId,
      tier,
      mass: initialState.mass || GameConfig.STARTING_MASS,
      radius: initialState.radius || 0,
      position: initialState.position || { x: 0, y: 0 },
      teamId: initialState.teamId || 'default',
      splitCount: 0,
      isAlive: true,
      eliminatedTick: 0,

      // 决策状态
      currentGoal: null,
      lastTacticalGoal: null,
      pendingIntent: null,

      // Strategic 调用记录
      lastStrategicCallTick: -900,
    };

    this.agents.set(agentId, state);
    this.memoryRuntime.initAgent(agentId, playerId);
  }

  /**
   * 主入口: 每个物理 tick(20~30Hz) 调用
   * 调度顺序: Reflex -> Tactical(心跳节流) -> Noise -> Validate -> Evidence
   * @param {string} agentId
   * @param {import('../schema/PerceptionSnapshot').PerceptionSnapshot} perception
   * @param {import('../schema/Intent')|null} pendingIntent
   * @param {number} tick - 当前 tick
   * @returns {{ action: AtomicAction, evidence: Object|null }}
   */
  processTick(agentId, perception, pendingIntent, tick) {
    const state = this.agents.get(agentId);
    if (!state || !state.isAlive) {
      return { action: null, evidence: null };
    }

    // 更新 Agent 状态 (mass, position 来自 Perception Snap)
    state.position = perception.viewportCenter;
    state.mass = perception.myMass || state.mass;
    state.radius = perception.myRadius || state.radius;

    // 记录感知快照到记忆
    this.memoryRuntime.tick(agentId, {
      tick,
      dangerLevel: perception.threatAssessment.dangerLevel,
      nearbyThreats: perception.visibleEntities.filter(e => e.type === 'enemy' && e.mass > state.mass).length,
      position: state.position,
    });

    // 1. 处理 Intent (抢占/过期)
    this._handleIntent(agentId, pendingIntent, tick);

    // 2. Tactical 决策 (心跳节流, 0.3-1s)
    let tacticalGoal = null;
    const tacResult = this.tacticalLayer.evaluate(
      agentId, perception, state.pendingIntent,
      this.broadcastChannel, state, tick
    );

    if (tacResult.goal) {
      tacticalGoal = tacResult.goal;
      state.lastTacticalGoal = tacticalGoal;
    }

    // 降级: Tactical 失败时用上一个有效目标
    if (!tacticalGoal && state.lastTacticalGoal) {
      tacticalGoal = state.lastTacticalGoal;
      this._logDegradation(agentId, tick, 'tactical', 'last_valid_goal');
    }

    // 3. Reflex 决策 (每 tick 执行, 生存优先)
    let reflexAction = this.reflexLayer.decide(
      agentId, perception,
      tacticalGoal, // 传入 Tactical 目标作为势场方向力
      tick,
      { mass: state.mass, radius: state.radius, splitCount: state.splitCount }
    );

    // 降级: Reflex 失败时 idle
    if (!reflexAction) {
      reflexAction = AtomicAction.idle(agentId, tick);
      this._logDegradation(agentId, tick, 'reflex', 'idle_fallback');
    }

    // 4. 拟人化噪声注入
    const noisyResult = this.noiseInjector.inject(agentId, reflexAction, tick);
    const noisyAction = noisyResult.action;

    // 5. Action Validator 校验
    const validation = this.validator.validate(
      { mass: state.mass, radius: state.radius, splitCount: state.splitCount },
      noisyAction,
      tick
    );

    let finalAction = validation.valid
      ? noisyAction
      : (validation.correctedAction || AtomicAction.idle(agentId, tick));

    // 6. 构建证据记录
    const evidence = {
      agentId,
      tick,
      tier: state.tier,
      reflex: { actionType: reflexAction.action, direction: reflexAction.params?.direction },
      tactical: tacticalGoal ? { type: tacticalGoal.type, score: tacticalGoal.score } : null,
      noise: { delayed: noisyResult.delayed, config: this.noiseInjector.config.difficultyLevel },
      validated: validation.valid,
    };

    return { action: finalAction, evidence };
  }

  /**
   * 处理 Intent 指令 (REQ-5)
   * - override 抢占: 立即覆盖当前目标
   * - 过期处理: expires_at_tick 到达时清除
   */
  _handleIntent(agentId, incomingIntent, tick) {
    const state = this.agents.get(agentId);
    if (!state) return;

    // 如果当前有 pending intent 且已过期
    if (state.pendingIntent && state.pendingIntent.isExpired(tick)) {
      state.pendingIntent = null;
      state.currentGoal = null;
    }

    // 新 Intent 到达
    if (incomingIntent) {
      if (incomingIntent.isOverride()) {
        // override: 立即抢占当前目标
        state.pendingIntent = incomingIntent;
        state.currentGoal = null; // 强制 Tactical 层重新评估
      } else {
        // 非 override: 若无现有 intent 则存储
        if (!state.pendingIntent || state.pendingIntent.isExpired(tick)) {
          state.pendingIntent = incomingIntent;
        }
      }
    }
  }

  /**
   * 向团队广播 Tactical Proposal
   */
  broadcastProposal(agentId, proposal) {
    const state = this.agents.get(agentId);
    if (!state) return;

    const channel = `team:${state.teamId}`;
    proposal.channel = channel;
    proposal.sender = agentId;
    this.broadcastChannel.broadcast(proposal);
  }

  /**
   * 获取团队广播提案
   */
  receiveProposals(agentId) {
    const state = this.agents.get(agentId);
    if (!state) return [];
    const channel = `team:${state.teamId}`;
    return this.broadcastChannel.receive(channel, Date.now() / GameConfig.TICK_DURATION_MS);
  }

  /**
   * Agent 被淘汰 (主人死亡/被吞噬)
   * REQ-14: 主人淘汰时 Agent 立即淘汰
   */
  eliminateAgent(agentId, tick) {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.isAlive = false;
    state.eliminatedTick = tick;
    state.pendingIntent = null;
    state.currentGoal = null;

    // 发送淘汰通知到团队频道
    const msg = new (require('../schema/TacticalProposal'))({
      channel: `team:${state.teamId}`,
      sender: agentId,
      proposal: 'eliminated',
      confidence: 1.0,
      tick,
    });
    this.broadcastChannel.broadcast(msg);

    // 清理记忆并保存 L3
    this.memoryRuntime.saveL3(agentId, state.playerId);
    this.memoryRuntime.clearAgent(agentId);
  }

  /**
   * 检查 Agent 是否存活
   */
  isAlive(agentId) {
    const state = this.agents.get(agentId);
    return state ? state.isAlive : false;
  }

  /**
   * 获取 Agent 运行时状态
   */
  getAgentState(agentId) {
    return this.agents.get(agentId) || null;
  }

  /**
   * 更新 Agent 质量/半径 (物理引擎回调)
   */
  updateAgentPhysics(agentId, mass, radius, splitCount) {
    const state = this.agents.get(agentId);
    if (!state) return;
    state.mass = mass;
    state.radius = radius;
    state.splitCount = splitCount;
  }

  /**
   * 获取当前 Goal (用于客户端展示)
   */
  getCurrentGoal(agentId) {
    const state = this.agents.get(agentId);
    return state ? state.currentGoal || state.lastTacticalGoal : null;
  }

  /**
   * 获取降级日志
   */
  getDegradationLog() {
    return this.degradationLog;
  }

  /**
   * Strategic Layer 占位调用 (REQ-3, 后续 LLM 接入)
   * 返回 Promise<Intent>,需要异步处理
   */
  async callStrategicLayer(agentId, input) {
    const state = this.agents.get(agentId);
    if (!state || state.tier < AgentTier.PERSONA) return null;

    // TODO: 后续 LLM 接入时实现
    // 当前返回 null,降级到 Tactical 自主行为
    return null;
  }

  /**
   * 重置 Agent Brain (房间结束时)
   */
  reset() {
    for (const [agentId, state] of this.agents) {
      this.memoryRuntime.saveL3(agentId, state.playerId);
    }
    this.memoryRuntime.reset();
    this.broadcastChannel.clearAll();
    this.agents.clear();
    this.degradationLog = [];
  }

  // ===== Private =====

  _logDegradation(agentId, tick, from, reason) {
    if (this.degradationLog.length < 200) {
      this.degradationLog.push({ agentId, tick, from, reason });
    }
  }
}

module.exports = { AgentBrain, AgentTier };
