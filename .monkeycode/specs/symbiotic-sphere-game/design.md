# Symbiotic Sphere - Technical Design Specification

Feature Name: symbiotic-sphere-game
Updated: 2026-06-21

## Description

人机协作多智能体球球大作战,在经典 Agar.io-like 玩法基础上引入三层决策架构(Reflex/Tactical/Strategic),让每位人类玩家可指挥 AI Agent 伙伴协同作战,同时保证强实时游戏的 tick 级响应不受 LLM 推理延迟影响。

## Key Decisions (已确认)

| 决策项 | 结论 | 影响范围 |
|--------|------|---------|
| 人类主人淘汰后 Agent 处理 | 立即淘汰,规则简单清晰 | ECS 数据模型无需额外"无主"状态,降低平衡设计复杂度 |
| 首发平台 | Web(WebSocket 起步) | 客户端为 HTML5 Canvas + WebSocket,后续评估迁移 WebTransport |
| MVP 每位玩家 Agent 数量 | 1 个 | 算力成本可控,核心体验验证后再开放 2~3 个 |
| LLM 调用架构 | 云端 API(Claude) | 成本随 DAU 增长,通过预算限流/语义缓存/Prompt Caching/批处理控制 |

## Architecture

### 系统总体架构

```mermaid
graph TB
    subgraph ClientLayer ["客户端 Client"]
        C1 ["Canvas 渲染层"]
        C2 ["输入采集: 移动/分裂/吐孢子"]
        C3 ["指令 UI: 轮盘/标点/语音"]
        C4 ["预测插值 + Interest Management 客户端"]
    end

    subgraph GatewayLayer ["网关层 Gateway"]
        G1 ["鉴权 + 限流"]
        G2 ["房间路由"]
        G3 ["协议编解码"]
        G4 ["Interest Management 服务端"]
    end

    subgraph GameCore ["游戏仿真核心 Rust/Node.js"]
        GC1 ["ECS 框架"]
        GC2 ["物理引擎 + 碰撞检测"]
        GC3 ["Tick 调度器 20-30Hz"]
        GC4 ["动作校验器 Validator"]
        GC5 ["反作弊 + 证据链记录"]
    end

    subgraph AgentRuntime ["Agent Runtime Service"]
        AR1 ["Reflex Layer: 势场法 steering"]
        AR2 ["Tactical Layer: Utility AI 打分"]
        AR3 ["Strategic Layer: LLM 异步调用"]
        AR4 ["记忆系统: L1/L2/L3"]
        AR5 ["拟人化噪声注入器"]
    end

    subgraph Persistence ["持久化层"]
        P1 ["PostgreSQL: 段位/经济/跨局记忆"]
        P2 ["Redis: 房间状态/匹配队列"]
    end

    subgraph LLMServices ["LLM API"]
        L1 ["Claude Haiku: Tactical 层轻量推理"]
        L2 ["Claude Sonnet: Strategic 层意图解析"]
        L3 ["Prompt Cache + 语义缓存"]
        L4 ["预算控制 + 降级策略"]
    end

    ClientLayer -->|"WebSocket/WebTransport 10-20Hz"| GatewayLayer
    GatewayLayer -->|"感知快照/意图回传"| AgentRuntime
    GatewayLayer -->|"输入转发"| GameCore
    GameCore -->|"权威结算"| GatewayLayer
    AgentRuntime -->|"Intent Schema"| TacticalLayer
    AgentRuntime -->|"Atomic Action"| GameCore
    GameCore -->|"状态持久化"| Persistence
    AgentRuntime -->|"异步调用"| LLMServices
    AR1 -->|"Goal"| AR2
    AR2 -->|"Intent"| AR3
```

### 三层决策架构详细流程

