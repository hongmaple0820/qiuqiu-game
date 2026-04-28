const LLMAdapter = require('./src/ai/LLMAdapter');

async function test() {
  console.log("=== 测试 Mock LLM (激进性格) ===");
  const ai = new LLMAdapter({ strategy: 'mock_llm', personality: 'aggressive' });
  
  const mockInput = {
    player_state: {
      agent: { x: 100, y: 100, mass: 50, id: 'agent_01' },
      master: { x: 120, y: 120, mass: 60 }
    },
    game_state: {
      entities: [
        { type: 'enemy', x: 150, y: 150, mass: 40 },
        { type: 'food', x: 80, y: 90 }
      ]
    },
    command: null
  };
  
  const result = await ai.process(mockInput);
  console.log("\n决策结果:", JSON.stringify(result, null, 2));
  
  console.log("\n=== 测试指令理解 (保护我) ===");
  const ai2 = new LLMAdapter({ strategy: 'mock_llm', personality: 'loyal' });
  mockInput.command = "保护我！";
  const result2 = await ai2.process(mockInput);
  console.log("\n决策结果:", JSON.stringify(result2, null, 2));
}

test().catch(console.error);
