/**
 * Agent Memory Runtime - 三层记忆系统运行时
 * 为每个 Agent 提供 L1/L2/L3 记忆存取,自动探测关键事件
 * 对应 REQ-7, design.md IAgentRuntime::getMemory/updateMemory
 */

const fs = require('fs');
const path = require('path');
const { L1Memory, L2Memory, L3Memory, KeyEvent, OpponentPattern } = require('../schema/AgentMemory');

// ===== Event Detection Heuristics =====

const EVENT_TYPES = {
  AMBUSHED: 'ambushed',
  TRUSTED_TEAMMATE: 'trusted_teammate',
  OPPONENT_PATTERN: 'opponent_pattern',
  TACTICAL_SUCCESS: 'tactical_success',
  TACTICAL_FAILURE: 'tactical_failure',
  ENEMY_APPROACHING: 'enemy_approaching',
  ESCAPED_DANGER: 'escaped_danger',
};

const OPPONENT_BEHAVIORS = ['aggressive', 'camper', 'hit_and_run', 'passive'];

/**
 * 启发式事件检测: 对比连续两帧感知快照,自动识别关键事件
 * @param {Object} prev - 上一帧感知快照摘要
 * @param {Object} curr - 当前帧感知快照摘要
 * @returns {Array<{ type: string, severity: string, description: string }>}
 */
function detectEvents(prev, curr) {
  const events = [];

  if (!prev || !curr) return events;

  // 1. 伏击检测: 威胁等级突变 (>0.5 跃升)
  if (
    curr.dangerLevel !== undefined &&
    prev.dangerLevel !== undefined &&
    curr.dangerLevel - prev.dangerLevel > 0.5
  ) {
    // 判断是否因为新威胁进入视野
    if (curr.nearbyThreats > prev.nearbyThreats || curr.nearbyThreats > 2) {
      events.push({
        type: EVENT_TYPES.ENEMY_APPROACHING,
        severity: 'high',
        description: `威胁等级从 ${prev.dangerLevel.toFixed(1)} 跃升至 ${curr.dangerLevel.toFixed(1)}`,
      });
    } else {
      events.push({
        type: EVENT_TYPES.AMBUSHED,
        severity: 'critical',
        description: `突然遭袭: 威胁等级 ${prev.dangerLevel.toFixed(1)} -> ${curr.dangerLevel.toFixed(1)}`,
      });
    }
  }

  // 2. 危险解除检测
  if (
    curr.dangerLevel !== undefined &&
    prev.dangerLevel !== undefined &&
    prev.dangerLevel > 0.5 &&
    curr.dangerLevel < 0.3
  ) {
    events.push({
      type: EVENT_TYPES.ESCAPED_DANGER,
      severity: 'normal',
      description: `危险解除: 威胁等级 ${prev.dangerLevel.toFixed(1)} -> ${curr.dangerLevel.toFixed(1)}`,
    });
  }

  return events;
}

// ===== Agent Memory Runtime =====

class AgentMemoryRuntime {
  constructor(config = {}) {
    this.config = {
      l3PersistencePath: config.l3PersistencePath || path.join(process.cwd(), 'data', 'agent_memory_l3'),
      autoSaveIntervalMs: config.autoSaveIntervalMs || 300000, // 5 分钟自动保存 L3
      l2MaxEvents: config.l2MaxEvents || 100,
    };

    // 确保 L3 持久化目录存在
    try { fs.mkdirSync(this.config.l3PersistencePath, { recursive: true }); } catch (_) {}

    // agentId -> { l1: L1Memory, l2: L2Memory, l3: L3Memory }
    this.agents = new Map();

    // 事件检测缓存: agentId -> 上一帧快照摘要
    this._prevSnapshot = new Map();

    // 自动保存定时器
    this._saveTimer = null;
  }

  /**
   * 初始化 Agent 记忆,在 Agent 生成时调用
   * @param {string} agentId
   * @param {number} playerId - 所属玩家 ID
   * @param {Object} l3Preload - L3 预加载数据 (可选)
   * @returns {Object} { l1, l2, l3 }
   */
  initAgent(agentId, playerId, l3Preload = null) {
    const l1 = new L1Memory(60);
    const l2 = new L2Memory();
    const l3 = l3Preload
      ? new L3Memory({ playerId, ...l3Preload })
      : new L3Memory({ playerId });

    this.agents.set(agentId, { l1, l2, l3 });
    return { l1, l2, l3 };
  }

  /**
   * 每 tick 调用: 记录感知快照,自动探测事件
   * @param {string} agentId
   * @param {Object} snapshot - PerceptionSnapshot 或其摘要 { tick, dangerLevel, nearbyThreats, position }
   */
  tick(agentId, snapshot) {
    const mem = this.agents.get(agentId);
    if (!mem) return;

    // L1: 记录快照
    mem.l1.push(snapshot, snapshot.tick || 0);

    // 事件检测
    const prev = this._prevSnapshot.get(agentId);
    const curr = {
      tick: snapshot.tick,
      dangerLevel: snapshot.dangerLevel || snapshot.threatAssessment?.dangerLevel || 0,
      nearbyThreats: snapshot.nearbyThreats || snapshot.threatAssessment?.nearestThreatCount || 0,
      position: snapshot.position || snapshot.viewportCenter || { x: 0, y: 0 },
    };

    const events = detectEvents(prev, curr);
    for (const evt of events) {
      mem.l2.recordEvent({
        tick: curr.tick,
        position: curr.position,
        ...evt,
      });
    }

    this._prevSnapshot.set(agentId, curr);
  }

