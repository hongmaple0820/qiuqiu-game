/**
 * Atomic Action Schema - 原子动作
 * 经过 ActionValidator 校验后,是进入物理结算的唯一合法输入
 * 对应 REQ-10
 */

/** 原子动作类型 */
const ActionType = Object.freeze({
  MOVE_TO: 'move_to',
  SPLIT: 'split',
  EJECT_MASS: 'eject_mass',
  IDLE: 'idle',
});

/** 动作被拒绝原因 */
const ActionRejected = Object.freeze({
  MoveToNotNormalized: '方向向量未归一化或模长 > 1',
  SplitTooManyParts: '分裂数 >= MAX_SPLIT(16)',
  SplitBelowMinMass: '质量 < MIN_SPLIT_MASS',
  SplitCoolingDown: '分裂冷却未过',
  EjectBelowMinMass: '质量 < MIN_EJECT_MASS',
  ApmLimitExceeded: '每 tick 产生多个动作',
});

class AtomicAction {
  /**
   * @param {Object} data
   * @param {string} data.agent_id
   * @param {number} data.tick
   * @param {string} data.action - move_to|split|eject_mass|idle
   * @param {Object} data.params
   * @param {number} [data.params.dx] - 归一化方向 x (-1~1)
   * @param {number} [data.params.dy] - 归一化方向 y (-1~1)
   * @param {number} [data.params.direction_angle] - 分裂方向(弧度)
   * @param {number} [data.params.mass_amount] - 吐孢子质量
   * @param {boolean} data.noise_applied - 是否已注入拟人化噪声
   * @param {{dx:number,dy:number}} [data.original_direction] - 噪声注入前的原始方向
   * @param {number} [data.delay_ms] - 注入的决策延迟
   */
  constructor(data) {
    this.agent_id = data.agent_id;
    this.tick = data.tick;
    this.action = data.action;
    this.params = {
      dx: data.params.dx || 0,
      dy: data.params.dy || 0,
      direction_angle: data.params.direction_angle || 0,
      mass_amount: data.params.mass_amount || 0,
    };
    this.noise_applied = data.noise_applied || false;
    this.original_direction = data.original_direction || null;
    this.delay_ms = data.delay_ms || 0;
  }

  /** 创建 Idle 动作 */
  static idle(agentId, tick) {
    return new AtomicAction({
      agent_id: agentId,
      tick,
      action: ActionType.IDLE,
      params: {},
    });
  }

  /** 创建移动动作 */
  static moveTo(agentId, tick, dx, dy) {
    return new AtomicAction({
      agent_id: agentId,
      tick,
      action: ActionType.MOVE_TO,
      params: { dx, dy },
    });
  }

  /** 创建分裂动作 */
  static split(agentId, tick, directionAngle) {
    return new AtomicAction({
      agent_id: agentId,
      tick,
      action: ActionType.SPLIT,
      params: { direction_angle: directionAngle },
    });
  }

  /** 创建吐孢子动作 */
  static ejectMass(agentId, tick, massAmount) {
    return new AtomicAction({
      agent_id: agentId,
      tick,
      action: ActionType.EJECT_MASS,
      params: { mass_amount: massAmount },
    });
  }

  /** 序列化 */
  toJSON() {
    return {
      agent_id: this.agent_id,
      tick: this.tick,
      action: this.action,
      params: { ...this.params },
      noise_applied: this.noise_applied,
      original_direction: this.original_direction,
      delay_ms: this.delay_ms,
    };
  }

  /** 反序列化 */
  static fromJSON(json) {
    return new AtomicAction(json);
  }
}

/** 校验结果 */
class ValidationResult {
  /**
   * @param {boolean} valid
   * @param {string} [rejectedReason]
   * @param {AtomicAction} [correctedAction]
   */
  constructor(valid, rejectedReason = null, correctedAction = null) {
    this.valid = valid;
    this.rejectedReason = rejectedReason;
    this.correctedAction = correctedAction;
  }

  static pass() {
    return new ValidationResult(true);
  }

  static reject(reason) {
    return new ValidationResult(false, reason);
  }
}

module.exports = { AtomicAction, ActionType, ActionRejected, ValidationResult };