```mermaid
graph TD
    subgraph Strategic ["Strategic Layer 策略层"]
        S1 ["接收自然语言指令"]
        S2 ["NLU 意图解析: Claude Sonnet"]
        S3 ["跨局偏好读取: L3 Memory"]
        S4 ["输出: 结构化 Intent"]
        S5 ["人格化对话反馈"]
    end

    subgraph Tactical ["Tactical Layer 战术层"]
        T1 ["接收 Intent + 事件驱动"]
        T2 ["Utility AI 打分评估"]
        T3 ["目标选择 + 战术原语"]
        T4 ["Team 广播协商"]
        T5 ["输出: Goal: 目标点/战术角色"]
        T6 ["置信度计算"]
    end

    subgraph Reflex ["Reflex Layer 反射层"]
        R1 ["接收 Goal + 物理 tick"]
        R2 ["势场法合力计算"]
        R3 ["避障 + 紧急分裂逃逸"]
        R4 ["拟人化噪声注入"]
        R5 ["输出: Atomic Action"]
    end

    S1 --> S2 --> S4
    S3 --> S2
    S2 --> S5
    S4 -->|"Intent Schema"| T1
    T1 --> T2 --> T3 --> T5
    T4 --> T3
    T6 --> T5
    T5 -->|"Goal"| R1
    R1 --> R2 --> R5
    R3 --> R2
    R4 --> R5
    R5 -->|"Atomic Action"| Validator ["Action Validator"]

    Strategic -.->|"超时降级"| Tactical
    Tactical -.->|"卡顿降级"| Reflex
```

### Agent 协作广播协议流程

```mermaid
graph LR
    A1 ["Agent_07"] -->|"Tactical Proposal: pincer_attack"| Broadcast ["Team Broadcast Channel"]
    A2 ["Agent_12"] -->|"Tactical Proposal: bait"| Broadcast
    P1 ["Player_05"] -->|"Intent: attack target"| Broadcast
    Broadcast -->|"Proposal + confidence"| A1
    Broadcast -->|"Proposal + confidence"| A2
    Broadcast -->|"Proposal + confidence"| P1
    A1 -->|"Utility AI 打分: 采纳/忽略"| Decision ["最终决策"]
    A2 -->|"Utility AI 打分: 采纳/忽略"| Decision
```

## Components and Interfaces

### 1. GameCore - 游戏仿真核心

**职责**: 权威物理仿真、碰撞检测、吞噬判定、分裂/合并逻辑、Tick 调度、动作校验

**接口**:

```typescript
interface IGameCore {
    createRoom(roomId: string, config: RoomConfig): Room;
    joinPlayer(roomId: string, playerId: string, playerName: string): PlayerEntities;
    startGame(roomId: string): void;
    tick(roomId: string): TickResult;
    validateAction(agentId: string, action: AtomicAction, tick: number): ValidationResult;
    getPerceptionSnapshot(agentId: string): PerceptionSnapshot;
    recordDecisionEvidence(agentId: string, input: DecisionInput, output: AtomicAction): void;
}

interface RoomConfig {
    mapSize: number;
    maxEntities: number;
    maxAgentsPerPlayer: number;
    gameMode: "ffa" | "team" | "training" | "spectate";
    tickRate: number;
    sendRate: number;
}
```

### 2. AgentRuntime - Agent 运行时服务

**职责**: 三层决策执行、感知处理、记忆管理、拟人化噪声注入、LLM 调用管理

**接口**:

```typescript
interface IAgentRuntime {
    processTick(agentId: string, perception: PerceptionSnapshot, pendingIntent?: Intent): AtomicAction;
    injectNoise(action: AtomicAction, agentConfig: NoiseConfig): AtomicAction;
    broadcastProposal(agentId: string, proposal: TacticalProposal): void;
    receiveProposals(agentId: string): TacticalProposal[];
    callStrategicLayer(agentId: string, input: StrategicInput): Promise<Intent>;
    getMemory(agentId: string, level: "L1" | "L2" | "L3"): AgentMemory;
    updateMemory(agentId: string, level: "L1" | "L2" | "L3", data: MemoryData): void;
}
```

### 3. Gateway - 网关层

**职责**: 鉴权、限流、房间路由、协议编解码、Interest Management

**接口**:

```typescript
interface IGateway {
    authenticatePlayer(token: string): PlayerIdentity;
    routeToRoom(playerId: string, roomType: RoomType): string;
    encodeState(state: GameState, playerId: string): Buffer;
    decodeInput(buffer: Buffer): PlayerInput;
    filterEntitiesByInterest(state: GameState, playerId: string): GameState;
}
```

### 4. LLMService - LLM 调用管理

**职责**: 分层模型选择、预算限流、Prompt Caching、语义缓存、降级策略、批处理

**接口**:

