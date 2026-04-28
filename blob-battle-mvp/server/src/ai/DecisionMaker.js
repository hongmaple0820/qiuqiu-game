/**
 * AI 分身决策引擎
 * 负责：威胁评估、战术决策、指令解析、行为树执行
 */

class DecisionMaker {
  constructor(config = {}) {
    this.config = {
      threatDistanceThreshold: config.threatDistanceThreshold || 300,
      safeDistanceRatio: config.safeDistanceRatio || 1.3,
      defendRadius: config.defendRadius || 150,
      attackConfidence: config.attackConfidence || 0.7,
      fleeHealthThreshold: config.fleeHealthThreshold || 0.3,
      personality: config.personality || 'balanced',
    };
    
    this.memory = {
      lastThreatPos: null,
      lastThreatTime: 0,
      recentCommands: [],
      targetEnemy: null,
    };
  }

  decide(agent, master, allEntities, currentCommand = null) {
    const gameState = this._analyzeGameState(agent, master, allEntities);
    
    if (currentCommand) {
      const commandDecision = this._handleCommand(agent, master, allEntities, currentCommand, gameState);
      if (commandDecision) {
        return commandDecision;
      }
    }
    
    return this._autonomousDecision(agent, master, allEntities, gameState);
  }

  _analyzeGameState(agent, master, allEntities) {
    const state = {
      threats: [],
      preys: [],
      foods: [],
      allies: [],
      nearestThreat: null,
      nearestPrey: null,
      dangerLevel: 0,
    };
    
    const agentMass = Math.PI * agent.radius * agent.radius;
    
    allEntities.forEach(entity => {
      if (entity.entity_id === agent.entity_id || entity.status === 'eaten') return;
      
      const distance = Math.sqrt(Math.pow(entity.x - agent.x, 2) + Math.pow(entity.y - agent.y, 2));
      const entityMass = Math.PI * entity.radius * entity.radius;
      const massRatio = entityMass / agentMass;
      
      if (entity.type === 'master' || (entity.isAgent && entity.teamId === agent.teamId)) {
        state.allies.push({ entity, distance });
      } else if (massRatio > 1.2) {
        state.threats.push({ entity, distance, massRatio });
        if (!state.nearestThreat || distance < state.nearestThreat.distance) {
          state.nearestThreat = { entity, distance, massRatio };
        }
      } else if (massRatio < 0.8) {
        state.preys.push({ entity, distance, massRatio });
        if (!state.nearestPrey || distance < state.nearestPrey.distance) {
          state.nearestPrey = { entity, distance, massRatio };
        }
      } else {
        if (distance < 100) {
          state.threats.push({ entity, distance, massRatio: 1.0 });
        }
      }
    });
    
    if (state.nearestThreat) {
      const threatFactor = 1 / (state.nearestThreat.distance / 100);
      const sizeFactor = Math.min(state.nearestThreat.massRatio / 2, 1);
      state.dangerLevel = Math.min(threatFactor * sizeFactor, 1);
    }
    
    return state;
  }

  _handleCommand(agent, master, allEntities, command, gameState) {
    const { action, priority, target_pos } = command.parsed_intent || {};
    
    this.memory.recentCommands.push({ ...command, timestamp: Date.now() });
    if (this.memory.recentCommands.length > 5) {
      this.memory.recentCommands.shift();
    }
    
    switch (action) {
      case 'defend':
      case 'protect':
        return this._executeDefend(agent, master, gameState);
      case 'attack':
      case 'hunt':
        return this._executeAttack(agent, master, allEntities, gameState);
      case 'gather':
      case 'collect':
        return this._executeGather(agent, master, gameState);
      case 'split':
        return this._executeSplit(agent, master, gameState, target_pos);
      case 'flee':
      case 'escape':
        return this._executeFlee(agent, master, gameState);
      case 'follow':
        return this._executeFollow(agent, master, gameState);
      default:
        return null;
    }
  }

