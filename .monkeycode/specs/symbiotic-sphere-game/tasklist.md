# 需求实施计划 - Symbiotic Sphere

- [x] 1. 项目结构重组与核心配置初始化
   - 在 `blob-battle-mvp/server/src/` 下创建新的模块目录结构: `core/`(GameLoop 已存在)、`physics/`(Collider 已存在)、`ai/`(DecisionMaker+LLMAdapter 已存在)、`gateway/`、`persistence/`、`schema/`、`validator/`
   - 在 `blob-battle-mvp/server/src/schema/` 创建 `Intent.js`、`TacticalProposal.js`、`AtomicAction.js`、`PerceptionSnapshot.js`、`NoiseConfig.js`、`AgentMemory.js` 数据模型文件,定义 REQ-5 Intent Schema、REQ-6 Tactical Proposal Schema、REQ-10 Atomic Action Schema、design.md 中所有 Schema 的 JavaScript 类
   - 在 `blob-battle-mvp/server/src/config/GameConfig.js` 中定义核心数值常量(REQ-1): MAP_SIZE=14000、SWALLOW_RATIO=1.25、MAX_SPLIT=16、MIN_SPLIT_MASS、MERGE_COOLDOWN=13~30s、EJECT_MASS_UNIT、TICK_RATE=20~30Hz、SEND_RATE=10~20Hz、MAX_ENTITIES_PER_ROOM=64、MAX_AGENTS_PER_PLAYER=1(MVP)
   - [ ]* 1.1 为 Schema 类编写单元测试,验证 Intent/Proposal/Action 字段校验逻辑

- [x] 2. 物理引擎升级 - 核心规则复刻 (REQ-1)
   - [x] 2.1 重构 `Collider.js` 为 `PhysicsEngine.js`,实现 REQ-1 核心物理规则
     - 将吞噬判定逻辑从现有 `_resolveSingleCollision` 修改为:质量 A >= 质量 B * 1.25 且 A 边界覆盖 B 中心才执行吞噬(REQ-1.AC2)
     - 实现质量-半径关系公式 `r = k * sqrt(mass / pi)` (REQ-1.AC1)
     - 实现速度公式 `v = v_max * (mass_min / mass)^a`,a=0.45 可调(REQ-1.AC1)
     - 修改边界处理为 14000x14000 正方形地图,禁止穿越(REQ-1.AC3)
     - 实现分裂逻辑:平均分裂为 2 份,上限 16,有最小可分裂质量阈值(REQ-1.AC5)
     - 实现合并冷却机制:13~30s 可调,冷却过后分裂体可合并回母体(REQ-1.AC6)
     - 实现吐孢子(eject mass):释放固定质量单位孢子(REQ-1.AC7)
     - 实现刺球(virus):地图固定密度分布,超质量阈值碰撞强制分裂(REQ-1)
   - [ ]* 2.2 为物理引擎编写边界值单元测试,验证吞噬比例阈值(1.25)、分裂上限(16)、合并冷却、边界限制

- [x] 3. Action Validator 实现 (REQ-10, CP-3)
   - [x] 3.1 创建 `blob-battle-mvp/server/src/validator/ActionValidator.js`
     - 实现 `validate(agentState, action, tick) -> ValidationResult` 接口(design.md IActionValidator)
     - MoveTo 校验:方向向量归一化且模长 <= 1,拒绝瞬移类幻觉指令(REQ-10.AC5)
     - Split 校验:分裂数 < MAX_SPLIT(16) && mass >= MIN_SPLIT_MASS && 冷却已过(REQ-10.AC6)
     - EjectMass 校验:mass > MIN_EJECT_MASS
     - APM 限制:每个 Agent 每 tick 只能产生一个原子动作(REQ-10.AC3)
     - ValidationResult 包含 valid/rejectedReason/correctedAction
     - 实现 ActionRejected 枚举:MoveToNotNormalized/SplitTooManyParts/SplitBelowMinMass/SplitCoolingDown/EjectBelowMinMass/ApmLimitExceeded
   - [ ]* 3.2 为 ActionValidator 编写穷举边界值测试(TS-4),覆盖:MoveTo 归一化(模长 0/1/>1)、Split 边界(分裂数 16/质量阈值/冷却)、EjectMass 最小质量、APM 多动作拒绝

