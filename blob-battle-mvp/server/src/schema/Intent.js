/**
 * Intent Schema - 结构化指令
 * 三种输入方式(快捷轮盘/点选标记/自然语言)最终汇聚为此格式,统一喂给 Tactical 层
 * 对应 REQ-5
 */

class Intent {
  /**
   * @param {Object} data
   * @param {string} data.intent_id - uuid
   * @param {string} data.issuer - player_id
   * @param {string} data.target_agent - agent_id 或 "team_broadcast"
   * @param {string} data.action - move_to|guard|attack|retreat|bait|merge_rally|feed|hold_position|free_roam
   * @param {Object} data.params
   * @param {{x:number,y:number}} [data.params.target_position]
   * @param {string} [data.params.target_entity_id]
   * @param {number} [data.params.radius]
   * @param {string} data.params.priority - low|normal|high|override
   * @param {number} data.expires_at_tick
   * @param {string} data.natural_language_echo - 人类可理解的意图描述
   */
  constructor(data) {
    this.intent_id = data.intent_id;
    this.issuer = data.issuer;
    this.target_agent = data.target_agent;
    this.action = data.action;
    this.params = {
      target_position: data.params.target_position || null,
      target_entity_id: data.params.target_entity_id || null,
      radius: data.params.radius || 200.0,
      priority: data.params.priority || 'normal',
    };
    this.expires_at_tick = data.expires_at_tick;
    this.natural_language_echo = data.natural_language_echo || '';
  }

  /** 检查指令是否已过期 */
  isExpired(currentTick) {
    return currentTick >= this.expires_at_tick;
  }

  /** 是否应抢占当前行为 */
  isOverride() {
    return this.params.priority === 'override';
  }

  /** 序列化为 JSON (网络传输) */
  toJSON() {
    return {
      intent_id: this.intent_id,
      issuer: this.issuer,
      target_agent: this.target_agent,
      action: this.action,
      params: { ...this.params },
      expires_at_tick: this.expires_at_tick,
      natural_language_echo: this.natural_language_echo,
    };
  }

  /** 从 JSON 反序列化 */
  static fromJSON(json) {
    return new Intent(json);
  }

  /** 验证 action 值是否合法 */
  static isValidAction(action) {
    const validActions = [
      'move_to', 'guard', 'attack', 'retreat',
      'bait', 'merge_rally', 'feed', 'hold_position', 'free_roam',
    ];
    return validActions.includes(action);
  }

  /** 验证 priority 值是否合法 */
  static isValidPriority(priority) {
    return ['low', 'normal', 'high', 'override'].includes(priority);
  }
}

module.exports = Intent;
