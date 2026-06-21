/**
 * Perception Manager - 感知快照系统
 * 为每个 Agent 生成 viewport 限制的感知快照
 * viewport 基于 Agent 当前质量缩放,与同等质量人类玩家视野一致
 * 对应 REQ-4.AC1, design.md PerceptionSnapshot
 */

const GameConfig = require('../config/GameConfig');
const {
  PerceptionSnapshot,
  VisibleEntity,
  VisibleFood,
  VisibleVirus,
  ThreatAssessment,
  Vec2,
} = require('../schema/PerceptionSnapshot');

class PerceptionManager {
  constructor(config = {}) {
    this.config = {
      // 视野缩放因子: viewportRadius = massToRadius(mass) * viewportMultiplier
      viewportMultiplier: config.viewportMultiplier || 8,
      // 缓冲扩展比例 (viewport外额外的感知缓冲)
      bufferRatio: config.bufferRatio || 1.2,
      // 质量-半径转换 K
      massRadiusK: config.massRadiusK || GameConfig.MASS_RADIUS_K,
    };
  }

  /**
   * 为 Agent 生成感知快照 (REQ-4.AC1)
   * @param {Object} agent - Agent 实体对象 { entity_id, x, y, mass, radius, teamId }
   * @param {Array} allEntities - 房间内所有实体
   * @param {Array} allFoods - 所有食物
   * @param {Array} allViruses - 所有刺球
   * @param {Array} teamBroadcasts - team 广播频道中的提案
   * @param {number} tick - 当前 tick
   * @returns {PerceptionSnapshot}
   */
  buildSnapshot(agent, allEntities, allFoods, allViruses, teamBroadcasts = [], tick = 0) {
    const agentPos = new Vec2(agent.x, agent.y);

    // 计算 viewport 半径: 基于质量的 viewportRadius = massToRadius(mass) * multiplier
    const agentMass = agent.mass || GameConfig.DEFAULT_MASS;
    const baseRadius = GameConfig.MASS_RADIUS_K * Math.sqrt(agentMass / Math.PI);
    const viewportRadius = baseRadius * this.config.viewportMultiplier;

    // 过滤视野内实体
    const visibleEntities = [];
    const visibleFoods = [];
    const visibleViruses = [];
    const threatAssessment = new ThreatAssessment();

    let nearestThreatDist = Infinity;

    // 处理实体 (玩家/Agent/敌人)
    for (const entity of allEntities) {
      if (entity.entity_id === agent.entity_id) continue;
      if (entity.status === 'eaten' || entity.status === 'eliminated') continue;

      const dist = this._distance(agentPos, entity);
      if (dist > viewportRadius * this.config.bufferRatio) continue;

      const entityMass = this._getMass(entity);
      const massRatio = entityMass > 0 ? agentMass / entityMass : 99;

      const visible = new VisibleEntity({
        entity_id: entity.entity_id,
        type: this._classifyEntity(entity, agent),
        position: new Vec2(entity.x, entity.y),
        radius: entity.radius || GameConfig.DEFAULT_RADIUS,
        mass: entityMass,
        team_id: entity.teamId || null,
        is_agent: entity.isAgent || false,
        owner_id: entity.player_id || null,
        vx: entity.vx || 0,
        vy: entity.vy || 0,
      });
      visibleEntities.push(visible);

      // 威胁评估
      if (!entity.teamId || entity.teamId !== agent.teamId) {
        if (entityMass > agentMass * 1.25 && dist < nearestThreatDist) {
          nearestThreatDist = dist;
          threatAssessment.nearestThreatId = entity.entity_id;
          threatAssessment.nearestThreatDistance = dist;
          threatAssessment.nearestThreatMassRatio = entityMass / agentMass;
        }
      }
    }

    // 计算危险等级
    if (threatAssessment.nearestThreatId) {
      const threatFactor = 1 / Math.max(threatAssessment.nearestThreatDistance / 100, 0.01);
      const sizeFactor = Math.min(threatAssessment.nearestThreatMassRatio / 2, 1);
      threatAssessment.dangerLevel = Math.min(threatFactor * sizeFactor, 1);
    }

    // 处理食物
    for (const food of allFoods) {
      if (food.status === 'eaten') continue;
      const dist = this._distance(agentPos, food);
      if (dist > viewportRadius * this.config.bufferRatio) continue;

      visibleFoods.push(new VisibleFood({
        entity_id: food.entity_id,
        position: new Vec2(food.x, food.y),
        radius: food.radius || 5,
        food_value: food.foodValue || 2,
      }));
    }

    // 处理刺球
    for (const virus of allViruses) {
      if (virus.status === 'eaten' || virus.status === 'eliminated') continue;
      const dist = this._distance(agentPos, virus);
      if (dist > viewportRadius * this.config.bufferRatio) continue;

      visibleViruses.push(new VisibleVirus({
        entity_id: virus.entity_id,
        position: new Vec2(virus.x, virus.y),
        radius: virus.radius,
        mass: this._getMass(virus),
      }));
    }

    // 过滤相关 team 广播
    const relevantBroadcasts = teamBroadcasts.filter(b =>
      !b.isExpired(tick) && b.channel === `team:${agent.teamId}`
    );

    return new PerceptionSnapshot({
      agentId: agent.entity_id,
      tick,
      viewportCenter: agentPos,
      viewportRadius,
      visibleEntities,
      visibleFoods,
      visibleViruses,
      nearbyTeamBroadcasts: relevantBroadcasts,
      threatAssessment,
    });
  }

