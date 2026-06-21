/**
 * Action Validator - 原子动作校验器
 * 所有动作(Agent 输出 + 人类输入)必须经过此校验器验证后才进入物理结算
 * 防止 LLM 幻觉指令和外部输入篡改
 * 对应 REQ-10, CP-3
 */

const GameConfig = require('../config/GameConfig');
const { AtomicAction, ActionType, ActionRejected, ValidationResult } = require('../schema/AtomicAction');

class ActionValidator {
  constructor(config = {}) {
    this.config = {
      maxSplit: config.maxSplit || GameConfig.MAX_SPLIT,
      minSplitMass: config.minSplitMass || GameConfig.MIN_SPLIT_MASS,
      minEjectMass: config.minEjectMass || GameConfig.MIN_EJECT_MASS,
      mergeCooldownTicks: config.mergeCooldownTicks || GameConfig.MERGE_COOLDOWN_TICKS,
      ejectMassUnit: config.ejectMassUnit || GameConfig.EJECT_MASS_UNIT,
    };

    // APM 追踪: agentId -> { lastActionTick, actionCountThisTick }
    this.apmTracker = new Map();
  }

  /**
   * 验证原子动作 (REQ-10.AC2)
   * @param {Object} agentState - Agent 的当前状态 { entity_id, mass, radius, splitCount, lastSplitTick, ... }
   * @param {AtomicAction} action - 待验证的原子动作
   * @param {number} tick - 当前 tick 序号
   * @returns {ValidationResult}
   */
  validate(agentState, action, tick) {
    // Idle 动作始终合法
    if (action.action === ActionType.IDLE) {
      return ValidationResult.pass();
    }

    // APM 限制: 每个 Agent 每 tick 只能产生一个原子动作 (REQ-10.AC3)
    const apmResult = this._validateApm(agentState.entity_id, tick);
    if (!apmResult.valid) {
      return apmResult;
    }

    switch (action.action) {
      case ActionType.MOVE_TO:
        return this._validateMoveTo(action);
      case ActionType.SPLIT:
        return this._validateSplit(agentState, tick);
      case ActionType.EJECT_MASS:
        return this._validateEjectMass(agentState);
      default:
        return ValidationResult.reject(`未知动作类型: ${action.action}`);
    }
  }

  // ========== MoveTo 校验 ==========

  /**
   * MoveTo 校验 (REQ-10.AC5): 方向向量必须归一化且模长 <= 1
   */
  _validateMoveTo(action) {
    const { dx, dy } = action.params;

    // 瞬移检测: dx/dy 包含异常大值(>100)时直接拒绝 (先于归一化处理)
    if (Math.abs(dx) > 100 || Math.abs(dy) > 100) {
      return ValidationResult.reject(ActionRejected.MoveToNotNormalized);
    }

    const magnitude = Math.sqrt(dx * dx + dy * dy);

    // 模长 <= 1 (允许小于 1 表示减速/惰性)
    if (magnitude > 1.0) {
      // 自动修正: 归一化到单位向量
      const correctedDx = dx / magnitude;
      const correctedDy = dy / magnitude;
      const correctedAction = new AtomicAction({
        agent_id: action.agent_id,
        tick: action.tick,
        action: ActionType.MOVE_TO,
        params: { dx: correctedDx, dy: correctedDy },
        noise_applied: action.noise_applied,
        original_direction: action.original_direction,
        delay_ms: action.delay_ms,
      });
      return new ValidationResult(true, null, correctedAction);
    }

    // 模长为 0: 等效 Idle
    if (magnitude < 0.001) {
      const idleAction = AtomicAction.idle(action.agent_id, action.tick);
      return new ValidationResult(true, null, idleAction);
    }

    return ValidationResult.pass();
  }

  // ========== Split 校验 ==========

  /**
   * Split 校验 (REQ-10.AC6):
   * - 分裂数 < MAX_SPLIT(16)
   * - mass >= MIN_SPLIT_MASS
   * - 冷却已过 (相对于上次分裂的时间)
   */
  _validateSplit(agentState, tick) {
    // 分裂数上限 (REQ-10.AC6)
    const currentSplitCount = agentState.splitCount || 0;
    if (currentSplitCount >= this.config.maxSplit) {
      return ValidationResult.reject(ActionRejected.SplitTooManyParts);
    }

    // 最小分裂质量 (REQ-10.AC6)
    const currentMass = agentState.mass || 0;
    if (currentMass < this.config.minSplitMass) {
      return ValidationResult.reject(ActionRejected.SplitBelowMinMass);
    }

    // 冷却检查 (REQ-10.AC6)
    const lastSplitTick = agentState.lastSplitTick || 0;
    if (tick - lastSplitTick < this.config.mergeCooldownTicks) {
      return ValidationResult.reject(ActionRejected.SplitCoolingDown);
    }

    return ValidationResult.pass();
  }

  // ========== EjectMass 校验 ==========

  /**
   * EjectMass 校验: mass > MIN_EJECT_MASS
   */
  _validateEjectMass(agentState) {
    const currentMass = agentState.mass || 0;
    if (currentMass < this.config.minEjectMass) {
      return ValidationResult.reject(ActionRejected.EjectBelowMinMass);
    }
    return ValidationResult.pass();
  }

  // ========== APM 限制 ==========

  /**
   * APM 限制 (REQ-10.AC3): 每个 Agent 每 tick 最多一个原子动作
   */
  _validateApm(agentId, tick) {
    let tracker = this.apmTracker.get(agentId);

    if (!tracker) {
      tracker = { lastTick: -1, actionCount: 0 };
      this.apmTracker.set(agentId, tracker);
    }

    // 新 tick,重置计数
    if (tracker.lastTick !== tick) {
      tracker.lastTick = tick;
      tracker.actionCount = 0;
    }

    tracker.actionCount++;

    if (tracker.actionCount > 1) {
      return ValidationResult.reject(ActionRejected.ApmLimitExceeded);
    }

    return ValidationResult.pass();
  }

  // ========== 辅助方法 ==========

  /** 清理过期的 APM 追踪数据 */
  cleanupApm(currentTick, maxAgeTicks = 120) {
    for (const [agentId, tracker] of this.apmTracker.entries()) {
      if (currentTick - tracker.lastTick > maxAgeTicks) {
        this.apmTracker.delete(agentId);
      }
    }
  }

  /** 获取 Agent 的 APM 统计 */
  getApmStats(agentId) {
    return this.apmTracker.get(agentId) || null;
  }
}

module.exports = ActionValidator;