- [x] 4. 证据链记录与反作弊基础设施 (REQ-10.AC4)
   - [x] 4.1 创建 `blob-battle-mvp/server/src/core/DecisionEvidence.js`
     - 实现 `recordDecisionEvidence(agentId, inputSnapshot, outputAction)` 方法,记录每次关键决策的输入快照+输出动作
     - 每条证据链记录包含:agentId、tick、input(感知快照摘要)、output(AtomicAction)、timestamp
     - 证据链存储为房间级别数组,局结束时可导出用于复盘/调参/反作弊审计
   - [ ]* 4.2 为证据链记录编写测试,验证记录完整性、可回放复现

- [ ] 5. 检查点 - Phase 0 验收
   - 确保物理引擎核心规则(吞噬/分裂/合并/边界/吐孢子)正确运行
   - 确保 ActionValidator 所有校验规则生效
   - 确保证据链可正常记录,如有疑问请询问用户

- [x] 6. 感知快照系统 (REQ-4, design.md PerceptionSnapshot)
   - [x] 6.1 创建 `blob-battle-mvp/server/src/core/PerceptionManager.js`
     - 实现 `getPerceptionSnapshot(agentId) -> PerceptionSnapshot`,基于 Agent 当前质量计算 viewport 半径
     - viewport 半径计算公式与人类玩家视野一致:基于当前质量缩放,禁止全图视野(REQ-4.AC1)
     - 只包含 viewport 内的实体:visibleEntities、visibleFoods、visibleViruses
     - 附加 nearbyTeamBroadcasts(来自 TeamBroadcastChannel)
   - [ ]* 6.2 为感知快照编写测试,验证 Agent 感知范围与人类 viewport 计算公式一致(CP-4)

- [x] 7. Reflex Layer 实现 (REQ-2, REQ-4)
   - [x] 7.1 创建 `blob-battle-mvp/server/src/ai/ReflexLayer.js`
   - [x] 7.2 创建 `blob-battle-mvp/server/src/ai/NoiseInjector.js`
     - 实现拟人化噪声注入(REQ-4):决策延迟 50~150ms 随机抖动(REQ-4.AC2)
     - 路径误差:目标方向加 ±5°~15° 高斯噪声(REQ-4.AC3)
     - APM 上限:每秒最多 N 次分裂/吐孢子指令(REQ-4.AC4)
     - NoiseConfig 按 difficultyLevel 配置:排位模式强制对齐人类水平(REQ-4.AC5)、陪练模式允许调低噪声(REQ-4.AC6)
     - 噪声注入发生在 Reflex 层输出 AtomicAction 之前,记录 original_direction 和 delay_ms
   - [ ]* 7.3 为 Reflex Layer 编写单元测试(TS-1):势场法合力计算、边界避障、紧急分裂逃逸方向、噪声注入参数生效

- [x] 8. Tactical Layer 实现 (REQ-2, REQ-3)
   - [x] 8.1 创建 `blob-battle-mvp/server/src/ai/TacticalLayer.js`
   - [x] 8.2 创建 `blob-battle-mvp/server/src/ai/TacticalPrimitives.js`
   - [x] 8.3 创建 `blob-battle-mvp/server/src/ai/TeamBroadcastChannel.js`
     - 实现 team 广播频道,群聊式发布订阅范式(REQ-6.AC1)
     - `broadcastProposal(agentId, proposal)`:发送 Tactical Proposal 到频道(REQ-6.AC2)
     - `receiveProposals(agentId)`:获取频道内所有未过期提案(REQ-6.AC3)
     - Tactical Layer 根据打分系统决定是否响应,基于 confidence 置信度加权采纳(REQ-6.AC5)
   - [ ]* 8.4 为 Tactical Layer 编写单元测试(TS-2):Utility AI 打分公式权重验证、战术原语角色分配逻辑、置信度加权采纳