  /**
   * 计算人类玩家同等视野半径 (用于验证 REQ-4.AC1 公平性)
   * @param {number} mass - 玩家质量
   * @returns {number} viewport 半径
   */
  calcHumanViewportRadius(mass) {
    const baseRadius = GameConfig.MASS_RADIUS_K * Math.sqrt(mass / Math.PI);
    return baseRadius * this.config.viewportMultiplier;
  }

  /**
   * 批量生成所有 Agent 的快照
   * @param {Array} agents - Agent 实体数组
   * @param {Array} allEntities - 所有实体
   * @param {Array} allFoods
   * @param {Array} allViruses
   * @param {Array} teamBroadcasts
   * @param {number} tick
   * @returns {Map<string, PerceptionSnapshot>} agentId -> snapshot
   */
  buildAllSnapshots(agents, allEntities, allFoods, allViruses, teamBroadcasts, tick) {
    const snapshots = new Map();
    for (const agent of agents) {
      if (agent.status === 'eaten' || agent.status === 'eliminated') continue;
      const snapshot = this.buildSnapshot(agent, allEntities, allFoods, allViruses, teamBroadcasts, tick);
      snapshots.set(agent.entity_id, snapshot);
    }
    return snapshots;
  }

  /**
   * 构建输入快照摘要 (用于证据链记录,体积更小)
   */
  buildInputSnapshotSummary(perception) {
    return {
      position: perception.viewportCenter.toJSON(),
      viewportRadius: perception.viewportRadius,
      threatCount: perception.getEnemies().length,
      preyCount: perception.visibleEntities.filter(
        e => e.type === 'enemy' && e.mass < 0
      ).length,
      foodCount: perception.visibleFoods.length,
      dangerLevel: perception.threatAssessment.dangerLevel,
    };
  }

  // ========== 私有方法 ==========

  _distance(pos, entity) {
    return Vec2.prototype.distanceTo ? pos.distanceTo(new Vec2(entity.x, entity.y))
      : Math.sqrt((pos.x - entity.x) ** 2 + (pos.y - entity.y) ** 2);
  }

  _getMass(entity) {
    if (entity.mass !== undefined && entity.mass !== null) return entity.mass;
    return Math.PI * (entity.radius || 20) * (entity.radius || 20);
  }

  _classifyEntity(entity, agent) {
    // 食物
    if (entity.type === 'food') return 'food';
    if (entity.type === 'ejected_mass') return 'ejected_mass';

    // 同队: master or agent
    if (entity.teamId && agent.teamId && entity.teamId === agent.teamId) {
      return entity.type === 'master' ? 'master' : 'agent';
    }

    // 刺球
    if (entity.type === 'virus') return 'virus';

    // 其余为敌人
    return 'enemy';
  }
}

module.exports = PerceptionManager;
