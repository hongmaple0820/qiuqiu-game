/**
 * Integration Test - 端到端验证完整游戏流程
 * 验证: 房间创建 -> 玩家加入 -> Agent 决策 -> 三层调度 -> 物理更新 -> 网络同步 -> 淘汰
 */
const { GameLoop, TickCounter } = require('../src/core/GameLoop');
const Gateway = require('../src/gateway/Gateway');
const GameConfig = require('../src/config/GameConfig');
const { AgentTier } = require('../src/ai/AgentBrain');

async function runTests() {
  let pass = 0, fail = 0;
  const check = (name, condition) => {
    if (condition) { pass++; } else { fail++; console.error(`  FAIL: ${name}`); }
  };

  console.log('=== Integration Test: Symbiotic Sphere ===\n');

  // 1. 初始化
  console.log('[1] 初始化 GameLoop + Gateway');
  const gl = new GameLoop({ mapWidth: 6000, mapHeight: 6000 });
  const gw = new Gateway({
    agentBrain: gl.getAgentBrain(),
    playerSockets: new Map(),
    playerRooms: new Map(),
  });

  // 2. 创建房间 + 玩家
  console.log('[2] 房间与玩家');
  const room = gl.createRoom('test_room', { maxPlayers: 4 });
  check('room created', room !== null && room.status === 'waiting');

  gl.joinPlayer('test_room', 'p1', 'Player1');
  gl.joinPlayer('test_room', 'p2', 'Player2');
  check('2 players joined', room.players.length === 2);
  check('4 entities in room', room.entities.length === 4);

  // 验证 Agent 已在 AgentBrain 注册
  const brain = gl.getAgentBrain();
  check('agent_p1 registered', brain.getAgentState('agent_p1') !== null);
  check('agent_tier is TACTICAL_AUTONOMOUS', brain.getAgentState('agent_p1').tier === AgentTier.TACTICAL_AUTONOMOUS);

  // 3. 启动游戏
  console.log('[3] 游戏启动');
  gl.startGame('test_room');
  check('game started', room.status === 'playing');

  // 4. 模拟 20 tick
  console.log('[4] 模拟 tick (x20)...');
  const sentMessages = [];
  gl._sendToPlayer = (id, msg) => sentMessages.push({ id, msg });

  for (let i = 0; i < 20; i++) {
    gl.tick(room);
  }

  // 5. 验证网络同步
  console.log('[5] 网络同步验证');
  check('per-player messages sent', sentMessages.length >= 2);
  check('message format valid', sentMessages[0]?.msg?.proto_id === 1001);

  // 检查增量同步
  const firstMsg = sentMessages[0].msg;
  const hasEntities = firstMsg.data?.entities?.length > 0;
  const hasDelta = (firstMsg.data?.added?.length || 0) > 0;
  check('sync has data (entities or added)', hasEntities || hasDelta);

  // 6. 验证 Agent 决策产生动作
  console.log('[6] Agent 决策验证');
  const p1AgentState = brain.getAgentState('agent_p1');
  check('agent_p1 alive', p1AgentState.isAlive);
  check('agent_p1 has position', p1AgentState.position !== undefined);

  // 7. 验证 Intent 指令系统
  console.log('[7] Intent 指令');
  const intentMsg = {
    proto_id: 2002,
    data: {
      target_agent: 'agent_p1',
      action: 'retreat',
      params: { target_position: { x: 500, y: 500 }, priority: 'override' },
    }
  };
  const result = gw.handleMessage('p1', intentMsg, 25);
  check('intent dispatched', result.handled && result.ack.data.success);
  check('intent stored in brain', brain.getAgentState('agent_p1').pendingIntent !== null);

  // 8. 验证聊天关键词解析
  console.log('[8] 聊天指令解析');
  const chatMsg = { proto_id: 2001, data: { content: '全体进攻' } };
  const chatResult = gw.handleMessage('p1', chatMsg, 30);
  check('chat parsed as intent', chatResult.handled);
  check('attack intent dispatched', chatResult.ack?.data?.success);

  // 9. 验证 Agent 淘汰 (主人被吞噬)
  console.log('[9] Agent 淘汰');
  const master = room.entities.find(e => e.entity_id === 'master_p1');
  if (master) {
    master.status = 'eaten';
    gl.tick(room);

    const agentAfter = room.entities.find(e => e.entity_id === 'agent_p1');
    check('agent eliminated after master death', !agentAfter || agentAfter.status === 'eaten');
    check('agent_brain dead', !brain.isAlive('agent_p1'));
  }

  // 10. 验证断连处理
  console.log('[10] 断连重连');
  gl.handlePlayerDisconnect('p2');
  const p2 = room.players.find(p => p.id === 'p2');
  check('player marked disconnected', p2 && !p2.connected);

  gl.handlePlayerReconnect('p2');
  check('player reconnected', p2.connected);

  // 11. 验证 Budget Manager
  console.log('[11] LLM 预算');
  const LLMBudgetManager = require('../src/ai/LLMBudgetManager');
  const bm = new LLMBudgetManager({ budgetPerAgentPerMin: 3 });
  check('budget consumed', bm.consumeBudget('a1', 'r1'));
  check('budget consumed x3', bm.consumeBudget('a1', 'r1') && bm.consumeBudget('a1', 'r1'));
  check('budget exhausted', !bm.consumeBudget('a1', 'r1'));

  // 12. 验证 Semantic Cache
  console.log('[12] 语义缓存');
  const SemanticCache = require('../src/ai/SemanticCache');
  const cache = new SemanticCache();
  cache.cacheResult('test_prompt_abc', { action: 'attack', tick: 1 });
  const cached = cache.getCachedResult('test_prompt_abc');
  check('cache hit', cached !== null && cached.action === 'attack');

  // 13. 验证 Interest Manager
  console.log('[13] Interest Management');
  const view = gl.interest.getEntitiesInView('test_room', 'p1', { x: 3000, y: 3000, mass: 1000 }, 500);
  check('entities in view', view.length > 0);

  // 14. 验证 ActionValidator
  console.log('[14] ActionValidator');
  const { AtomicAction } = require('../src/schema/AtomicAction');
  const action = AtomicAction.moveTo('test_agent', 1, 10.0, 0);
  const validation = gl.validator.validate({ entity_id: 'test_agent', mass: 3000, splitCount: 0 }, action, 1);
  check('magnitude>1 auto-corrects (not rejects)', validation.valid && validation.correctedAction !== undefined);

  const goodAction = AtomicAction.moveTo('test_agent', 1, 0.6, 0.8);
  const v2 = gl.validator.validate({ entity_id: 'test_agent', mass: 3000, splitCount: 0 }, goodAction, 2);
  check('normalized action accepted', v2.valid);

  // 15. 验证完整文件清单
  console.log('[15] 全部模块加载');
  const modules = [
    'config/GameConfig',
    'schema/Intent', 'schema/TacticalProposal', 'schema/AtomicAction',
    'schema/PerceptionSnapshot', 'schema/NoiseConfig', 'schema/AgentMemory',
    'physics/PhysicsEngine', 'validator/ActionValidator',
    'core/DecisionEvidence', 'core/PerceptionManager', 'core/GameLoop',
    'ai/ReflexLayer', 'ai/NoiseInjector', 'ai/TacticalLayer',
    'ai/TacticalPrimitives', 'ai/TeamBroadcastChannel', 'ai/AgentMemory',
    'ai/AgentBrain', 'ai/StrategicLayer', 'ai/LLMService',
    'ai/LLMBudgetManager', 'ai/SemanticCache',
    'gateway/Gateway', 'gateway/InterestManager',
  ];
  let loaded = 0;
  for (const m of modules) {
    try { require(`../src/${m}`); loaded++; } catch (e) { console.error(`  FAIL load: ${m}`, e.message); }
  }
  check(`modules loaded: ${loaded}/${modules.length}`, loaded === modules.length);

  // 结果
  console.log(`\n=== Results: ${pass} PASS / ${fail} FAIL ===`);

  gl.stop();
  return fail === 0;
}

runTests().then(ok => process.exit(ok ? 0 : 1));
