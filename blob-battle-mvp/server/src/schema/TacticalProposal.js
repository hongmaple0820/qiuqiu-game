/**
 * Tactical Proposal Schema - Agent 广播的战术提案
 * 同队成员共享 team 广播频道,采用群聊式发布订阅范式
 * 对应 REQ-6
 */

class TacticalProposal {
  /**
   * @param {Object} data
   * @param {string} data.channel - "team:42"
   * @param {string} data.sender - agent_07
   * @param {string} data.proposal - pincer_attack|bait|merge_rally|feed|screen
   * @param {string} data.target_entity_id
   * @param {Object<string,string>} data.roles - { agent_07: "left_flank", agent_12: "right_flank" }
   * @param {number} data.confidence - 0.0 ~ 1.0
   * @param {number} data.tick - 提案生成时的 tick
   */
  constructor(data) {
    this.channel = data.channel;
    this.sender = data.sender;
    this.type = 'tactical_proposal';
    this.proposal = data.proposal;
    this.target_entity_id = data.target_entity_id;
    this.roles = data.roles || {};
    this.confidence = data.confidence;
    this.tick = data.tick;
  }

  /** 获取在当前提案中被分配的角色 */
  getMyRole(agentId) {
    return this.roles[agentId] || null;
  }

  /** 提案是否过期(超过 N ticks 未响应视为过期) */
  isExpired(currentTick, maxAgeTicks = 90) {
    return currentTick - this.tick > maxAgeTicks;
  }

  /** 序列化 */
  toJSON() {
    return {
      channel: this.channel,
      sender: this.sender,
      type: this.type,
      proposal: this.proposal,
      target_entity_id: this.target_entity_id,
      roles: { ...this.roles },
      confidence: this.confidence,
      tick: this.tick,
    };
  }

  /** 反序列化 */
  static fromJSON(json) {
    return new TacticalProposal(json);
  }

  /** 验证 proposal 值 */
  static isValidProposal(proposal) {
    const validProposals = [
      'pincer_attack', 'bait', 'merge_rally', 'feed', 'screen',
    ];
    return validProposals.includes(proposal);
  }

  /** 标准战术原语的角色配置定义 */
  static PRIMITIVE_ROLES = {
    /** 夹击:两个以上成员从不同方向逼近同一目标 */
    pincer_attack: {
      minMembers: 2,
      roles: ['left_flank', 'right_flank', 'support'],
    },
    /** 诱饵:故意暴露较小球吸引敌人,引导入队友包围圈 */
    bait: {
      minMembers: 2,
      roles: ['bait', 'ambusher'],
    },
    /** 合体冲锋:多个分裂体在指定时间点合并增强质量再突击 */
    merge_rally: {
      minMembers: 1,
      roles: ['merger', 'cover'],
    },
    /** 投喂:吐孢子给队友补质量 */
    feed: {
      minMembers: 2,
      roles: ['donor', 'receiver'],
    },
    /** 掩护:用自身质量挡住追兵路径 */
    screen: {
      minMembers: 2,
      roles: ['screener', 'escaper'],
    },
  };
}

module.exports = TacticalProposal;
