/**
 * Team Broadcast Channel - 团队广播频道
 * 同队成员(人类+Agent)通过广播频道协商战术
 * 群聊式发布订阅范式,非强制服从
 * 对应 REQ-6
 */

const TacticalProposal = require('../schema/TacticalProposal');

class TeamBroadcastChannel {
  constructor() {
    /** Map<channelKey, TacticalProposal[]> */
    this.channels = new Map();
  }

  /**
   * 广播战术提案 (REQ-6.AC2)
   * @param {TacticalProposal} proposal
   */
  broadcast(proposal) {
    const key = proposal.channel;
    if (!this.channels.has(key)) {
      this.channels.set(key, []);
    }
    this.channels.get(key).push(proposal);
  }

  /**
   * 获取频道内所有未过期提案 (REQ-6.AC3)
   * @param {string} channel - "team:42"
   * @param {number} currentTick
   * @param {number} maxAgeTicks - 提案最大存活 tick 数
   * @returns {TacticalProposal[]}
   */
  receive(channel, currentTick, maxAgeTicks = 90) {
    const proposals = this.channels.get(channel) || [];
    return proposals.filter(p => !p.isExpired(currentTick, maxAgeTicks));
  }

  /**
   * 获取发给特定 Agent 的提案
   * @param {string} channel
   * @param {string} agentId
   * @param {number} currentTick
   * @returns {TacticalProposal[]}
   */
  receiveForAgent(channel, agentId, currentTick) {
    const proposals = this.receive(channel, currentTick);
    return proposals.filter(p => p.roles[agentId]);
  }

  /**
   * 获取某成员发起的提案
   * @param {string} channel
   * @param {string} senderId
   * @param {number} currentTick
   * @returns {TacticalProposal[]}
   */
  getProposalsBy(channel, senderId, currentTick) {
    const proposals = this.receive(channel, currentTick);
    return proposals.filter(p => p.sender === senderId);
  }

  /**
   * 获取最新的提案(按 tick 排序)
   * @param {string} channel
   * @param {number} currentTick
   * @param {number} limit
   * @returns {TacticalProposal[]}
   */
  getLatest(channel, currentTick, limit = 5) {
    const proposals = this.receive(channel, currentTick);
    return proposals
      .sort((a, b) => b.tick - a.tick)
      .slice(0, limit);
  }

  /**
   * 清理过期提案
   * @param {number} currentTick
   * @param {number} maxAgeTicks
   */
  cleanup(currentTick, maxAgeTicks = 120) {
    for (const [channel, proposals] of this.channels.entries()) {
      this.channels.set(
        channel,
        proposals.filter(p => !p.isExpired(currentTick, maxAgeTicks))
      );
      // 删除空频道
      if (this.channels.get(channel).length === 0) {
        this.channels.delete(channel);
      }
    }
  }

  /** 获取频道统计 */
  getStats(channel, currentTick) {
    const proposals = this.receive(channel, currentTick);
    const senders = new Set(proposals.map(p => p.sender));
    const primitives = {};
    proposals.forEach(p => {
      primitives[p.proposal] = (primitives[p.proposal] || 0) + 1;
    });
    return {
      channel,
      totalProposals: proposals.length,
      uniqueSenders: senders.size,
      byPrimitive: primitives,
    };
  }

  /** 清空频道 */
  clearChannel(channel) {
    this.channels.delete(channel);
  }

  /** 清空所有频道 */
  clearAll() {
    this.channels.clear();
  }
}

module.exports = TeamBroadcastChannel;
