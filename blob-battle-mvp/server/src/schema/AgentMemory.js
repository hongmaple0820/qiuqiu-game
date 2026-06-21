/**
 * Agent Memory Schema - 三层记忆系统
 * - L1: 战场短期记忆(数秒,内存,滚动覆盖)
 * - L2: 本局战术记忆(单局,内存+局末快照)
 * - L3: 跨局玩家偏好记忆(持久,PostgreSQL)
 * 对应 REQ-7
 */

const { ThreatAssessment } = require('./PerceptionSnapshot');

/** L1 战场短期记忆 */
class L1Memory {
  /**
   * @param {number} maxAgeTicks - 最大保留 tick 数
   */
  constructor(maxAgeTicks = 60) {
    this.recentPerceptionSnapshots = []; // 最近 N tick 的感知快照摘要
    this.nearbyThreatAssessment = new ThreatAssessment();
    this.maxAgeTicks = maxAgeTicks;
    this._lastCleanupTick = 0;
  }

  /** 添加新快照,自动清理过期数据 */
  push(snapshot, currentTick) {
    this.recentPerceptionSnapshots.push({
      tick: currentTick,
      snapshot,
    });
    this._cleanup(currentTick);
  }

  /** 获取最近 N tick 的快照 */
  getRecent(n = 3) {
    return this.recentPerceptionSnapshots.slice(-n);
  }

  /** 清理过期快照 */
  _cleanup(currentTick) {
    if (currentTick - this._lastCleanupTick < 10) return; // 每 10 tick 清理一次
    this._lastCleanupTick = currentTick;
    const cutoff = currentTick - this.maxAgeTicks;
    this.recentPerceptionSnapshots = this.recentPerceptionSnapshots.filter(
      entry => entry.tick >= cutoff
    );
  }
}

/** L2 本局战术记忆 - 关键事件 */
class KeyEvent {
  constructor(data) {
    this.eventId = data.eventId;
    this.type = data.type; // ambushed|trusted_teammate|opponent_pattern|tactical_success|tactical_failure
    this.tick = data.tick;
    this.position = data.position; // {x, y}
    this.relatedEntityId = data.relatedEntityId;
    this.description = data.description;
    this.severity = data.severity || 'normal'; // low|normal|high|critical
  }
}

class OpponentPattern {
  constructor(data) {
    this.opponentId = data.opponentId;
    this.observedBehaviors = data.observedBehaviors || []; // ['aggressive', 'camper', 'hit_and_run']
    this.encounterCount = data.encounterCount || 0;
    this.lastEncounterTick = data.lastEncounterTick || 0;
  }
}

class L2Memory {
  constructor() {
    this.keyEvents = [];
    this.trustedTeammates = []; // 可信队友 ID 列表
    this.opponentPatternFeatures = []; // OpponentPattern[]
    this.endOfGameSnapshot = null;
  }

  /** 记录关键事件 */
  recordEvent(eventData) {
    const event = new KeyEvent({
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...eventData,
    });
    this.keyEvents.push(event);
    // 限制事件数量,避免内存膨胀
    if (this.keyEvents.length > 100) {
      this.keyEvents = this.keyEvents.slice(-50);
    }
    return event;
  }

  /** 添加可信队友 */
  addTrustedTeammate(teammateId) {
    if (!this.trustedTeammates.includes(teammateId)) {
      this.trustedTeammates.push(teammateId);
    }
  }

  /** 获取对手模式特征 */
  getOpponentPattern(opponentId) {
    return this.opponentPatternFeatures.find(p => p.opponentId === opponentId) || null;
  }

  /** 更新对手模式特征 */
  updateOpponentPattern(opponentId, behavior) {
    let pattern = this.getOpponentPattern(opponentId);
    if (!pattern) {
      pattern = new OpponentPattern({ opponentId });
      this.opponentPatternFeatures.push(pattern);
    }
    pattern.encounterCount++;
    pattern.lastEncounterTick = Date.now();
    if (!pattern.observedBehaviors.includes(behavior)) {
      pattern.observedBehaviors.push(behavior);
    }
  }
}

/** L3 跨局玩家偏好记忆 */
class L3Memory {
  /**
   * @param {Object} data
   * @param {string} data.playerId
   * @param {Object} data.commandHabits
   * @param {string} data.playStylePreference - aggressive|conservative|balanced
   * @param {Array} data.commonTacticalCombinations
   */
  constructor(data = {}) {
    this.playerId = data.playerId || '';
    this.commandHabits = data.commandHabits || {
      favoriteActions: {}, // { "attack": 15, "guard": 8, ... }
      totalCommands: 0,
    };
    this.playStylePreference = data.playStylePreference || 'balanced';
    this.commonTacticalCombinations = data.commonTacticalCombinations || [];
    this.updatedAt = data.updatedAt || new Date();
  }

  /** 记录一次指令习惯 */
  recordCommand(action) {
    this.commandHabits.favoriteActions[action] =
      (this.commandHabits.favoriteActions[action] || 0) + 1;
    this.commandHabits.totalCommands++;
    this.updatedAt = new Date();
  }

  /** 获取最常用的指令 */
  getFavoriteAction() {
    if (this.commandHabits.totalCommands === 0) return null;
    let maxCount = 0;
    let favorite = null;
    for (const [action, count] of Object.entries(this.commandHabits.favoriteActions)) {
      if (count > maxCount) {
        maxCount = count;
        favorite = action;
      }
    }
    return favorite;
  }

  /** 序列化 */
  toJSON() {
    return {
      playerId: this.playerId,
      commandHabits: { ...this.commandHabits },
      playStylePreference: this.playStylePreference,
      commonTacticalCombinations: [...this.commonTacticalCombinations],
      updatedAt: this.updatedAt instanceof Date
        ? this.updatedAt.toISOString()
        : this.updatedAt,
    };
  }

  /** 反序列化 */
  static fromJSON(json) {
    return new L3Memory({
      ...json,
      updatedAt: json.updatedAt ? new Date(json.updatedAt) : new Date(),
    });
  }
}

module.exports = { L1Memory, L2Memory, L3Memory, KeyEvent, OpponentPattern };
