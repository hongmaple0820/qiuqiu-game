/**
 * Tactical Layer - 战术层 (Agent 决策三层架构中间层)
 * 事件驱动(发现敌人/队友求援) + 心跳(0.3~1s) 触发
 * 职责: 目标选择、战术原语执行、队内协商
 * 实现: 本地 Utility AI 打分系统 + 规则引擎,零外部网络依赖
 * 对应 REQ-2.AC2, REQ-6
 */

const { getPrimitive } = require('./TacticalPrimitives');
const TacticalProposal = require('../schema/TacticalProposal');

class TacticalLayer {
  constructor(config = {}) {
    this.config = {
      // Utility AI 权重 (design.md 公式)
      wRewards: config.wRewards || 1.0,        // 收益预估权重
      wRisk: config.wRisk || 1.2,              // 风险预估权重
      wTeamSignal: config.wTeamSignal || 0.8,  // 团队信号一致性权重
      wSwitchCost: config.wSwitchCost || 0.5,   // 切换成本权重

      // 心跳间隔 (tick)
      heartbeatTicks: config.heartbeatTicks || 15, // 0.5s @30Hz

      // 最小评估间隔 (避免每 tick 都评估)
      minEvalInterval: config.minEvalInterval || 5,

      // Intent 指令超时 (即使未过期也降低置信度)
      intentStaleTicks: config.intentStaleTicks || 120,
    };

    // 每个 Agent 的最后评估 tick
    this.lastEvalTick = new Map();
  }

  /**
   * 战术层评估主入口 (REQ-2.AC2)
   * @param {string} agentId
   * @param {import('../schema/PerceptionSnapshot').PerceptionSnapshot} perception
   * @param {import('../schema/Intent')} pendingIntent - 待处理的人类指令
   * @param {import('./TeamBroadcastChannel')} broadcastChannel - 团队广播频道
   * @param {Object} agentState - Agent 当前状态 { mass, position, currentGoal }
   * @param {number} tick
   * @returns {{ goal: Object|null, shouldEvaluate: boolean }}
   */
  evaluate(agentId, perception, pendingIntent, broadcastChannel, agentState, tick) {
    const lastEval = this.lastEvalTick.get(agentId) || 0;

    // 1. 如果有 override 指令,立即抢占
    if (pendingIntent && pendingIntent.isOverride() && !pendingIntent.isExpired(tick)) {
      const goal = this._intentToGoal(pendingIntent, perception);
      this.lastEvalTick.set(agentId, tick);
      return { goal, shouldEvaluate: true, source: 'intent_override' };
    }

    // 2. 心跳检查: 是否到了评估时间
    const shouldEvaluate = tick - lastEval >= this.config.heartbeatTicks;

    if (!shouldEvaluate) {
      return { goal: agentState.currentGoal || null, shouldEvaluate: false };
    }

    // 3. 收集候选目标
    const candidates = [];

    // 3a. Intent 指令目标 (非 override)
    if (pendingIntent && !pendingIntent.isExpired(tick)) {
      const intentGoal = this._intentToGoal(pendingIntent, perception);
      if (intentGoal) {
        candidates.push({
          ...intentGoal,
          source: 'intent',
          baseScore: 0.8, // 指令有较高的基础分
        });
      }
    }

    // 3b. 团队广播提案
    const teamChannel = `team:${agentState.teamId || 'default'}`;
    const proposals = broadcastChannel.receiveForAgent(teamChannel, agentId, tick);
    for (const proposal of proposals) {
      const myRole = proposal.getMyRole(agentId);
      if (!myRole) continue;

      const primitive = getPrimitive(proposal.proposal);
      if (!primitive) continue;

      const targetPos = primitive.getRoleTarget(
        myRole,
        // 目标位置从 target_entity_id 查找
        this._findEntityPosition(proposal.target_entity_id, perception),
        agentState.position || { x: 0, y: 0 }
      );

      candidates.push({
        type: 'tactical',
        targetX: targetPos.x,
        targetY: targetPos.y,
        targetEntityId: proposal.target_entity_id,
        tacticRole: myRole,
        tacticProposal: proposal.proposal,
        source: 'proposal',
        baseScore: proposal.confidence * 0.7,
      });
    }

    // 3c. 自主目标: 最近猎物
    const enemies = perception.getEnemies();
    const nearestPrey = enemies
      .filter(e => e.type === 'enemy')
      .sort((a, b) => a.mass - b.mass)[0]; // 最小的可狩猎敌人

    if (nearestPrey) {
      candidates.push({
        type: 'attack',
        targetX: nearestPrey.position.x,
        targetY: nearestPrey.position.y,
        targetEntityId: nearestPrey.entity_id,
        source: 'autonomous',
        baseScore: 0.4,
        targetMass: nearestPrey.mass,
      });
    }

    // 3d. 自主目标: 食物采集点
    const foods = perception.getAllFoods();
    if (foods.length > 0) {
      const centroid = this._calcCentroid(foods.map(f => f.position));
      candidates.push({
        type: 'gather',
        targetX: centroid.x,
        targetY: centroid.y,
        source: 'autonomous',
        baseScore: 0.3,
      });
    }

    // 4. Utility AI 打分
    const currentGoal = agentState.currentGoal || null;
    let bestGoal = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const score = this._scoreGoal(candidate, perception, agentState, currentGoal);
      if (score > bestScore) {
        bestScore = score;
        bestGoal = {
          type: candidate.type || 'move_to',
          targetX: candidate.targetX,
          targetY: candidate.targetY,
          targetEntityId: candidate.targetEntityId,
          tacticRole: candidate.tacticRole,
          tacticProposal: candidate.tacticProposal,
          score: score,
        };
      }
    }