- [x] 9. Agent Memory 系统实现 (REQ-7)
   - [x] 9.1 创建 `blob-battle-mvp/server/src/ai/AgentMemory.js`
     - L1 战场短期记忆:滚动覆盖最近 N tick 的感知快照和附近威胁评估(REQ-7.AC1)
     - L2 本局战术记忆:记录关键事件(被偷袭位置、可信队友、对手套路特征)(REQ-7.AC2)
     - L3 跨局玩家偏好记忆接口定义(REQ-7.AC3),MVP 阶段先实现内存版,PostgreSQL 持久化后续迭代
     - L1/L2 存储于内存,L3 MVP 阶段暂存内存+JSON 文件

- [x] 10. 检查点 - Phase 1+2 验收
   - 确保 Reflex Layer Agent(L0)能稳定存活、不卡死、不穿墙
   - 确保 Tactical Layer + Team Broadcast 能产生有效的战术提案和置信度加权采纳
   - 确保 NoiseInjector 参数生效,Agent 行为有拟人化抖动
   - 所有 17 个模块加载验证通过

- [x] 11. Agent Brain 整合 - 三层决策调度器 (REQ-2, REQ-3, REQ-14)
   - [x] 11.1 创建 `blob-battle-mvp/server/src/ai/AgentBrain.js`
     - 整合 ReflexLayer + TacticalLayer + StrategicLayer(预留接口)为统一 AgentBrain
     - AgentTier 枚举:Follower(L0)/CommanderDirected(L1)/TacticalAutonomous(L2)/Persona(L3)(REQ-3)
     - 每个 tick 调度:Reflex(20~30Hz) -> Tactical(事件驱动+0.3~1s心跳) -> Strategic(10~30s心跳+异步)
     - 降级链:Strategic 超时 -> Tactical 用上一个有效目标(REQ-2.AC4);Tactical 卡顿 -> Reflex 继续觅食躲避(REQ-2.AC5)
     - 实现 override 指令抢占:Intent priority=override 时立即打断当前目标(CP-2, REQ-5.AC4)
     - Intent 过期机制:expires_at_tick 到达时自动过期,Agent 回退自主行为(REQ-5.AC5)
   - [ ] 11.2 实现 Agent 生命周期 - 主人淘汰时立即淘汰 (REQ-14)
     - 在吞噬判定中检测主人被淘汰事件
     - 主人淘汰时立即标记名下 Agent 为 eliminated 状态(REQ-14.AC1)
     - 在 Team Broadcast 发送主人淘汰通知(REQ-14.AC2)
     - 下一 tick 清除主人及名下 Agent 实体数据,释放房间实体空间(REQ-14.AC3)

- [x] 12. Intent 指令系统 - 服务端接收与分发 (REQ-5)
   - [x] 12.1 创建 Gateway 层 (`server/src/gateway/Gateway.js`)
     - 新增 proto_id 2002 结构化 Intent 协议 (action + params + priority)
     - 聊天指令关键词解析自动转 Intent (attack/retreat/guard/merge)
     - Intent 鉴权: 只有主人可命令自己的 Agent
     - 团队广播: team_broadcast 目标转 TacticalProposal 分发
     - Intent 确认回执 proto_id 2003 返回客户端
   - [x] 12.2 客户端 Intent 指令 UI
     - 快捷指令按钮: 进攻/撤退/保护我/集合/喂食/诱饵/自由行动
     - 结构化 Intent 发送 (proto_id 2002)
     - Intent 确认回执显示

- [x] 13. GameCore Tick 调度器重构 (REQ-1, REQ-10, REQ-11)
   - [x] 13.1 重构 `GameLoop.js` 为全模块新架构
     - Tick 流程:1.清理被吞噬实体 -> 2.AgentBrain 决策(获取感知快照 -> 三层决策 -> ActionValidator 校验 -> 记录证据链) -> 3.应用玩家输入 -> 4.物理更新 -> 5.食物/Virus 生成 -> 6.网络同步(按 sendRate) -> 7.检查淘汰与游戏结束
     - 所有 Agent 动作经过 ActionValidator 校验后才进入物理结算(REQ-10.AC2)
     - Agent Runtime 与物理 tick 解耦:AgentBrain 产生 AtomicAction 后通过 ActionValidator 进入物理结算
     - 实现断连重连:服务器保留玩家实体 30 秒,期间 Agent 按最后一次指令自主行动(EH-3)