```typescript
interface ILLMService {
    callStrategic(prompt: StrategicPrompt, agentId: string): Promise<Intent>;
    callTactical(prompt: TacticalPrompt, agentId: string): Promise<TacticalGoal>;
    checkBudget(roomId: string, agentId: string): BudgetStatus;
    getCachedResult(promptHash: string): Intent | null;
    cacheResult(promptHash: string, result: Intent): void;
    fallback(agentId: string): FallbackAction;
    batchCall(roomId: string, prompts: StrategicPrompt[]): Promise<Intent[]>;
}
```

### 5. Persistence - 持久化层

**职责**: 段位/匹配数据存储、跨局记忆持久化、房间状态缓存、经济系统数据

**接口**:

```typescript
interface IPersistence {
    saveMatchResult(roomId: string, result: MatchResult): void;
    getPlayerRanking(playerId: string): RankingInfo;
    getAgentCrossSessionMemory(playerId: string): L3Memory;
    updateAgentCrossSessionMemory(playerId: string, memory: L3Memory): void;
    getRoomState(roomId: string): RoomState | null;
    cacheRoomState(roomId: string, state: RoomState): void;
}
```

### 6. ActionValidator - 动作校验器

**职责**: 对所有动作(包括 Agent 和人类输入)进行合法性校验

**接口**:

```typescript
interface IActionValidator {
    validate(agent: AgentState, action: AtomicAction, tick: number): ValidationResult;
}

interface ValidationResult {
    valid: boolean;
    rejectedReason?: ActionRejected;
    correctedAction?: AtomicAction;
}

enum ActionRejected {
    MoveToNotNormalized = "方向向量未归一化或模长 > 1",
    SplitTooManyParts = "分裂数 >= MAX_SPLIT(16)",
    SplitBelowMinMass = "质量 < MIN_SPLIT_MASS",
    SplitCoolingDown = "分裂冷却未过",
    EjectBelowMinMass = "质量 < MIN_EJECT_MASS",
    ApmLimitExceeded = "每 tick 产生多个动作",
}
```

## Data Models

### ECS Component 定义 (Rust)

```rust
#[derive(Component)]
pub struct Position(pub Vec2);

#[derive(Component)]
pub struct Velocity(pub Vec2);

#[derive(Component)]
pub struct Mass(pub f32);

#[derive(Component)]
pub struct Radius(pub f32);

#[derive(Component)]
pub struct Owner {
    pub kind: OwnerKind,
    pub team: Option<TeamId>,
}

#[derive(Component)]
pub struct AgentBrain {
    pub tier: AgentTier,
    pub current_goal: Option<Goal>,
    pub last_tactical_eval_tick: u64,
    pub last_strategic_call_tick: u64,
    pub memory: AgentMemoryHandle,
}

#[derive(Component)]
pub struct SplitGroup {
    pub root_entity: Entity,
    pub members: SmallVec<[Entity; 16]>,
    pub merge_ready_tick: u64,
}

#[derive(Component)]
pub struct Skin {
    pub skin_id: String,
    pub glow_enabled: bool,
}

#[derive(Component)]
pub struct PowerUpEffect {
    pub effect_type: PowerUpType,
    pub expires_tick: u64,
}
```

### Intent Schema

```json
{
    "intent_id": "uuid",
    "issuer": "player_id",
    "target_agent": "agent_id | team_broadcast",
    "action": "move_to | guard | attack | retreat | bait | merge_rally | feed | hold_position | free_roam",
    "params": {
        "target_position": { "x": 1234.0, "y": 5678.0 },
        "target_entity_id": "entity_id(可选)",
        "radius": 200.0,
        "priority": "low | normal | high | override"
    },
    "expires_at_tick": 18420,
    "natural_language_echo": "去左边守着那堆食物"
}
```

### Tactical Proposal Schema

```json
{
    "channel": "team:42",
    "sender": "agent_07",
    "type": "tactical_proposal",
    "proposal": "pincer_attack | bait | merge_rally | feed | screen",
    "target_entity_id": "player_113",
    "roles": {
        "agent_07": "left_flank",
        "agent_12": "right_flank",
        "player_05": "bait"
    },
    "confidence": 0.78,
    "tick": 18420
}
```

### Atomic Action Schema