    // 5. 如果所有候选分数都很低,维持当前目标
    if (bestScore < 0.05 && currentGoal) {
      bestGoal = currentGoal;
    }

    this.lastEvalTick.set(agentId, tick);

    return {
      goal: bestGoal,
      shouldEvaluate: true,
      source: bestGoal ? bestGoal.source : 'none',
      score: bestScore,
    };
  }

  /**
   * Utility AI 打分公式 (design.md)
   * score = w1*收益预估 - w2*风险预估 + w3*团队信号一致性 - w4*切换成本
   */
  _scoreGoal(candidate, perception, agentState, currentGoal) {
    const { wRewards, wRisk, wTeamSignal, wSwitchCost } = this.config;

    // 1. 收益预估 (基于距离、目标价值)
    const rewards = this._estimateRewards(candidate, perception, agentState);

    // 2. 风险预估 (基于附近的威胁)
    const risk = this._estimateRisk(candidate, perception, agentState);

    // 3. 团队信号一致性
    const teamSignal = this._estimateTeamSignal(candidate);

    // 4. 切换成本 (与当前目标的距离差异)
    const switchCost = this._estimateSwitchCost(candidate, currentGoal);

    return candidate.baseScore
      + wRewards * rewards
      - wRisk * risk
      + wTeamSignal * teamSignal
      - wSwitchCost * switchCost;
  }

  _estimateRewards(candidate, perception, agentState) {
    let reward = 0;

    // 距离因素: 越近越好
    if (candidate.targetX !== undefined) {
      const dx = candidate.targetX - perception.viewportCenter.x;
      const dy = candidate.targetY - perception.viewportCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      reward += Math.max(0, 1 - dist / perception.viewportRadius);
    }

    // 目标质量因素 (猎物)
    if (candidate.targetMass && agentState.mass) {
      const ratio = agentState.mass / candidate.targetMass;
      if (ratio > GameConfig.SWALLOW_RATIO) {
        reward += 0.5; // 可以吞噬,高回报
      }
    }

    return Math.min(reward, 1.0);
  }

  _estimateRisk(candidate, perception, agentState) {
    // 基于当前危险等级
    let risk = perception.threatAssessment.dangerLevel;

    // 如果目标方向有更大威胁,风险增加
    if (candidate.targetX !== undefined && perception.threatAssessment.nearestThreatId) {
      const threat = perception.visibleEntities.find(
        e => e.entity_id === perception.threatAssessment.nearestThreatId
      );
      if (threat) {
        const threatDist = perception.threatAssessment.nearestThreatDistance;
        risk += Math.max(0, 1 - threatDist / 300);
      }
    }

    return Math.min(risk, 1.0);
  }

  _estimateTeamSignal(candidate) {
    if (candidate.source === 'proposal') return 1.0;
    if (candidate.source === 'intent') return 0.8;
    return 0;
  }

  _estimateSwitchCost(candidate, currentGoal) {
    if (!currentGoal || !currentGoal.targetX) return 0;

    // 如果当前目标和候选目标方向一致,切换成本低
    const dx = candidate.targetX - currentGoal.targetX;
    const dy = candidate.targetY - currentGoal.targetY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0;

    return Math.min(dist / 500, 1.0);
  }

  /**
   * 将 Intent 转换为 Goal
   */
  _intentToGoal(intent, perception) {
    const goal = {
      type: intent.action,
      source: 'intent',
    };

    if (intent.params.target_position) {
      goal.targetX = intent.params.target_position.x;
      goal.targetY = intent.params.target_position.y;
    }

    if (intent.params.target_entity_id) {
      goal.targetEntityId = intent.params.target_entity_id;
      // 从感知快照中查找实体位置
      const entity = perception.visibleEntities.find(
        e => e.entity_id === intent.params.target_entity_id
      );
      if (entity) {
        goal.targetX = entity.position.x;
        goal.targetY = entity.position.y;
      }
    }

    return goal;
  }

  _findEntityPosition(entityId, perception) {
    const entity = perception.visibleEntities.find(e => e.entity_id === entityId);
    if (entity) return entity.position;
    // 也可能是食物
    const food = perception.visibleFoods.find(f => f.entity_id === entityId);
    if (food) return food.position;
    return { x: 0, y: 0 };
  }

  _calcCentroid(positions) {
    if (positions.length === 0) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    for (const p of positions) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / positions.length, y: sy / positions.length };
  }
}

// need GameConfig for SWALLOW_RATIO
const GameConfig = require('../config/GameConfig');

module.exports = TacticalLayer;
