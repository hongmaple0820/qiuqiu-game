/**
 * Perception Snapshot Schema - Agent 感知快照
 * 每 tick 为每个 Agent 生成,仅包含 viewport 内的实体
 * viewport 基于 Agent 当前质量缩放,与人类玩家视野一致
 * 对应 REQ-4, design.md PerceptionSnapshot
 */

class Vec2 {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  distanceTo(other) {
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  toJSON() {
    return { x: this.x, y: this.y };
  }

  static fromJSON(json) {
    return new Vec2(json.x, json.y);
  }
}

class VisibleEntity {
  constructor(data) {
    this.entity_id = data.entity_id;
    this.type = data.type; // master|agent|enemy|food|virus|ejected_mass
    this.position = data.position instanceof Vec2 ? data.position : new Vec2(data.position.x, data.position.y);
    this.radius = data.radius;
    this.mass = data.mass;
    this.team_id = data.team_id || null;
    this.is_agent = data.is_agent || false;
    this.owner_id = data.owner_id || null;
    this.vx = data.vx || 0;
    this.vy = data.vy || 0;
  }

  toJSON() {
    return {
      entity_id: this.entity_id,
      type: this.type,
      position: this.position.toJSON(),
      radius: this.radius,
      mass: this.mass,
      team_id: this.team_id,
      is_agent: this.is_agent,
      owner_id: this.owner_id,
      vx: this.vx,
      vy: this.vy,
    };
  }
}

class VisibleFood {
  constructor(data) {
    this.entity_id = data.entity_id;
    this.position = data.position instanceof Vec2 ? data.position : new Vec2(data.position.x, data.position.y);
    this.radius = data.radius;
    this.food_value = data.food_value || 2;
  }

  toJSON() {
    return {
      entity_id: this.entity_id,
      position: this.position.toJSON(),
      radius: this.radius,
      food_value: this.food_value,
    };
  }
}

class VisibleVirus {
  constructor(data) {
    this.entity_id = data.entity_id;
    this.position = data.position instanceof Vec2 ? data.position : new Vec2(data.position.x, data.position.y);
    this.radius = data.radius;
    this.mass = data.mass;
  }

  toJSON() {
    return {
      entity_id: this.entity_id,
      position: this.position.toJSON(),
      radius: this.radius,
      mass: this.mass,
    };
  }
}

class ThreatAssessment {
  constructor(data = {}) {
    this.nearestThreatId = data.nearestThreatId || null;
    this.nearestThreatDistance = data.nearestThreatDistance || Infinity;
    this.nearestThreatMassRatio = data.nearestThreatMassRatio || 1;
    this.dangerLevel = data.dangerLevel || 0; // 0~1
  }
}

class PerceptionSnapshot {
  /**
   * @param {Object} data
   * @param {string} data.agentId
   * @param {number} data.tick
   * @param {Vec2} data.viewportCenter
   * @param {number} data.viewportRadius
   * @param {VisibleEntity[]} data.visibleEntities
   * @param {VisibleFood[]} data.visibleFoods
   * @param {VisibleVirus[]} data.visibleViruses
   * @param {import('./TacticalProposal')[]} [data.nearbyTeamBroadcasts]
   * @param {ThreatAssessment} [data.threatAssessment]
   */
  constructor(data) {
    this.agentId = data.agentId;
    this.tick = data.tick;
    this.viewportCenter = data.viewportCenter instanceof Vec2
      ? data.viewportCenter : new Vec2(data.viewportCenter.x, data.viewportCenter.y);
    this.viewportRadius = data.viewportRadius;
    this.visibleEntities = data.visibleEntities || [];
    this.visibleFoods = data.visibleFoods || [];
    this.visibleViruses = data.visibleViruses || [];
    this.nearbyTeamBroadcasts = data.nearbyTeamBroadcasts || [];
    this.threatAssessment = data.threatAssessment || new ThreatAssessment();
  }

  /** 获取所有敌人(非队友的 agent/master) */
  getEnemies() {
    return this.visibleEntities.filter(e => e.type === 'enemy' || (e.owner_id && e.team_id !== this.agentId));
  }

  /** 获取所有食物 */
  getAllFoods() {
    return this.visibleFoods;
  }

  /** 获取队友实体 */
  getAllies() {
    return this.visibleEntities.filter(e =>
      e.type === 'master' || (e.is_agent && e.team_id === this.agentId)
    );
  }

  /** 检查位置是否在视野内 */
  isInViewport(x, y) {
    const dx = x - this.viewportCenter.x;
    const dy = y - this.viewportCenter.y;
    return Math.sqrt(dx * dx + dy * dy) <= this.viewportRadius;
  }

  toJSON() {
    return {
      agentId: this.agentId,
      tick: this.tick,
      viewportCenter: this.viewportCenter.toJSON(),
      viewportRadius: this.viewportRadius,
      visibleEntities: this.visibleEntities.map(e => e.toJSON()),
      visibleFoods: this.visibleFoods.map(f => f.toJSON()),
      visibleViruses: this.visibleViruses.map(v => v.toJSON()),
      nearbyTeamBroadcasts: this.nearbyTeamBroadcasts.map(p => p.toJSON()),
      threatAssessment: { ...this.threatAssessment },
    };
  }

  static fromJSON(json) {
    return new PerceptionSnapshot({
      agentId: json.agentId,
      tick: json.tick,
      viewportCenter: Vec2.fromJSON(json.viewportCenter),
      viewportRadius: json.viewportRadius,
      visibleEntities: json.visibleEntities.map(e => new VisibleEntity(e)),
      visibleFoods: json.visibleFoods.map(f => new VisibleFood(f)),
      visibleViruses: json.visibleViruses.map(v => new VisibleVirus(v)),
      nearbyTeamBroadcasts: (json.nearbyTeamBroadcasts || []).map(p =>
        require('./TacticalProposal').fromJSON(p)
      ),
      threatAssessment: new ThreatAssessment(json.threatAssessment),
    });
  }
}

module.exports = { PerceptionSnapshot, VisibleEntity, VisibleFood, VisibleVirus, ThreatAssessment, Vec2 };