```json
{
    "agent_id": "agent_07",
    "tick": 18420,
    "action": "move_to | split | eject_mass | idle",
    "params": {
        "dx": 0.5,
        "dy": 0.3,
        "direction_angle": 1.57,
        "mass_amount": 5
    },
    "noise_applied": true,
    "original_direction": { "dx": 0.52, "dy": 0.28 },
    "delay_ms": 85
}
```

### Agent Memory Schema

```typescript
interface L1Memory {
    recentPerceptionSnapshots: PerceptionSnapshot[];
    nearbyThreatAssessment: ThreatAssessment;
    maxAgeTicks: number;
}

interface L2Memory {
    keyEvents: KeyEvent[];
    trustedTeammates: string[];
    opponentPatternFeatures: OpponentPattern[];
    endOfGameSnapshot?: GameSnapshot;
}

interface L3Memory {
    playerId: string;
    commandHabits: CommandHabitProfile;
    playStylePreference: "aggressive" | "conservative" | "balanced";
    commonTacticalCombinations: TacticalCombo[];
    updatedAt: Date;
}
```

### Noise Config Schema

```typescript
interface NoiseConfig {
    decisionDelayMs: { min: 50, max: 150 };
    pathNoiseDegrees: { mean: 0, stddev: 10 };
    apmLimitPerSecond: number;
    difficultyLevel: "easy" | "normal" | "hard" | "competitive";
}
```

### Perception Snapshot Schema

```typescript
interface PerceptionSnapshot {
    agentId: string;
    tick: number;
    viewportCenter: Vec2;
    viewportRadius: number;
    visibleEntities: VisibleEntity[];
    visibleFoods: VisibleFood[];
    visibleViruses: VisibleVirus[];
    nearbyTeamBroadcasts: TacticalProposal[];
}
```

## Correctness Properties

### CP-1: 下层独立可运转

**不变量**: Strategic 层挂了或超时时,Tactical 层用上一个有效目标继续跑;Tactical 层卡顿时,Reflex 层仍能让 Agent 正常觅食躲避。任何时刻,至少 Reflex 层可独立运转,Agent 不会出现死机站桩。

**验证方式**: 单元测试中模拟 Strategic/Tactical 层超时场景,验证 Agent 行为不中断。

### CP-2: 人类指令抢占优先

**不变量**: 当 Intent 的 priority 为 "override" 时,Tactical 层必须立即打断当前目标,抢占执行人类指令。人类指挥权始终优先于 Agent 自主权。

**验证方式**: 集成测试中发送 override 指令,验证 Agent 当前目标被立即替换。

### CP-3: 动作合法性边界

**不变量**: 所有动作(人类输入和 Agent 输出)必须经过 Action Validator 验证后才进入物理结算。MoveTo 方向向量归一化且模长 <= 1;Split 满足分裂数 < 16 且质量 >= 最小分裂质量且冷却已过;EjectMass 满足质量 >= 最小吐孢子质量;每个 Agent 每 tick 只能产生一个原子动作。

**验证方式**: 对 Action Validator 进行穷举边界值测试,包括 LLM 幻觉指令样本(瞬移坐标、多重操作)。

### CP-4: 感知公平性

**不变量**: Agent 的感知范围等于同等质量人类玩家的 viewport,不开全图视野。Agent 的反应速度通过拟人化噪声参数与人类对齐。

**验证方式**: 对比 Agent 感知范围与人类 viewport 计算公式,确保一致;盲测识别率验收(40%~70%区间)。

### CP-5: 权威服务器结算

**不变量**: 所有结算(吞噬判定、分裂、碰撞)在服务端完成,客户端不可信任何上报结果。

**验证方式**: 审计代码确保吞噬/分裂/碰撞逻辑仅在服务端执行,客户端无结算代码路径。

### CP-6: LLM 预算硬上限

**不变量**: 每个 Agent 每分钟最多 N 次 Strategic 调用,房间级别总预算有上限。预算耗尽时降级到本地规则,不允许无限调用。

**验证方式**: 模拟高并发场景,验证预算限流机制正确拒绝超额调用。

## Error Handling

### EH-1: LLM 超时/失败

**策略**: Agent 立即回退到上一个有效目标或默认 Tactical 规则。记录超时事件到 L2 记忆,用于后续 LLM 调用统计。Strategic 层调用超时阈值设为 5 秒。

### EH-2: Agent Runtime 崩溃

