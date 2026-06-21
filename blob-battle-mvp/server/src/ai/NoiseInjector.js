/**
 * Noise Injector - 拟人化噪声注入器
 * 在 Reflex 层输出 AtomicAction 之前注入人类化噪声
 * 使 Agent 行为避免过于机械完美,保证盲测识别率在 40%~70% 区间
 * 对应 REQ-4, REQ-8
 */

const { NoiseConfig, DifficultyLevel } = require('../schema/NoiseConfig');
const { AtomicAction, ActionType } = require('../schema/AtomicAction');
const GameConfig = require('../config/GameConfig');

class NoiseInjector {
  /**
   * @param {NoiseConfig|Object} config
   */
  constructor(config = null) {
    this.config = config || NoiseConfig.normal();

    // APM 追踪: agentId -> { actionsThisSecond: number, lastResetTick: number }
    this.apmTracker = new Map();

    // 延迟队列: agentId -> { readyTick: number, pendingAction: AtomicAction }
    this.delayQueue = new Map();
  }

  /**
   * 向 AtomicAction 注入拟人化噪声 (REQ-4.AC2, REQ-4.AC3)
   * @param {string} agentId
   * @param {AtomicAction} action - 原始动作
   * @param {number} tick
   * @returns {{ action: AtomicAction, delayed: boolean }} 注入噪声后的动作和是否延迟
   */
  inject(agentId, action, tick) {
    // Idle 不注入,直接通过
    if (action.action === ActionType.IDLE) {
      return { action, delayed: false };
    }

    // 1. APM 限制 (REQ-4.AC4)
    if (!this._checkApm(agentId, action, tick)) {
      // APM 超限,替换为 Idle
      return { action: AtomicAction.idle(agentId, tick), delayed: false };
    }

    // 2. 检查延迟队列: 是否有待释放的延迟动作
    const delayed = this.delayQueue.get(agentId);
    if (delayed && tick < delayed.readyTick) {
      // 仍在延迟中,忽略新动作
      return { action: AtomicAction.idle(agentId, tick), delayed: true };
    }
    if (delayed && tick >= delayed.readyTick) {
      // 延迟到期,释放之前排队动作
      this.delayQueue.delete(agentId);
      return { action: delayed.pendingAction, delayed: false };
    }

    // 3. 决策延迟 (REQ-4.AC2): 50~150ms
    const delayMs = this.config.getRandomDelay();
    const delayTicks = Math.ceil(delayMs / (1000 / GameConfig.TICK_RATE));

    if (delayTicks > 0) {
      const readyTick = tick + delayTicks;
      this.delayQueue.set(agentId, {
        readyTick,
        pendingAction: action,
      });
      return { action: AtomicAction.idle(agentId, tick), delayed: true };
    }

    // 4. 路径噪声 (REQ-4.AC3): ±5°~15° 高斯噪声
    return this._applyPathNoise(agentId, action, tick);
  }

  /**
   * 应用路径角度噪声
   */
  _applyPathNoise(agentId, action, tick) {
    if (action.action !== ActionType.MOVE_TO) {
      return { action, delayed: false };
    }

    const noiseDeg = this.config.getRandomPathNoise();
    const noiseRad = noiseDeg * Math.PI / 180;

    // 保存原始方向
    const origDx = action.params.dx;
    const origDy = action.params.dy;

    // 应用旋转噪声: 旋转噪声弧度
    const cosR = Math.cos(noiseRad);
    const sinR = Math.sin(noiseRad);
    const noisyDx = origDx * cosR - origDy * sinR;
    const noisyDy = origDx * sinR + origDy * cosR;

    // 重新归一化
    const mag = Math.sqrt(noisyDx * noisyDx + noisyDy * noisyDy) || 1;
    const normalizedDx = noisyDx / mag;
    const normalizedDy = noisyDy / mag;

    const noisyAction = new AtomicAction({
      agent_id: agentId,
      tick,
      action: ActionType.MOVE_TO,
      params: { dx: normalizedDx, dy: normalizedDy },
      noise_applied: true,
      original_direction: { dx: origDx, dy: origDy },
      delay_ms: 0,
    });

    return { action: noisyAction, delayed: false };
  }

  /**
   * APM 限制检查
   */
  _checkApm(agentId, action, tick) {
    // 非 MOVE_TO 动作不计入 APM (Split/Eject 有单独冷却)
    if (action.action !== ActionType.MOVE_TO) return true;

    const ticksPerSec = GameConfig.TICK_RATE;
    let tracker = this.apmTracker.get(agentId);

    if (!tracker) {
      tracker = { actionCount: 0, lastResetTick: tick };
      this.apmTracker.set(agentId, tracker);
    }

    // 每秒重置
    if (tick - tracker.lastResetTick >= ticksPerSec) {
      tracker.actionCount = 0;
      tracker.lastResetTick = tick;
    }

    tracker.actionCount++;

    return tracker.actionCount <= this.config.apmLimitPerSecond;
  }

  /**
   * 更新噪声配置 (用于动态切换难度)
   * @param {NoiseConfig} newConfig
   */
  setConfig(newConfig) {
    this.config = newConfig;
  }

  /**
   * 切换到排位模式 (噪声最大,强制对齐人类水平 REQ-4.AC5)
   */
  setCompetitiveMode() {
    this.config = NoiseConfig.competitive();
  }

  /**
   * 切换到陪练模式 (噪声较低 REQ-4.AC6)
   */
  setEasyMode() {
    this.config = NoiseConfig.easy();
  }

  /** 清理过期的延迟队列和 APM 追踪 */
  cleanup(currentTick) {
    for (const [agentId, delayed] of this.delayQueue.entries()) {
      if (currentTick - delayed.readyTick > 60) {
        this.delayQueue.delete(agentId);
      }
    }
    for (const [agentId, tracker] of this.apmTracker.entries()) {
      if (currentTick - tracker.lastResetTick > GameConfig.TICK_RATE * 5) {
        this.apmTracker.delete(agentId);
      }
    }
  }
}

module.exports = NoiseInjector;
