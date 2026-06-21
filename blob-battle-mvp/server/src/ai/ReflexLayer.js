/**
 * Reflex Layer - 反射层 (Agent 决策三层架构最底层)
 * 每个物理 tick(20~30Hz) 触发
 * 职责: 势场法(potential field)steering 寻路/避障/紧急分裂逃逸/自动吃临近食物
 * 纯本地确定性代码,零外部网络依赖
 * 对应 REQ-2.AC1, REQ-4
 */

const GameConfig = require('../config/GameConfig');
const { AtomicAction, ActionType } = require('../schema/AtomicAction');

class ReflexLayer {
  constructor(config = {}) {
    this.config = {
      // 势场法权重
      foodAttractionWeight: config.foodAttractionWeight || 0.3,
      preyAttractionWeight: config.preyAttractionWeight || 0.5,
      threatRepulsionWeight: config.threatRepulsionWeight || 2.0,
      goalDirectionWeight: config.goalDirectionWeight || 3.0,

      // 威胁判定
      threatMassRatio: config.threatMassRatio || 1.25,
      fleeDistance: config.fleeDistance || 300,

      // 紧急逃逸
      emergencySplitTrigger: config.emergencySplitTrigger || 0.8, // 危险等级阈值
      emergencySplitMinMass: config.emergencySplitMinMass || 3000,

      // 地图 (用于边界避障)
      mapWidth: config.mapWidth || GameConfig.MAP_WIDTH,
      mapHeight: config.mapHeight || GameConfig.MAP_HEIGHT,
    };
  }

  /**
   * 每个 tick 执行 Reflex 决策 (REQ-2.AC1)
   * @param {string} agentId - Agent ID
   * @param {import('../schema/PerceptionSnapshot').PerceptionSnapshot} perception - 感知快照
   * @param {Object|null} currentGoal - Tactical 层下发的 Goal { type, targetX, targetY, targetEntityId, tacticRole }
   * @param {number} tick - 当前 tick
   * @param {Object} agentState - Agent 当前状态 { mass, radius, splitCount }
   * @returns {AtomicAction}
   */
  decide(agentId, perception, currentGoal, tick, agentState) {
    // 紧急分裂逃逸
    if (agentState && perception.threatAssessment.dangerLevel > this.config.emergencySplitTrigger) {
      const escapeAction = this._emergencySplit(agentId, perception, tick, agentState);
      if (escapeAction) return escapeAction;
    }

    // 势场法合力计算
    const force = this._calculatePotentialField(perception, currentGoal);

    // 归一化
    const magnitude = Math.sqrt(force.x * force.x + force.y * force.y);
    if (magnitude < 0.001) {
      return AtomicAction.idle(agentId, tick);
    }

    const dx = force.x / magnitude;
    const dy = force.y / magnitude;

    return AtomicAction.moveTo(agentId, tick, dx, dy);
  }

  /**
   * 势场法合力计算 (design.md 公式)
   * 力 = Σ(食物吸引力) + Σ(小质量目标吸引力) - Σ(更大威胁排斥力,与距离平方反比) + 当前 Goal 方向力(权重最高)
   */
  _calculatePotentialField(perception, currentGoal) {
    const agentPos = perception.viewportCenter;
    let fx = 0, fy = 0;

    // 1. 食物吸引力
    for (const food of perception.visibleFoods) {
      const dx = food.position.x - agentPos.x;
      const dy = food.position.y - agentPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // 吸引力与距离成反比(近的更吸引)
      const force = this.config.foodAttractionWeight / dist;
      fx += (dx / dist) * force;
      fy += (dy / dist) * force;
    }

    // 2. 小质量目标吸引力 (猎物)
    for (const entity of perception.visibleEntities) {
      if (entity.type !== 'enemy') continue;
      // 只有比自己小的目标才有吸引力
      if (entity.mass >= perception.threatAssessment.nearestThreatMassRatio) continue;

      const dx = entity.position.x - agentPos.x;
      const dy = entity.position.y - agentPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const force = this.config.preyAttractionWeight / dist;
      fx += (dx / dist) * force;
      fy += (dy / dist) * force;
    }

    // 3. 更大威胁排斥力 (与距离平方反比)
    for (const entity of perception.visibleEntities) {
      if (entity.type !== 'enemy') continue;
      if (entity.mass < perception.threatAssessment.nearestThreatMassRatio * 2) continue;

      const dx = agentPos.x - entity.position.x;
      const dy = agentPos.y - entity.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // 排斥力与距离平方反比 (越紧越强)
      const force = this.config.threatRepulsionWeight / (dist * dist);
      fx += (dx / dist) * force;
      fy += (dy / dist) * force;
    }

    // 4. 边界排斥力 (远离边界)
    const boundaryForce = this._boundaryRepulsion(agentPos);
    fx += boundaryForce.x;
    fy += boundaryForce.y;

    // 5. Goal 方向力 (Tactical 层下发,权重最高)
    if (currentGoal && currentGoal.targetX !== undefined) {
      const dx = currentGoal.targetX - agentPos.x;
      const dy = currentGoal.targetY - agentPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      fx += (dx / dist) * this.config.goalDirectionWeight;
      fy += (dy / dist) * this.config.goalDirectionWeight;
    }

    // 6. 刺球排斥力
    for (const virus of perception.visibleViruses) {
      const dx = agentPos.x - virus.position.x;
      const dy = agentPos.y - virus.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < 100) {
        const force = 5.0 / (dist * dist);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
    }

    return { x: fx, y: fy };
  }

  /**
   * 边界排斥力 - Agent 接近地图边缘时产生向内的力
   */
  _boundaryRepulsion(agentPos) {
    let fx = 0, fy = 0;
    const margin = 500; // 边界感知距离

    if (agentPos.x < margin) fx += (margin - agentPos.x) / margin * 5;
    if (agentPos.x > this.config.mapWidth - margin) fx -= (agentPos.x - (this.config.mapWidth - margin)) / margin * 5;
    if (agentPos.y < margin) fy += (margin - agentPos.y) / margin * 5;
    if (agentPos.y > this.config.mapHeight - margin) fy -= (agentPos.y - (this.config.mapHeight - margin)) / margin * 5;

    return { x: fx, y: fy };
  }

  /**
   * 紧急分裂逃逸 - 当大威胁逼近时分裂向反方向弹射
   */
  _emergencySplit(agentId, perception, tick, agentState) {
    const { nearestThreatId, nearestThreatDistance } = perception.threatAssessment;
    if (!nearestThreatId || nearestThreatDistance > this.config.fleeDistance) return null;

    // 质量必须足够才执行分裂逃逸
    if (agentState.mass < this.config.emergencySplitMinMass) return null;
    if ((agentState.splitCount || 0) >= GameConfig.MAX_SPLIT) return null;

    // 找到威胁实体,计算逃离方向
    const threatEntity = perception.visibleEntities.find(e => e.entity_id === nearestThreatId);
    if (!threatEntity) return null;

    const agentPos = perception.viewportCenter;
    const escapeAngle = Math.atan2(
      agentPos.y - threatEntity.position.y,
      agentPos.x - threatEntity.position.x
    );

    return AtomicAction.split(agentId, tick, escapeAngle);
  }
}

module.exports = ReflexLayer;