**策略**: GameCore 检测到 Agent 连续 N tick 无 Atomic Action 输出时,将 Agent 切入 Reflex-only 模式(纯势场法觅食躲避),维持基本生存行为。同时触发告警通知运维。

### EH-3: 网络断连重连

**策略**: 客户端断连后,服务器保留玩家实体 30 秒,期间 Agent 继续按最后一次有效指令自主行动。30 秒内重连,恢复控制权;超时则按 Agent 生命周期规则处理(见 REQ-14)。

### EH-4: 动作校验器拒绝

**策略**: Action Validator 拒绝非法动作时,将拒绝原因记录到证据链,Agent 回退到 Idle 动作,下一 tick 重新决策。连续多次被拒绝触发告警。

### EH-5: 房间实体上限溢出

**策略**: 房间实体数接近上限时,暂停新 Agent 填充,停止食物生成,优先保证现有实体正常运行。溢出时拒绝新玩家加入。

### EH-6: LLM 幻觉指令

**策略**: LLM 生成的指令经过 Action Validator 验证,任何超出合法边界的指令被直接拒绝,Agent 回退到 Idle。证据链记录幻觉指令原文和拒绝原因。

## Test Strategy

### TS-1: Reflex 层单元测试

- 势场法合力计算:验证食物吸引力、威胁排斥力、Goal 方向力的合成结果
- 边界避障:验证 Agent 在地图边界附近不穿越
- 紧急分裂逃逸:验证大威胁逼近时分裂方向正确
- 拟人化噪声注入:验证延迟抖动、方向噪声、APM 限制参数生效

### TS-2: Tactical 层单元测试

- Utility AI 打分公式:验证收益/风险/团队一致性/切换成本的加权计算
- 战术原语库:验证 pincer_attack、bait、merge_rally、feed、screen 的角色分配逻辑
- 置信度加权采纳:验证低置信度提案降低采纳权重

### TS-3: Strategic 层集成测试

- NLU 意图解析:验证自然语言输入正确转换为 Intent Schema
- 跨局偏好读取:验证 L3 记忆正确影响 Agent 默认行为
- LLM 超时降级:验证 Strategic 层超时后 Tactical 层接管

### TS-4: Action Validator 穷举测试

- MoveTo 边界值:归一化测试、模长边界(0, 1, >1)、瞬移坐标检测
- Split 边界值:分裂数上限(16)、最小质量、冷却时间
- EjectMass 边界值:最小质量限制
- APM 限制:每 tick 多动作拒绝

### TS-5: 多 Agent 协作集成测试

- Team Broadcast 机制:验证提案广播、接收、打分、采纳流程
- 夹击战术(pincer_attack):验证两个 Agent 从不同方向逼近目标
- 诱饵战术(bait):验证小球暴露吸引追击并引导进入包围圈

### TS-6: 盲测识别率验收测试

- 邀请测试玩家在一局结束后猜测哪些球是 Agent 控制
- 目标:识别准确率在 40%~70% 区间
- 测试条件:排位模式强制拟人化噪声,陪练模式可调低噪声

### TS-7: 性能压测

- 单房间 64 实体(人类+Agent) tick 级稳定性:20~30Hz 不降频
- LLM 批处理吞吐量:验证同房间多 Agent 批量调用效率
- Interest Management 带压测试:验证带宽消耗随实体数增长可控
- 网络同步频率:10~20Hz 状态同步不阻塞

### TS-8: 反作弊审计测试

- 证据链完整性:验证每次关键决策的输入快照+输出动作可回放复现
- LLM 幻觉指令拦截:模拟 LLM 生成非法指令,验证 Action Validator 正确拒绝
- 客户端篡改输入拦截:模拟客户端上报非法动作,验证服务端拒绝

## References

[^1]: (Workspace) - [现有游戏服务器实现](blob-battle-mvp/server/server-v3.js)
[^2]: (Workspace) - [AI 决策引擎](blob-battle-mvp/server/src/ai/DecisionMaker.js)
[^3]: (Workspace) - [LLM 适配器](blob-battle-mvp/server/src/ai/LLMAdapter.js)
[^4]: (Workspace) - [游戏主循环](blob-battle-mvp/server/src/core/GameLoop.js)
[^5]: (Workspace) - [物理引擎](blob-battle-mvp/server/src/physics/Collider.js)
[^6]: (Workspace) - [项目 README](README.md)
