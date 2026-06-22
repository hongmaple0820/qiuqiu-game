/**
 * Gateway - 网关层 (消息路由 + Intent 指令协议)
 * 职责: 接收客户端消息,解析 Intent,分发到 AgentBrain,返回确认
 * 对应 REQ-5, design.md IGateway
 */

const Intent = require('../schema/Intent');
const { AtomicAction } = require('../schema/AtomicAction');
const { AgentTier } = require('../ai/AgentBrain');

// proto_id 协议映射
const PROTO = {
  C2S_POSITION: 1001,
  C2S_CHAT: 2001,
  C2S_INTENT: 2002,        // new: 结构化指令
  C2S_SPLIT: 4001,
  C2S_EJECT: 5001,
  S2C_WELCOME: 9001,
  S2C_STATE: 1001,         // 世界状态广播
  S2C_AGENT_STATUS: 3001,  // Agent 状态反馈
  S2C_INTENT_ACK: 2003,    // new: Intent 确认回执
};

class Gateway {
  /**
   * @param {Object} deps - 依赖注入
   * @param {import('../ai/AgentBrain').AgentBrain} deps.agentBrain
   * @param {Map<string, WebSocket>} deps.playerSockets
   * @param {Map<string, string>} deps.playerRooms
   * @param {Function} deps.getRoomGameState - 获取房间状态的方法
   */
  constructor(deps = {}) {
    this.agentBrain = deps.agentBrain;
    this.playerSockets = deps.playerSockets || new Map();
    this.playerRooms = deps.playerRooms || new Map();
    this.getRoomGameState = deps.getRoomGameState || (() => ({}));

    // Intent 计数器 (用于生成唯一 intent_id)
    this._intentSeq = 0;
  }

  /**
   * 主消息入口: 根据 proto_id 路由
   * @param {string} playerId
   * @param {{ proto_id: number, data: Object }} message
   * @param {number} currentTick
   * @returns {{ handled: boolean, ack: Object|null }}
   */
  handleMessage(playerId, message, currentTick) {
    const { proto_id, data: payload } = message;

    switch (proto_id) {
      case PROTO.C2S_INTENT:
        return this._handleIntent(playerId, payload, currentTick);

      case PROTO.C2S_CHAT:
        // 自然语言 -> Intent 转换(后续 LLM 接入,当前做简单关键词解析)
        return this._handleChatAsIntent(playerId, payload, currentTick);

      default:
        return { handled: false, ack: null };
    }
  }

  /**
   * 处理结构化 Intent 协议 (REQ-5)
   * Client -> Server 格式:
   * {
   *   proto_id: 2002,
   *   data: {
   *     intent_id: "uuid",
   *     target_agent: "agent_xxx",
   *     action: "attack" | "guard" | "retreat" | "move_to" | "merge_rally" | "feed" | "bait" | "hold_position" | "free_roam",
   *     params: {
   *       target_position: { x, y },
   *       target_entity_id: "entity_xxx",
   *       priority: "normal" | "high" | "override"
   *     }
   *   }
   * }
   */
  _handleIntent(playerId, payload, currentTick) {
    const intentId = payload.intent_id || this._generateIntentId();

    // 1. 校验 action
    if (!payload.action || !Intent.isValidAction(payload.action)) {
      return {
        handled: true,
        ack: this._buildAck(intentId, false, `Invalid action: ${payload.action}`),
      };
    }

    // 2. 校验 priority
    const priority = payload.params?.priority || 'normal';
    if (!Intent.isValidPriority(priority)) {
      return {
        handled: true,
        ack: this._buildAck(intentId, false, `Invalid priority: ${priority}`),
      };
    }

    // 3. 构建 Intent
    const intent = new Intent({
      intent_id: intentId,
      issuer: playerId,
      target_agent: payload.target_agent || payload.target || 'team_broadcast',
      action: payload.action,
      params: {
        target_position: payload.params?.target_position || null,
        target_entity_id: payload.params?.target_entity_id || null,
        radius: payload.params?.radius || 200.0,
        priority,
      },
      expires_at_tick: currentTick + 300, // 默认 10 秒过期 @30Hz
      natural_language_echo: payload.natural_language_echo || '',
    });

    // 4. 如果是 team_broadcast,转为广播
    if (intent.target_agent === 'team_broadcast') {
      return this._dispatchTeamIntent(playerId, intent, currentTick);
    }

    // 5. 分发到目标 Agent
    return this._dispatchToAgent(playerId, intent, currentTick);
  }

