/**
 * 测试内置 Mock LLM AI - 无需 API Key
 */
const LLMAdapter = require('./src/ai/LLMAdapter');

async function testBuiltInAI() {
  console.log('🎮 测试内置 Mock LLM AI 系统\n');
  
  // 测试 1: 激进性格
  console.log('=== 测试 1: 激进性格分身 ===');
  const aggressiveAI = new LLMAdapter({ strategy: 'mock_llm', personality: 'aggressive' });
  const result1 = await aggressiveAI.process({
    player_state: {
      agent: { id: 'agent1', x: 500, y: 500, mass: 30 },
      master: { x: 520, y: 510, mass: 35 }
    },
    game_state: {
      entities: [
        { type: 'enemy', x: 580, y: 520, mass: 25 },
        { type: 'food', x: 450, y: 480, mass: 5 }
      ]
    },
    command: null
  });
  console.log(`性格：${result1.personality}`);
  console.log(`决策：${result1.action} - ${result1.reason}`);
  console.log(`对话：${result1.chat_response}\n`);

  // 测试 2: 护主性格 + 保护指令
  console.log('=== 测试 2: 护主性格 + "保护我"指令 ===');
  const loyalAI = new LLMAdapter({ strategy: 'mock_llm', personality: 'loyal' });
  const result2 = await loyalAI.process({
    player_state: {
      agent: { id: 'agent2', x: 500, y: 500, mass: 30 },
      master: { x: 520, y: 510, mass: 35 }
    },
    game_state: {
      entities: [
        { type: 'enemy', x: 580, y: 520, mass: 40 }
      ]
    },
    command: '保护我！有敌人！'
  });
  console.log(`性格：${result2.personality}`);
  console.log(`决策：${result2.action} - ${result2.reason}`);
  console.log(`对话：${result2.chat_response}\n`);

  // 测试 3: 保守性格 + 危险情况
  console.log('=== 测试 3: 保守性格 + 遭遇强敌 ===');
  const defensiveAI = new LLMAdapter({ strategy: 'mock_llm', personality: 'defensive' });
  const result3 = await defensiveAI.process({
    player_state: {
      agent: { id: 'agent3', x: 500, y: 500, mass: 20 },
      master: { x: 520, y: 510, mass: 25 }
    },
    game_state: {
      entities: [
        { type: 'enemy', x: 550, y: 510, mass: 35 }
      ]
    },
    command: null
  });
  console.log(`性格：${result3.personality}`);
  console.log(`决策：${result3.action} - ${result3.reason}`);
  console.log(`对话：${result3.chat_response}\n`);

  // 测试 4: 规则引擎保底
  console.log('=== 测试 4: 规则引擎 (无 AI 时的保底逻辑) ===');
  const ruleAI = new LLMAdapter({ strategy: 'rule' });
  const result4 = await ruleAI.process({
    player_state: {
      agent: { id: 'agent4', x: 500, y: 500, mass: 30 },
      master: { x: 520, y: 510, mass: 35 }
    },
    game_state: {
      entities: [
        { type: 'enemy', x: 580, y: 520, mass: 20 }
      ]
    },
    command: '进攻！'
  });
  console.log(`策略：rule`);
  console.log(`决策：${result4.action} - ${result4.reason}`);
  console.log(`对话：${result4.chat_response}\n`);

  console.log('✅ 所有测试完成！内置 AI 系统运行正常');
  console.log('\n💡 提示：当前使用 Mock LLM，无需 API Key');
  console.log('   如需切换真实 LLM，设置环境变量 LLM_API_KEY 即可');
}

testBuiltInAI().catch(console.error);