  _autonomousDecision(agent, master, allEntities, gameState) {
    const { threats, preys, dangerLevel, nearestThreat, nearestPrey } = gameState;
    
    if (dangerLevel > 0.6) {
      if (nearestThreat && nearestThreat.distance < 200) {
        const masterMass = Math.PI * master.radius * master.radius;
        const agentMass = Math.PI * agent.radius * agent.radius;
        
        if (agentMass > masterMass * 1.2) {
          return this._executeDefend(agent, master, gameState);
        } else {
          return this._executeFlee(agent, master, gameState);
        }
      }
    }
    
    if (dangerLevel > 0.3) {
      return this._executeFollow(agent, master, gameState, true);
    }
    
    if (preys.length > 0 && nearestPrey.distance < 300) {
      return this._executeAttack(agent, master, allEntities, gameState);
    }
    
    return this._executeGather(agent, master, gameState);
  }

  _executeDefend(agent, master, gameState) {
    const { nearestThreat } = gameState;
    
    let thought, chatResponse, actions;
    
    if (nearestThreat) {
      const interceptX = master.x + (master.x - nearestThreat.entity.x) * 0.5;
      const interceptY = master.y + (master.y - nearestThreat.entity.y) * 0.5;
      
      thought = `检测到威胁 ${nearestThreat.entity.name}（距离${Math.round(nearestThreat.distance)}），移动到主人前方拦截`;
      chatResponse = "别怕，我来挡住他！";
      actions = [{ type: 'move_to', params: { x: interceptX, y: interceptY } }];
    } else {
      const patrolAngle = Date.now() / 1000;
      const patrolX = master.x + Math.cos(patrolAngle) * this.config.defendRadius;
      const patrolY = master.y + Math.sin(patrolAngle) * this.config.defendRadius;
      
      thought = "未发现直接威胁，在主人周围巡逻警戒";
      chatResponse = "已就位，随时准备保护你！";
      actions = [{ type: 'move_to', params: { x: patrolX, y: patrolY } }];
    }
    
    return { thought, chat_response: chatResponse, actions };
  }

  _executeAttack(agent, master, allEntities, gameState) {
    const { nearestPrey, threats } = gameState;
    
    if (!nearestPrey) {
      return {
        thought: "未找到合适的猎物",
        chat_response: "附近没有可以攻击的目标，我们要小心行事。",
        actions: [{ type: 'follow', params: { target_id: master.entity_id } }]
      };
    }
    
    const hasLargerThreat = threats.some(t => t.distance < 200);
    
    if (hasLargerThreat) {
      return {
        thought: "发现猎物但有更大威胁在附近，放弃进攻",
        chat_response: "先不打这个，旁边有更大的敌人！",
        actions: [{ type: 'move_away', params: { from_x: nearestPrey.entity.x, from_y: nearestPrey.entity.y } }]
      };
    }
    
    const target = nearestPrey.entity;
    const angle = Math.atan2(target.y - agent.y, target.x - agent.x);
    const moveX = agent.x + Math.cos(angle) * 200;
    const moveY = agent.y + Math.sin(angle) * 200;
    
    const shouldSplit = agent.radius > target.radius * 1.5 && agent.radius > 30;
    
    const actions = [{ type: 'move_to', params: { x: moveX, y: moveY } }];
    
    if (shouldSplit) {
      actions.push({ type: 'split', params: { direction_angle: angle } });
    }
    
    return {
      thought: `锁定猎物 ${target.name}（距离${Math.round(nearestPrey.distance)}），${shouldSplit ? '准备分裂追击' : '直接追击'}`,
      chat_response: "让我们猎杀他们！" + (shouldSplit ? "分裂！" : ""),
      actions
    };
  }

  _executeGather(agent, master, gameState) {
    const { foods, preys } = gameState;
    
    let target = null;
    let minDistance = Infinity;
    
    [...foods, ...preys].forEach(item => {
      if (item.distance < minDistance && item.distance < 400) {
        minDistance = item.distance;
        target = item.entity;
      }
    });
    
    if (target) {
      const angle = Math.atan2(target.y - agent.y, target.x - agent.x);
      const moveX = agent.x + Math.cos(angle) * 150;
      const moveY = agent.y + Math.sin(angle) * 150;
      
      return {
        thought: `前往采集目标（距离${Math.round(minDistance)}）`,
        chat_response: "我去吃点东西长大！",
        actions: [{ type: 'move_to', params: { x: moveX, y: moveY } }]
      };
    }
    
    return this._executeFollow(agent, master, gameState);
  }

