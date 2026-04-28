/**
 * LLM 适配器 - Phase 3
 * 实现策略模式，支持 RuleEngine (规则) 和 LLMEngine (大模型)
 * 默认使用 MockLLM 模拟行为，配置 API Key 后切换真实模型
 */

class LLMAdapter {
  constructor(config = {}) {
    this.strategy = config.strategy || 'mock_llm'; // 'rule', 'mock_llm', 'real_llm'
    this.apiKey = config.apiKey || process.env.LLM_API_KEY;
    this.model = config.model || 'gpt-4o-mini';
    
    // 初始化策略
    this.strategies = {
      rule: new RuleEngine(),
      mock_llm: new MockLLMEngine(config.personality || 'balanced'),
      real_llm: new RealLLMEngine(this.apiKey, this.model)
    };
  }

  async process(input) {
    const engine = this.strategies[this.strategy];
    if (!engine) throw new Error(`Unknown strategy: ${this.strategy}`);
    
    console.log(`[AI] Using strategy: ${this.strategy}`);
    return await engine.process(input);
  }
}

// --- 1. Rule Engine Strategy (Phase 2 Logic - 保底) ---
class RuleEngine {
  async process(input) {
    const { player_state, game_state, command } = input;
    const agent = player_state.agent;
    const master = player_state.master;
    
    // 简单规则：如果敌人靠近且比我不大，分裂攻击；否则跟随主人
    const enemies = game_state.entities.filter(e => e.type === 'enemy' || (e.type === 'player' && e.id !== agent.id));
    const closestEnemy = this.findClosest(enemies, agent);
    
    let decision = { 
      action: 'follow', 
      target_x: master.x, 
      target_y: master.y, 
      reason: '默认跟随主人',
      chat_response: '跟随中...'
    };
    
    if (command) {
      if (command.includes('保护') || command.includes('防御')) {
        return { ...decision, action: 'defend', reason: '收到防御指令', chat_response: '收到，正在保护主人！' };
      }
      if (command.includes('进攻') || command.includes('攻击')) {
        if (closestEnemy) {
          return { 
            action: 'split', 
            target_x: closestEnemy.x, 
            target_y: closestEnemy.y, 
            reason: '收到进攻指令',
            chat_response: '收到，正在发起攻击！' 
          };
        }
      }
    }

    // 自动逻辑
    if (closestEnemy && this.distance(agent, closestEnemy) < 150 && agent.mass > closestEnemy.mass * 1.2) {
      decision = { 
        action: 'split', 
        target_x: closestEnemy.x, 
        target_y: closestEnemy.y, 
        reason: '检测到可猎杀敌人',
        chat_response: '发现猎物，准备分裂！' 
      };
    } else if (closestEnemy && this.distance(agent, closestEnemy) < 100 && agent.mass < closestEnemy.mass) {
      decision = { 
        action: 'flee', 
        target_x: master.x - (closestEnemy.x - agent.x), 
        target_y: master.y - (closestEnemy.y - agent.y), 
        reason: '检测到危险敌人，撤退',
        chat_response: '打不过，快跑！' 
      };
    }
    
    return decision;
  }

  findClosest(entities, reference) {
    let closest = null;
    let minDist = Infinity;
    for (const e of entities) {
      const dist = this.distance(e, reference);
      if (dist < minDist) {
        minDist = dist;
        closest = e;
      }
    }
    return closest;
  }

  distance(a, b) {
    return Math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2);
  }
}

// --- 2. Mock LLM Engine Strategy (模拟大模型行为 + 性格系统) ---
class MockLLMEngine {
  constructor(personalityType = 'balanced') {
    this.personalities = {
      aggressive: { name: '激进', bias: 1.5, response_style: '好战', desc: '主动进攻，优先分裂' },
      defensive: { name: '保守', bias: 0.8, response_style: '谨慎', desc: '跟随主人，躲避敌人' },
      loyal: { name: '护主', bias: 1.0, response_style: '忠诚', desc: '牺牲自己，保护主人' },
      balanced: { name: '均衡', bias: 1.0, response_style: '理性', desc: '攻守兼备' }
    };
    this.personality = this.personalities[personalityType] || this.personalities.balanced;
  }

