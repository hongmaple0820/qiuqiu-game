/**
 * LLM Budget Manager - LLM 调用预算控制
 * 限制每个 Agent 和每个房间的 LLM 调用频率
 * 对应 REQ-12.AC3, REQ-12.AC4
 */

const GameConfig = require('../config/GameConfig');

class LLMBudgetManager {
  constructor(config = {}) {
    this.config = {
      budgetPerAgentPerMin: config.budgetPerAgentPerMin || GameConfig.LLM_BUDGET_PER_AGENT_PER_MIN,
      budgetPerRoomPerMin: config.budgetPerRoomPerMin || GameConfig.LLM_BUDGET_PER_ROOM_PER_MIN,
      budgetWindowMs: config.budgetWindowMs || 60000, // 1 分钟滑动窗口
    };

    // agentId -> [{ timestamp, consumed }]
    this.agentBudgets = new Map();

    // roomId -> [{ timestamp, agentId }]
    this.roomBudgets = new Map();
  }

  /**
   * 尝试消费预算
   * @param {string} agentId
   * @param {string} roomId - 可选,房间级别预算检查
   * @returns {boolean} 是否允许调用
   */
  consumeBudget(agentId, roomId = 'default') {
    const now = Date.now();

    // 1. Agent 级别预算检查
    if (!this.agentBudgets.has(agentId)) {
      this.agentBudgets.set(agentId, []);
    }
    const agentCalls = this.agentBudgets.get(agentId);

    // 清理过期记录
    this._cleanup(agentCalls, now);
    this._cleanup(this.roomBudgets.get(roomId) || [], now);

    if (agentCalls.length >= this.config.budgetPerAgentPerMin) {
      return false;
    }

    // 2. 房间级别预算检查
    if (!this.roomBudgets.has(roomId)) {
      this.roomBudgets.set(roomId, []);
    }
    const roomCalls = this.roomBudgets.get(roomId);

    if (roomCalls.length >= this.config.budgetPerRoomPerMin) {
      return false;
    }

    // 消费
    agentCalls.push({ timestamp: now, consumed: 1 });
    roomCalls.push({ timestamp: now, agentId });

    return true;
  }

  /**
   * 查询 Agent 剩余预算
   */
  getAgentRemainingBudget(agentId) {
    const now = Date.now();
    const calls = this.agentBudgets.get(agentId) || [];
    this._cleanup(calls, now);
    return Math.max(0, this.config.budgetPerAgentPerMin - calls.length);
  }

  /**
   * 查询房间剩余预算
   */
  getRoomRemainingBudget(roomId) {
    const now = Date.now();
    const calls = this.roomBudgets.get(roomId) || [];
    this._cleanup(calls, now);
    return Math.max(0, this.config.budgetPerRoomPerMin - calls.length);
  }

  /**
   * 重置指定 Agent 的预算
   */
  resetAgent(agentId) {
    this.agentBudgets.delete(agentId);
  }

  /**
   * 重置指定房间的预算
   */
  resetRoom(roomId) {
    this.roomBudgets.delete(roomId);
  }

  reset() {
    this.agentBudgets.clear();
    this.roomBudgets.clear();
  }

  // ===== Private =====

  _cleanup(calls, now) {
    const cutoff = now - this.config.budgetWindowMs;
    let i = 0;
    while (i < calls.length && calls[i].timestamp < cutoff) {
      i++;
    }
    if (i > 0) calls.splice(0, i);
  }
}

module.exports = LLMBudgetManager;