  _executeFollow(agent, master, gameState, alertMode = false) {
    const distanceToMaster = Math.sqrt(
      Math.pow(master.x - agent.x, 2) + Math.pow(master.y - agent.y, 2)
    );
    
    if (distanceToMaster > 200) {
      const angle = Math.atan2(master.y - agent.y, master.x - agent.x);
      const moveX = master.x - Math.cos(angle) * 50;
      const moveY = master.y - Math.sin(angle) * 50;
      
      return {
        thought: `距离主人${Math.round(distanceToMaster)}，快速靠近`,
        chat_response: alertMode ? "等等我！" : "马上过来！",
        actions: [{ type: 'move_to', params: { x: moveX, y: moveY } }]
      };
    }
    
    const followAngle = Math.atan2(master.vy, master.vx);
    const offsetX = Math.cos(followAngle + Math.PI) * 80;
    const offsetY = Math.sin(followAngle + Math.PI) * 80;
    
    return {
      thought: `保持在主人身后${Math.round(distanceToMaster)}距离跟随`,
      chat_response: alertMode ? "跟紧了！" : "",
      actions: [{ type: 'move_to', params: { x: master.x + offsetX, y: master.y + offsetY } }]
    };
  }

  _executeSplit(agent, master, gameState, targetPos = null) {
    let splitAngle = 0;
    
    if (targetPos) {
      splitAngle = Math.atan2(targetPos.y - agent.y, targetPos.x - agent.x);
    } else if (gameState.nearestPrey) {
      splitAngle = Math.atan2(
        gameState.nearestPrey.entity.y - agent.y,
        gameState.nearestPrey.entity.x - agent.x
      );
    } else {
      splitAngle = Math.atan2(master.vy, master.vx);
    }
    
    return {
      thought: `向角度${Math.round(splitAngle * 180 / Math.PI)}°分裂`,
      chat_response: "分裂出击！",
      actions: [{ type: 'split', params: { direction_angle: splitAngle, count: 1 } }]
    };
  }

  _executeFlee(agent, master, gameState) {
    const { nearestThreat } = gameState;
    
    if (!nearestThreat) {
      return {
        thought: "没有威胁，不需要逃跑",
        chat_response: "安全了，没有敌人追我们。",
        actions: [{ type: 'follow', params: { target_id: master.entity_id } }]
      };
    }
    
    const fleeAngle = Math.atan2(
      agent.y - nearestThreat.entity.y,
      agent.x - nearestThreat.entity.x
    );
    const fleeDistance = 300;
    const moveX = agent.x + Math.cos(fleeAngle) * fleeDistance;
    const moveY = agent.y + Math.sin(fleeAngle) * fleeDistance;
    
    return {
      thought: `远离威胁 ${nearestThreat.entity.name}（距离${Math.round(nearestThreat.distance)}）`,
      chat_response: "快跑！打不过！",
      actions: [{ type: 'move_to', params: { x: moveX, y: moveY } }]
    };
  }

  setPersonality(personality) {
    const personalities = {
      aggressive: { attackConfidence: 0.5, defendRadius: 100, fleeHealthThreshold: 0.2 },
      defensive: { attackConfidence: 0.8, defendRadius: 200, fleeHealthThreshold: 0.5 },
      greedy: { attackConfidence: 0.6, defendRadius: 120, fleeHealthThreshold: 0.25 },
      balanced: { attackConfidence: 0.7, defendRadius: 150, fleeHealthThreshold: 0.3 },
    };
    
    this.config = { ...this.config, ...personalities[personality] };
    this.config.personality = personality;
  }
}

module.exports = DecisionMaker;
