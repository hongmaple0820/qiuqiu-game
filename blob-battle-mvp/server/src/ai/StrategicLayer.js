/**
 * Strategic Layer - 战略层 (Agent 决策三层架构最顶层)
 * 异步 LLM 调用,不阻塞物理 tick
 * 对应 REQ-2.AC3, REQ-12
 */

const Intent = require('../schema/Intent');
const GameConfig = require('../config/GameConfig');

class StrategicLayer {
  /**
   * @param {Object} deps - 依赖注入
   * @param {import('./LLMService')} deps.llmService
   * @param {import('./LLMBudgetManager')} deps.budgetManager
   * @param {import('../core/PerceptionManager')} deps.perception
   */
  constructor(deps = {}) {
    this.llmService = deps.llmService || null;
    this.budgetManager = deps.budgetManager || null;
    this.perception = deps.perception || null;

    // 心跳计数器 (每个 Agent 的上次调用 tick)
    this._lastCallTick = new Map();

    // 调用间隔 tick
    this.heartbeatTicks = Math.ceil(
      GameConfig.STRATEGIC_HEARTBEAT_SEC * GameConfig.TICK_RATE
    );

    // 待处理的异步调用
    this._pendingCalls = new Map(); // agentId -> Promise
  }

  /**
   * 检查是否应该触发 Strategic 调用 (心跳节流)
   * @returns {boolean}
   */
  shouldCall(agentId, tick) {
    const lastCall = this._lastCallTick.get(agentId) || -9999;
    return tick - lastCall >= this.heartbeatTicks;
  }

  /**
   * 异步调用 Strategic LLM (不阻塞 tick)
   * 结果自动写入 AgentBrain.pendingIntent
   * @param {string} agentId
   * @param {Object} context - { perception, memory, pendingIntent, tick }
   * @param {import('./AgentBrain').AgentBrain} agentBrain
   * @returns {Promise<Intent|null>}
   */
  async callStrategicLayer(agentId, context, agentBrain) {
    const tick = context.tick || 0;

    // 检查预算
    if (this.budgetManager && !this.budgetManager.consumeBudget(agentId)) {
      console.log(`[Strategic] Budget exceeded for ${agentId}`);
      return null;
    }

    // 检查 LLM 服务是否可用
    if (!this.llmService) {
      console.log(`[Strategic] LLM service not configured, falling back to tactical`);
      return null;
    }

    this._lastCallTick.set(agentId, tick);

    try {
      const intent = await this.llmService.callStrategic(agentId, context);

      if (intent && agentBrain) {
        agentBrain.setPendingIntent(agentId, intent);
      }

      return intent;
    } catch (err) {
      console.error(`[Strategic] LLM call failed for ${agentId}:`, err.message);

      // 降级: 回退到 Tactical 自主行为 (由 AgentBrain processTick 自动处理)
      return null;
    }
  }

  /**
   * 批处理: 同房间多个 Agent 同一心跳周期合并为批量调用
   */
  async batchCallStrategic(roomId, agentContexts, agentBrain) {
    if (!this.llmService) return [];

    try {
      const intents = await this.llmService.batchCallStrategic(roomId, agentContexts);

      // 分发结果到各 Agent
      for (let i = 0; i < agentContexts.length && i < intents.length; i++) {
        const intent = intents[i];
        const agentId = agentContexts[i].agentId;
        if (intent && agentBrain) {
          agentBrain.setPendingIntent(agentId, intent);
        }
      }

      return intents;
    } catch (err) {
      console.error(`[Strategic] Batch call failed:`, err.message);
      return [];
    }
  }
}

module.exports = StrategicLayer;