  /**
   * 将自然语言聊天下发为 Intent (简易关键词解析)
   * 后续 LLM 接入时替换此函数
   */
  _handleChatAsIntent(playerId, payload, currentTick) {
    if (!payload.content) return { handled: false, ack: null };

    const text = payload.content.trim().toLowerCase();

    // 关键词 -> Intent 映射 (REQ-5.AC2)
    const intents = [];

    if (text.includes('攻击') || text.includes('进攻') || text.includes('打') || text.includes('attack')) {
      intents.push({ action: 'attack', priority: 'high' });
    }
    if (text.includes('撤退') || text.includes('跑') || text.includes('retreat') || text.includes('flee')) {
      intents.push({ action: 'retreat', priority: 'override' });
    }
    if (text.includes('保护') || text.includes('守') || text.includes('guard') || text.includes('protect')) {
      intents.push({ action: 'guard', priority: 'high' });
    }
    if (text.includes('合体') || text.includes('merge') || text.includes('集合')) {
      intents.push({ action: 'merge_rally', priority: 'high' });
    }
    if (text.includes('喂我') || text.includes('feed')) {
      intents.push({ action: 'feed', priority: 'high' });
    }
    if (text.includes('诱饵') || text.includes('bait')) {
      intents.push({ action: 'bait', priority: 'normal' });
    }

    if (intents.length === 0) return { handled: false, ack: null };

    // 取第一个匹配的意图
    const { action, priority } = intents[0];
    const intent = new Intent({
      intent_id: this._generateIntentId(),
      issuer: playerId,
      target_agent: 'team_broadcast',
      action,
      params: {
        target_position: null,
        target_entity_id: null,
        priority,
      },
      expires_at_tick: currentTick + 300,
      natural_language_echo: payload.content,
    });

    const result = this._dispatchTeamIntent(playerId, intent, currentTick);
    return { handled: true, ack: result.ack };
  }

  /**
   * 分发 Intent 到指定 Agent
   */
  _dispatchToAgent(playerId, intent, currentTick) {
    const agentState = this.agentBrain.getAgentState(intent.target_agent);

    if (!agentState || !agentState.isAlive) {
      return {
        handled: true,
        ack: this._buildAck(intent.intent_id, false, `Agent ${intent.target_agent} not found or eliminated`),
      };
    }

    // 校验: 只有主人能给自己 Agent 发指令
    if (agentState.playerId !== playerId) {
      return {
        handled: true,
        ack: this._buildAck(intent.intent_id, false, `Not authorized to command agent ${intent.target_agent}`),
      };
    }

    // Dispatch 到 AgentBrain (会在下次 processTick 时生效)
    // AgentBrain 的 _handleIntent 会在 processTick 中接收 pendingIntent
    // 这里通过 AgentBrain 的公开方法存储 intent
    this.agentBrain.setPendingIntent(intent.target_agent, intent);

    return {
      handled: true,
      ack: this._buildAck(intent.intent_id, true, `Intent ${intent.action} dispatched to ${intent.target_agent}`),
    };
  }

  /**
   * 分发 Intent 到团队广播频道
   */
  _dispatchTeamIntent(playerId, intent, currentTick) {
    // 找到玩家所在的团队
    const roomId = this.playerRooms.get(playerId);
    // 遍历房间所有 agent,找到同团队的后广播
    let dispatched = 0;

    // 使用 TeamBroadcast 方式: 转换为 TacticalProposal 广播
    const TacticalProposal = require('../schema/TacticalProposal');
    const proposal = new TacticalProposal({
      channel: 'team:all',  // 后续由 broadcastProposal 自动设置
      sender: playerId,
      proposal: intent.action,
      target_entity_id: intent.params.target_entity_id,
      target_position: intent.params.target_position,
      roles: {},  // 所有 agent 都可响应
      confidence: intent.params.priority === 'override' ? 1.0 :
                  intent.params.priority === 'high' ? 0.85 : 0.6,
      tick: currentTick,
    });

    // 通过 AgentBrain 广播到团队频道
    // broadcastProposal 需要遍历所有 agent
    const agentIds = this.agentBrain.getAllAgentIds();
    for (const agentId of agentIds) {
      const state = this.agentBrain.getAgentState(agentId);
      if (!state || state.playerId !== playerId) continue;

      this.agentBrain.broadcastProposal(agentId, proposal);
      dispatched++;
    }

    return {
      handled: true,
      ack: this._buildAck(
        intent.intent_id, true,
        `Team intent "${intent.action}" broadcast to ${dispatched} agents`
      ),
    };
  }

  /**
   * 通过 WebSocket 向玩家发送消息
   */
  sendToPlayer(playerId, message) {
    const socket = this.playerSockets.get(playerId);
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(message));
    }
  }

  /**
   * 向房间内所有玩家广播
   */
  broadcastToRoom(roomId, message) {
    for (const [playerId, sock] of this.playerSockets) {
      if (this.playerRooms.get(playerId) === roomId && sock.readyState === 1) {
        sock.send(JSON.stringify(message));
      }
    }
  }

  // ===== Private =====

  _generateIntentId() {
    return `intent_${Date.now()}_${++this._intentSeq}`;
  }

  _buildAck(intentId, success, message) {
    return {
      proto_id: PROTO.S2C_INTENT_ACK,
      timestamp: Date.now(),
      data: {
        intent_id: intentId,
        success,
        message,
      },
    };
  }
}

// 导出 proto_id 常量供服务器使用
Gateway.PROTO = PROTO;

module.exports = Gateway;