  async process(input) {
    const { player_state, game_state, command } = input;
    const agent = player_state.agent;
    const master = player_state.master;
    
    // 模拟思考延迟 (500ms - 1500ms)
    const delay = 500 + Math.random() * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    const enemies = game_state.entities.filter(e => e.type === 'enemy' || (e.type === 'player' && e.id !== agent.id));
    const foods = game_state.entities.filter(e => e.type === 'food');
    const closestEnemy = this.findClosest(enemies, agent);
    const closestFood = this.findClosest(foods, agent);
    
    let decision = { action: 'follow', target_x: master.x, target_y: master.y, reason: '待命' };
    let response = '';

    // 1. 指令优先
    if (command) {
      if (command.includes('保护')) {
        decision = { action: 'defend', target_x: master.x, target_y: master.y, reason: '指令：保护' };
        response = `(${this.personality.name}) 收到！谁敢动主人，先过我这关！`;
      } else if (command.includes('进攻')) {
        if (closestEnemy) {
          decision = { action: 'split', target_x: closestEnemy.x, target_y: closestEnemy.y, reason: '指令：进攻' };
          response = `(${this.personality.name}) 看我的！分裂攻击！`;
        } else {
          response = `(${this.personality.name}) 没发现敌人，在哪？`;
        }
      } else if (command.includes('集合')) {
        decision = { action: 'follow', target_x: master.x, target_y: master.y, reason: '指令：集合' };
        response = `(${this.personality.name}) 马上到位！`;
      } else {
        // 通用聊天
        response = `(${this.personality.name}) 听到了："${command}"。目前状态良好。`;
      }
    } 
    // 2. 自主决策 (基于性格)
    else if (closestEnemy) {
      const dist = this.distance(agent, closestEnemy);
      const threatLevel = closestEnemy.mass / agent.mass;
      
      if (threatLevel > 1.2 && dist < 150) {
        // 危险
        if (this.personality.name === '激进') {
           decision = { action: 'split', target_x: closestEnemy.x, target_y: closestEnemy.y, reason: '激进：即使危险也要搏一搏' };
           response = '虽然有点大，但值得一试！分裂！';
        } else {
           decision = { action: 'flee', target_x: master.x, target_y: master.y, reason: '躲避威胁' };
           response = '太危险了，快撤到主人身边！';
        }
      } else if (threatLevel < 0.8 && dist < 200) {
        // 安全猎物
        decision = { action: 'split', target_x: closestEnemy.x, target_y: closestEnemy.y, reason: '猎杀弱小' };
        response = '这个小家伙看起来很好吃！上！';
      } else {
        decision = { action: 'defend', target_x: master.x, target_y: master.y, reason: '警戒状态' };
        response = '有敌情，保持警惕。';
      }
    } else if (closestFood && agent.mass < master.mass * 1.5) {
      decision = { action: 'move_to', target_x: closestFood.x, target_y: closestFood.y, reason: '发育' };
      response = '趁现在吃点东西长身体。';
    } else {
      decision = { action: 'follow', target_x: master.x, target_y: master.y, reason: '跟随' };
      response = '目前安全，跟随主人。';
    }

    return {
      ...decision,
      chat_response: response,
      personality: this.personality.name,
      thought_process: `检测敌人:${!!closestEnemy}, 距离:${closestEnemy?this.distance(agent, closestEnemy).toFixed(0):'N/A'}, 性格:${this.personality.name}`
    };
  }

  findClosest(entities, reference) {
    let closest = null;
    let minDist = Infinity;
    for (const e of entities) {
      const dist = this.distance(e, reference);
      if (dist < minDist) {
        minDist = dist;
        closest = e;
      }
    }
    return closest;
  }

  distance(a, b) {
    return Math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2);
  }
}

// --- 3. Real LLM Engine Strategy (预留真实接口) ---
class RealLLMEngine {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
    this.enabled = !!apiKey;
  }

  async process(input) {
    if (!this.enabled) {
      throw new Error('LLM API Key not configured');
    }

    const { player_state, game_state, command } = input;
    
    // 构造 Prompt
    const systemPrompt = `你是一个球球大作战游戏中的 AI 分身"Guardian"。你的目标是保护主人并协助获胜。
    请根据当前游戏状态做出决策。输出必须是严格的 JSON 格式：
    { "action": "move_to|split|defend|flee", "target_x": number, "target_y": number, "reason": "string", "chat_response": "string" }`;

    const userContext = `
    我的状态: 质量${player_state.agent.mass}, 位置(${player_state.agent.x}, ${player_state.agent.y})
    主人状态: 质量${player_state.master.mass}, 位置(${player_state.master.x}, ${player_state.master.y})
    附近敌人: ${game_state.entities.filter(e => e.type === 'enemy').length} 个
    主人指令: "${command || '无'}"
    请决策：`;

    // 调用 LLM API (此处为伪代码，实际需接入 fetch)
    // const response = await fetch('https://api.openai.com/v1/chat/completions', { ... });
    // const data = await response.json();
    // return JSON.parse(data.choices[0].message.content);
    
    console.warn('[RealLLM] API call not implemented in this mock file. Fallback to MockLLM logic for demo.');
    // 为了演示不报错，暂时 fallback 到简单逻辑，实际应抛出错误或真实调用
    return { action: 'follow', target_x: player_state.master.x, target_y: player_state.master.y, reason: 'Real LLM not connected', chat_response: 'LLM 接口未配置，使用备用逻辑。' };
  }
}

module.exports = LLMAdapter;