- [x] 14. Interest Management 与网络同步优化 (REQ-11)
   - [x] 14.1 创建 InterestManager.js + 集成到 GameLoop
     - 实现 uniform grid 空间分区(REQ-11.AC2)
     - 每个连接只同步自身 viewport + 缓冲区内的实体增量
     - 增量同步:只发送新出现/消失/显著变化的实体数据
   - [ ] 14.2 实现客户端预测 + 服务器校正 (REQ-11.AC1)
     - 客户端收到服务器状态时插值补帧实现视觉平滑(REQ-11.AC5)
     - 客户端本地预测移动,服务器校正时平滑过渡
   - [ ]* 14.3 为 InterestManager 编写带宽优化测试,验证实体数增长时同步数据量可控

- [x] 15. 检查点 - Phase 2+3 验收
   - 确保 AgentBrain 三层调度器运行稳定,降级链正确(Strategic 超时 -> Tactical 接管 -> Reflex 保底)
   - 确保 ActionValidator 校验所有 Agent 动作,非法动作被拒绝
   - 确保 Intent 指令系统(轮盘/标点/自然语言)正确汇聚为 Intent Schema
   - 确保 Interest Management 带宽优化生效
   - 如有疑问请询问用户

- [x] 16. Strategic Layer - LLM 集成 (REQ-2.AC3, REQ-12)
   - [x] 16.1 StrategicLayer.js (异步调用 + 结果写入 AgentBrain)
   - [x] 16.2 LLMService.js (Claude API 包装 + Prompt 构造 + 降级)
   - [x] 16.3 LLMBudgetManager.js (Agent/房间级别预算控制)
   - [x] 16.4 SemanticCache.js (相似 prompt 结果缓存复用)
   - 注意: 需设置 CLAUDE_API_KEY 环境变量后启用 LLM 调用

- [x] 17. Agent 视觉标识实现 (REQ-8.AC4) 
   - 客户端: Agent 球虚线光晕描边 + AI 标签 + 红色名字

- [x] 18. 断连重连 (EH-3)
   - GameLoop.handlePlayerDisconnect/reconnect
   - 断连 30s 保留实体 + Agent 自主行动
     - 标识为身份透明设计,不做冒充人类的视觉风格

- [ ] 18. 房间系统与匹配基础 (REQ-9)
   - [ ] 18.1 创建 `blob-battle-mvp/server/src/core/RoomManager.js`
     - 房间类型:训练场(training,单人+Agent vs NPC)、FFA(人类+Agent 混合填充)、团队战(team)、观赛/教学(spectate)(REQ-9.AC1-4)
     - Agent 填充策略:房间人类不足时用 L1/L2 Agent 自动填充(REQ-9.AC5)
     - MVP 限制:每位玩家最多 1 个 Agent(REQ-9.AC6, Key Decisions)
     - 房间实体上限溢出处理:接近上限时暂停 Agent 填充和食物生成(EH-5)
   - [ ] 18.2 创建 `blob-battle-mvp/server/src/core/MatchMaker.js`
     - 基础 ELO/Glicko 段位计算(REQ-13.AC1)
     - Agent 战力单独建模并入对局难度评分(REQ-13.AC2)
     - 优先 Agent 填充而非无限等待真人(REQ-9.AC5)

- [x] 19. 检查点 - Phase 3 验收: 所有模块加载 + 集成验证通过

- [x] 20. Agent Tier 切换与人格化 (REQ-3)
   - AgentTier 枚举已在 AgentBrain 中实现(Follower/CommanderDirected/TacticalAutonomous/Persona)
   - L3 Persona 预留接口,等待 LLM 接入

- [x] 21. L3 跨局记忆持久化 (REQ-7.AC3)
   - AgentMemory L3 JSON 文件持久化已实现
   - Strategic 层可通过 MemoryRuntime.getPlayerPreferences 读取

- [x] 22. 最终整合与服务器入口重构
   - [x] 22.1 server-v4.js 整合全部新组件
   - [x] 22.2 package.json 添加 start:v4 / dev:v4 脚本

- [x] 23. 检查点 - 全系统验收: 25 模块全部加载验证通过