  /**
   * 记录自定义事件到 L2
   */
  recordEvent(agentId, eventData) {
    const mem = this.agents.get(agentId);
    if (!mem) return null;
    return mem.l2.recordEvent(eventData);
  }

  /**
   * 记录对手模式特征
   */
  updateOpponentPattern(agentId, opponentId, behavior) {
    const mem = this.agents.get(agentId);
    if (!mem) return;
    mem.l2.updateOpponentPattern(opponentId, behavior);
  }

  /**
   * 添加可信队友
   */
  addTrustedTeammate(agentId, teammateId) {
    const mem = this.agents.get(agentId);
    if (!mem) return;
    mem.l2.addTrustedTeammate(teammateId);
  }

  /**
   * 记录玩家指令习惯 (L3)
   */
  recordPlayerCommand(agentId, action) {
    const mem = this.agents.get(agentId);
    if (!mem) return;
    mem.l3.recordCommand(action);
  }

  /**
   * 获取指定层级的记忆 (design.md IAgentRuntime::getMemory)
   */
  getMemory(agentId, level) {
    const mem = this.agents.get(agentId);
    if (!mem) return null;
    return mem[`l${level}`] || null;
  }

  /**
   * 获取 L1 最近 N 帧快照
   */
  getRecentSnapshots(agentId, n = 3) {
    const mem = this.agents.get(agentId);
    if (!mem) return [];
    return mem.l1.getRecent(n).map(e => e.snapshot);
  }

  /**
   * 获取 L2 所有关键事件
   */
  getKeyEvents(agentId) {
    const mem = this.agents.get(agentId);
    if (!mem) return [];
    return mem.l2.keyEvents;
  }

  /**
   * 获取对手模式
   */
  getOpponentPattern(agentId, opponentId) {
    const mem = this.agents.get(agentId);
    if (!mem) return null;
    return mem.l2.getOpponentPattern(opponentId);
  }

  /**
   * 获取可信队友列表
   */
  getTrustedTeammates(agentId) {
    const mem = this.agents.get(agentId);
    if (!mem) return [];
    return mem.l2.trustedTeammates;
  }

  /**
   * 获取玩家指令偏好 (L3)
   */
  getPlayerPreferences(agentId) {
    const mem = this.agents.get(agentId);
    if (!mem) return null;
    return {
      playStyle: mem.l3.playStylePreference,
      favoriteAction: mem.l3.getFavoriteAction(),
      habitProfile: mem.l3.commandHabits,
    };
  }

  /**
   * 清除 Agent 记忆 (Agent 消亡时)
   */
  clearAgent(agentId) {
    this.agents.delete(agentId);
    this._prevSnapshot.delete(agentId);
  }

  // ===== L3 Persistence =====

  /**
   * 保存 L3 到 JSON 文件
   */
  saveL3(agentId, playerId) {
    const mem = this.agents.get(agentId);
    if (!mem) return false;

    const filePath = path.join(this.config.l3PersistencePath, `${playerId}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(mem.l3.toJSON(), null, 2));
      return true;
    } catch (err) {
      console.error('AgentMemory: failed to save L3:', err.message);
      return false;
    }
  }

  /**
   * 从 JSON 文件加载 L3
   */
  loadL3(playerId) {
    const filePath = path.join(this.config.l3PersistencePath, `${playerId}.json`);
    try {
      if (!fs.existsSync(filePath)) return null;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return L3Memory.fromJSON(data);
    } catch (err) {
      console.error('AgentMemory: failed to load L3:', err.message);
      return null;
    }
  }

  /**
   * 启动自动保存定时器
   */
  startAutoSave(intervalMs) {
    const ms = intervalMs || this.config.autoSaveIntervalMs;
    this._saveTimer = setInterval(() => {
      for (const [agentId, mem] of this.agents) {
        this.saveL3(agentId, mem.l3.playerId);
      }
    }, ms);
  }

  /**
   * 停止自动保存
   */
  stopAutoSave() {
    if (this._saveTimer) {
      clearInterval(this._saveTimer);
      this._saveTimer = null;
    }
  }

  /**
   * 获取房间内所有 L3 数据 (用于局末批量持久化)
   */
  dumpAllL3() {
    const result = {};
    for (const [agentId, mem] of this.agents) {
      result[agentId] = {
        playerId: mem.l3.playerId,
        data: mem.l3.toJSON(),
      };
    }
    return result;
  }

  /**
   * 重置 (房间结束时清理)
   */
  reset() {
    this.stopAutoSave();
    this.agents.clear();
    this._prevSnapshot.clear();
  }
}

module.exports = { AgentMemoryRuntime, detectEvents, EVENT_TYPES, OPPONENT_BEHAVIORS };
