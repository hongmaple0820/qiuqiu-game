/**
 * Decision Evidence - 证据链记录与反作弊基础设施
 * 记录每次关键决策的输入快照+输出动作,用于复盘/调参/反作弊审计
 * 对应 REQ-10.AC4
 */

class DecisionEvidence {
  /**
   * @param {Object} options
   * @param {number} options.maxRecordsPerRoom - 每个房间最大记录数 (防止内存溢出)
   * @param {boolean} options.verbose - 是否记录详细输入快照
   */
  constructor(options = {}) {
    this.maxRecordsPerRoom = options.maxRecordsPerRoom || 10000;
    this.verbose = options.verbose !== undefined ? options.verbose : false;

    /** roomId -> EvidenceRecord[] */
    this.rooms = new Map();
  }

  /**
   * 记录一次关键决策的证据链 (REQ-10.AC4)
   * @param {Object} params
   * @param {string} params.agentId - Agent ID
   * @param {number} params.tick - 当前 tick
   * @param {Object} params.inputSnapshot - 输入快照摘要
   * @param {Object} params.inputSnapshot.threatCount - 视野内威胁数
   * @param {Object} params.inputSnapshot.preyCount - 视野内猎物数
   * @param {Object} params.inputSnapshot.foodCount - 视野内食物数
   * @param {Object} params.inputSnapshot.dangerLevel - 危险等级 0~1
   * @param {Object} params.inputSnapshot.viewportRadius - 视野半径
   * @param {Object} params.inputSnapshot.position - {x, y} Agent 位置
   * @param {Object} params.outputAction - 输出的 AtomicAction
   * @param {string} params.decisionLayer - 决策来源层: reflex|tactical|strategic|fallback
   * @param {string} [params.reason] - 决策原因简述
   * @param {string} [params.roomId] - 房间 ID
   * @param {number} [params.timestamp] - 时间戳(默认 Date.now())
   * @returns {Object} 证据记录
   */
  record({ agentId, tick, inputSnapshot, outputAction, decisionLayer, reason, roomId, timestamp }) {
    const room = roomId || '_global';
    if (!this.rooms.has(room)) {
      this.rooms.set(room, []);
    }

    const records = this.rooms.get(room);
    if (records.length >= this.maxRecordsPerRoom) {
      // 环形覆盖: 删除最旧的记录
      records.shift();
    }

    const evidence = {
      id: `ev_${tick}_${agentId}_${records.length}`,
      agentId,
      tick,
      timestamp: timestamp || Date.now(),
      decisionLayer,
      reason: reason || '',
      input: {
        position: inputSnapshot.position || { x: 0, y: 0 },
        viewportRadius: inputSnapshot.viewportRadius || 0,
        threatCount: inputSnapshot.threatCount || 0,
        preyCount: inputSnapshot.preyCount || 0,
        foodCount: inputSnapshot.foodCount || 0,
        dangerLevel: inputSnapshot.dangerLevel || 0,
        ...(this.verbose ? inputSnapshot : {}),
      },
      output: {
        action: outputAction.action,
        params: { ...outputAction.params },
        noise_applied: outputAction.noise_applied || false,
        delay_ms: outputAction.delay_ms || 0,
      },
    };

    records.push(evidence);
    return evidence;
  }

  /**
   * 批量记录 (用于同房间多个 Agent 的单 tick 批量记录)
   * @param {string} roomId
   * @param {Array<Object>} entries
   */
  recordBatch(roomId, entries) {
    const results = [];
    for (const entry of entries) {
      results.push(this.record({ ...entry, roomId }));
    }
    return results;
  }

  /**
   * 获取指定 Agent 的证据链
   * @param {string} roomId
   * @param {string} agentId
   * @param {number} [sinceTick] - 可选,从某个 tick 开始
   * @returns {Array<Object>}
   */
  getAgentEvidence(roomId, agentId, sinceTick = 0) {
    const records = this.rooms.get(roomId) || [];
    return records.filter(r => r.agentId === agentId && r.tick >= sinceTick);
  }

  /**
   * 获取房间全部证据链
   * @param {string} roomId
   * @param {number} [sinceTick]
   * @param {number} [limit] - 最大返回数
   * @returns {Array<Object>}
   */
  getRoomEvidence(roomId, sinceTick = 0, limit = 1000) {
    const records = this.rooms.get(roomId) || [];
    const filtered = records.filter(r => r.tick >= sinceTick);
    return limit ? filtered.slice(-limit) : filtered;
  }

  /**
   * 导出为可序列化格式 (用于复盘/审计)
   * @param {string} roomId
   * @returns {Object} { roomId, totalRecords, records[] }
   */
  exportRoom(roomId) {
    const records = this.rooms.get(roomId) || [];
    return {
      roomId,
      totalRecords: records.length,
      exportedAt: new Date().toISOString(),
      records: records.map(r => ({
        id: r.id,
        agentId: r.agentId,
        tick: r.tick,
        timestamp: r.timestamp,
        decisionLayer: r.decisionLayer,
        reason: r.reason,
        input: r.input,
        output: r.output,
      })),
    };
  }

  /**
   * 逐条回放 - 按 tick 顺序遍历证据
   * @param {string} roomId
   * @param {Function} callback - (evidence, index) => void
   * @param {number} [sinceTick]
   */
  replay(roomId, callback, sinceTick = 0) {
    const records = this.rooms.get(roomId) || [];
    const filtered = records.filter(r => r.tick >= sinceTick);
    filtered.forEach((record, index) => callback(record, index));
  }

  /**
   * 获取房间证据链统计摘要
   * @param {string} roomId
   * @returns {Object}
   */
  getStats(roomId) {
    const records = this.rooms.get(roomId) || [];
    if (records.length === 0) return { roomId, totalRecords: 0 };

    const agents = new Set();
    const layerCount = {};
    const tickRange = { min: Infinity, max: -Infinity };

    records.forEach(r => {
      agents.add(r.agentId);
      layerCount[r.decisionLayer] = (layerCount[r.decisionLayer] || 0) + 1;
      tickRange.min = Math.min(tickRange.min, r.tick);
      tickRange.max = Math.max(tickRange.max, r.tick);
    });

    return {
      roomId,
      totalRecords: records.length,
      agentCount: agents.size,
      tickRange,
      decisionsByLayer: layerCount,
    };
  }

  /**
   * 清理房间证据链
   * @param {string} roomId
   */
  clearRoom(roomId) {
    this.rooms.delete(roomId);
  }

  /**
   * 清理所有证据链
   */
  clearAll() {
    this.rooms.clear();
  }
}

module.exports = DecisionEvidence;
