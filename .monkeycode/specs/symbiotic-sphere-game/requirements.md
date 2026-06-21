# Requirements Document - Symbiotic Sphere (共生球域)

## Introduction

Symbiotic Sphere 是一款基于经典球球大作战(Agar.io-like)玩法的实时多人竞技游戏,核心创新在于引入"主从共生"机制:每位人类玩家可指挥 1~3 个 AI Agent 伙伴协同作战,多个 Agent 之间具备战术协商能力。系统采用三层决策架构(Reflex/Tactical/Strategic)解决实时游戏与 LLM 推理延迟之间的核心矛盾。

## Glossary

- **Cell**: 游戏中的球形实体,包括玩家球、Agent 球、食物、刺球等
- **Mass**: 球的质量,决定半径和速度
- **Agent**: AI 控制的球实体,作为人类的协作伙伴
- **Reflex Layer**: 反射层,每个物理 tick(20~30Hz)触发,负责寻路/避障/紧急分裂逃逸/自动吃临近食物,纯本地确定性代码
- **Tactical Layer**: 战术层,事件驱动+心跳(0.3~1s)触发,负责目标选择、战术原语执行、队内协商,本地 Utility AI 打分系统
- **Strategic Layer**: 策略层,人类自然语言指令/心跳(10~30s)触发,负责 NLU 意图解析、长期策略调整、人格化对话反馈,LLM 异步调用
- **Intent**: 结构化的指令 Schema,由三种输入方式(快捷轮盘/点选标记/自然语言)汇聚后统一喂给 Tactical 层
- **Tactical Proposal**: Agent 广播的战术提案,包含提案类型、角色分配和置信度
- **Atomic Action**: 经过校验器验证的原子动作(MoveTo/Split/EjectMass/Idle),是进入物理结算的唯一合法输入
- **Interest Management**: 基于 uniform grid 的空间分区,每个连接只同步自身视野+缓冲区内的实体增量
- **ECS**: Entity-Component-System 架构,游戏仿真核心的组织方式
- **Action Validator**: 动作校验器,对所有动作(包括 Agent 输出)进行合法性验证,防止 LLM 幻觉指令或外部输入篡改

## Requirements

### REQ-1: 核心游戏物理与吞噬规则

**User Story:** AS 玩家, I want 在一个固定大小的地图上控制球移动并吞噬食物和其他球来增大质量, so that 我可以体验球球大作战的核心玩法循环。

#### Acceptance Criteria

1. WHEN 球移动, THE 系统 SHALL 按照 `v = v_max * (mass_min / mass)^a` (a 约 0.4~0.5) 公式计算移动速度,越大的球移动越慢
2. WHILE 球 A 的质量 >= 球 B 质量 * 1.25 且 球 A 边界覆盖球 B 中心, THE 系统 SHALL 执行吞噬判定,球 A 吞食球 B 并获得球 B 的全部质量
3. WHEN 球触达地图边界(14000x14000 正方形), THE 系统 SHALL 限制球在边界内,禁止穿越
4. IF 球的质量低于最小分裂质量阈值, THE 系统 SHALL 拒绝分裂操作
5. WHEN 球执行分裂, THE 系统 SHALL 将球平均分裂为 2 份,单玩家分裂体上限为 16
6. WHILE 分裂体存在且合并冷却(13~30 秒可调)已过, THE 系统 SHALL 允许分裂体合并回母体
7. WHEN 球执行吐孢子(eject mass), THE 系统 SHALL 释放固定质量单位的孢子,孢子可用于喂养队友/Agent 或作诱饵

### REQ-2: Agent 三层决策架构

**User Story:** AS 系统, I want 为每个 Agent 维护独立的三层决策架构(Reflex/Tactical/Strategic), so that Agent 在 LLM 服务超时或不可用时仍能正常运作,不会导致游戏卡顿或 Agent 死机站桩。

#### Acceptance Criteria

1. WHILE 物理 tick 运行(20~30Hz), THE Reflex 层 SHALL 使用势场法(potential field)steering 计算移动方向,纯本地确定性代码执行,零外部网络依赖
2. WHEN 事件触发(发现敌人/队友求援)或心跳周期(0.3~1s)到达, THE Tactical 层 SHALL 使用 Utility AI 打分系统评估目标选择,本地执行零外部网络依赖
3. WHEN 人类自然语言指令到达或心跳周期(10~30s)到达, THE Strategic 层 SHALL 异步调用 LLM API 解析意图,不阻塞物理 tick
4. IF Strategic 层超时或失败, THE Tactical 层 SHALL 使用上一个有效目标继续运行
5. IF Tactical 层卡顿或不可用, THE Reflex 层 SHALL 继续执行基本觅食和躲避行为
6. WHILE 任何上层输出中断, THE 下层 SHALL 独立运转,保证 Agent 不会出现"死机站桩"

### REQ-3: Agent 分级与自主度

**User Story:** AS 玩家, I want 根据自身水平和场景选择 Agent 的自主度级别(L0/L1/L2/L3), so that 萌新玩家有安全垫保护,进阶玩家有战术协作,付费玩家有情感联结。

#### Acceptance Criteria

1. WHEN Agent 级别为 L0(跟随型 Follower), THE Agent SHALL 执行纯规则驱动的贴身护卫行为,自主度极低
2. WHILE Agent 级别为 L1(指令型 Commander-directed), THE Agent SHALL 按预设指令/轮盘执行行为,无指令时回退跟随
3. WHILE Agent 级别为 L2(战术自主型 Tactical Autonomous), THE Agent SHALL 基于战场状态和团队广播执行感知-记忆-决策闭环,主动建议战术
4. WHILE Agent 级别为 L3(人格化型 Persona Agent), THE Agent SHALL 在 L2 基础上叠加性格与跨局玩家偏好记忆,提供人格化对话反馈
5. WHEN 玩家通过"升级指令权限"操作, THE 系统 SHALL 将 Agent 从 L1 切换到 L2(更聪明但算力成本更高)

### REQ-4: 感知公平性约束

**User Story:** AS 竞技玩家, I want Agent 的感知范围和反应速度与同等质量的人类玩家一致, so that 游戏不会出现"Agent 开了透视挂"或"机器人霸场"的体验崩盘。

#### Acceptance Criteria

1. WHILE Agent 感知战场信息, THE Agent 的感知范围 SHALL 与同等质量的人类玩家视野一致(基于当前质量缩放的 viewport),禁止全图视野
2. WHEN Agent 执行 Reflex 层决策, THE 系统 SHALL 注入 50~150ms 随机决策延迟,模拟人类反应时间
3. WHILE Agent 计算移动路径, THE 系统 SHALL 在目标方向加 ±5°~15° 高斯噪声,避免轨迹过于机械完美
4. WHEN Agent 触发分裂/吐孢子指令, THE Agent 的 APM SHALL 限制为每秒最多 N 次,与人类操作频率上限对齐
5. IF 排位模式启用, THE 系统 SHALL 强制对齐拟人化噪声参数到人类水平,不允许降低噪声
6. WHILE 陪练模式启用, THE 系统 SHALL 允许调低拟人化噪声参数,降低 Agent 表现

### REQ-5: 指令协议与人机交互

**User Story:** AS 玩家, I want 通过快捷指令轮盘、点选标记(ping)和自然语言三种方式指挥 Agent, so that 我在实时对局中可以高效地与 Agent 协作,无需打长句文字。

#### Acceptance Criteria

1. WHEN 玩家通过快捷指令轮盘选择预设 intent, THE 系统 SHALL 将选择转换为结构化 Intent Schema 并传递给 Tactical 层
2. WHEN 玩家通过点选标记(ping)选择地图/实体+动词, THE 系统 SHALL 组合为结构化 Intent Schema 并传递给 Tactical 层
3. WHEN 王家通过自然语言(语音转文字/赛前文字)输入策略级指令, THE 系统 SHALL 将文本传递给 Strategic 层进行 NLU 意图解析,输出结构化 Intent
4. WHEN Intent Schema 的 priority 字段为 "override", THE Tactical 层 SHALL 立即打断当前目标,抢占执行人类指令
5. WHILE Intent 的 expires_at_tick 到达, THE 系统 SHALL 自动过期该指令,Agent 回退自主行为
6. WHEN Intent 生成, THE 系统 SHALL 在 natural_language_echo 字段回显人类可理解的意图描述

### REQ-6: 多 Agent 协作协议

**User Story:** AS 团队玩家, I want 我的多个 Agent 和队友之间能够通过广播频道协商战术而非强制服从, so that 协作不会变成"一条龙送人头"的僵硬脚本。

#### Acceptance Criteria

1. WHILE 同队成员(人类+Agent)存在, THE 系统 SHALL 维护一个 team 广播频道,采用群聊式发布订阅范式
2. WHEN Agent 生成战术提案, THE Agent SHALL 在 team 广播频道广播 Tactical Proposal,包含提案类型、角色分配和置信度
3. WHEN 其他成员收到 Tactical Proposal, THE Tactical 层 SHALL 根据自身打分系统决定是否响应,基于置信度加权采纳
4. THE 系统 SHALL 提供标准战术原语库: pincer_attack(夹击)、bait(诱饵)、merge_rally(合体冲锋)、feed(投喂)、screen(掩护)
5. WHEN Tactical Proposal 的 confidence 字段为低置信度, THE Tactical 层 SHALL 降低采纳权重,避免协作僵化

### REQ-7: Agent 记忆系统

**User Story:** AS 玩家, I want 我的 Agent 能记住近期战场态势、本局关键事件和跨局的指令偏好, so that Agent 的行为会随时间越来越贴合我的风格,产生养成感。

#### Acceptance Criteria

1. WHILE Agent 运行, THE L1 战场短期记忆(数秒) SHALL 滚动覆盖最近 N tick 的感知快照和附近威胁评估,存储于内存
2. WHEN 本局关键事件发生(被偷袭/可信队友识别/对手套路特征), THE L2 本局战术记忆 SHALL 记录事件,局结束归档或丢弃,存储于内存+局末快照落库
3. WHILE Agent 跨局运行, THE L3 跨局玩家偏好记忆 SHALL 持久保存主人的指令习惯、偏好打法(激进/保守)、常用战术组合,存储于 PostgreSQL
4. WHEN Strategic 层读取跨局玩家偏好, THE Agent 的默认行为 SHALL 校准为主人风格,无需每局重新教

### REQ-8: Agent 拟人化与公平性治理

**User Story:** AS 产品运营者, I want Agent 的操作风格既不像机械死板的"智障",也不像完美无瑕的"开挂", so that 盲测识别率维持在 40%~70% 区间,保证竞技公平与用户体验。

#### Acceptance Criteria

1. THE 系统 SHALL 建立盲测识别率指标作为验收标准,邀请测试玩家在一局结束后猜测哪些球是 Agent 控制
2. WHILE 盲测识别率低于 40%, THE 系统 SHALL 提示 Agent 行为僵硬死板,需要增加拟人化噪声
3. WHILE 盲测识别率高于 70%, THE 系统 SHALL 提示 Agent 行为过于完美,可能引发不公平质疑,需要增加拟人化噪声限制
4. THE Agent 控制的球 SHALL 具有清晰的视觉标识(图标/描边),标识身份透明,不做冒充人类的设计

### REQ-9: 多人对战与房间系统

**User Story:** AS 玩家, I want 在不同类型的房间(训练场/FFA/团队战/观赛)中与人类和 Agent 混合对战, so that 我可以选择适合自己的游戏模式。

#### Acceptance Criteria

1. WHEN 玩家进入训练场模式, THE 系统 SHALL 允许单人+自己的 Agent 小队 vs NPC 对战
2. WHEN 玩家进入个人混战 FFA 模式, THE 系统 SHALL 用 L1/L2 Agent 自动填充人数不足的房间,保证空间密度与对局节奏
3. WHEN 玩家进入团队战模式, THE 系统 SHALL 允许人类+专属 Agent 混编组队
4. WHEN 玩家进入观赛/教学模式, THE 系统 SHALL 展示高水平 Agent 打法供学习
5. WHILE 房间人类玩家不足, THE 匹配系统 SHALL 优先用 Agent 填充而非无限等待真人
6. WHEN MVP 阶段, THE 系统 SHALL 限制每位玩家最多 1 个 Agent,验证核心体验后再开放到 2~3 个

### REQ-10: 服务端权威仿真与反作弊

**User Story:** AS 系统管理员, I want 所有游戏结算(吞噬判定/分裂/碰撞)在服务端权威完成, so that 客户端不可信,防止作弊和 LLM 幻觉指令。

#### Acceptance Criteria

1. THE 系统 SHALL 在服务端完成所有结算(吞噬判定、分裂、碰撞),客户端只发送输入/指令
2. WHEN Agent(任何层级)输出动作, THE 动作 SHALL 经过统一的原子动作校验器(Action Validator)验证后才进入物理结算
3. IF 动作校验器检测到非法动作(如瞬移坐标/超出分裂上限/违反 APM 限制), THE 系统 SHALL 拒绝该动作
4. THE 系统 SHALL 记录每次关键决策的输入快照+输出动作作为可验证的证据链,用于复盘/调参/反作弊审计
5. WHEN MoveTo 动作到达, THE 校验器 SHALL 验证方向向量归一化且模长 <= 1,杜绝瞬移类幻觉指令
6. WHEN Split 动作到达, THE 校验器 SHALL 验证分裂数 < MAX_SPLIT(16) 且 mass >= MIN_SPLIT_MASS 且冷却已过

### REQ-11: 网络同步与带宽优化

**User Story:** AS 系统架构师, I want 在 Agent 填充导致房间实体数膨胀的情况下保持带宽可控, so that 大规模房间不会因同步数据量拖垮网络。

#### Acceptance Criteria

1. THE 系统 SHALL 使用客户端预测+服务器校正的同步策略(类似 FPS 的连续移动同步)
2. THE 系统 SHALL 使用 Interest Management(uniform grid 分区),每个连接只同步自身视野+缓冲区内的实体增量
3. WHILE MVP 阶段, THE 系统 SHALL 使用 WebSocket(TCP)起步,兼容性优先
4. WHILE Beta 阶段, THE 系统 SHALL 评估迁移到 WebTransport(QUIC/UDP)以降低延迟
5. THE 状态同步频率 SHALL 为 10~20Hz,客户端使用插值补帧实现视觉平滑

### REQ-12: LLM 调用成本控制

**User Story:** AS 产品运营者, I want LLM 调用成本随 DAU 增长可控, so that 不拖垮利润模型。

#### Acceptance Criteria

1. THE Agent Runtime SHALL 与 Game Core 物理上解耦(独立服务或独立异步任务池),避免 LLM 调用阻塞物理 tick
2. THE Strategic 层 SHALL 使用能力更强的模型(如 Sonnet 量级),Tactical 层若需语义理解 SHALL 使用轻量快模型(如 Haiku 量级)
3. WHEN 每个 Agent 的 Strategic 调用预算耗尽(每分钟最多 N 次), THE 系统 SHALL 拒绝额外调用直到预算刷新
4. WHEN 房间级别的总 LLM 调用预算耗尽, THE 系统 SHALL 拒绝该房间所有额外 LLM 调用
5. THE 系统 SHALL 使用 Prompt Caching 缓存 Agent 人格设定、规则约束等固定系统提示词,降低重复调用成本
6. THE 系统 SHALL 使用语义缓存复用相似战场局面/相似指令的解析结果,减少重复推理
7. IF LLM 超时或失败, THE Agent SHALL 立即回退到上一个有效目标或默认 Tactical 规则,禁止卡死等待 LLM 返回
8. WHEN 同房间多个 Agent 的 Strategic 决策在同一心跳周期内, THE 系统 SHALL 合并为批量调用,降低整体调用开销

### REQ-13: 段位与匹配系统

**User Story:** AS 竞技玩家, I want 在公平的段位匹配系统中与实力相当的对手对战, so that 游戏体验不会因实力差距过大而失衡。

#### Acceptance Criteria

1. THE 系统 SHALL 使用 ELO/Glicko 类匹配算法进行段位计算
2. WHEN 匹配对局, THE Agent 战力 SHALL 单独建模并入对局难度评分
3. THE 系统 SHALL 禁止战力付费(pay-to-win),保证竞技公平性
4. THE Agent 外观皮肤、语音包、人格模板 SHALL 为外观/情感向付费内容,不涉及战力

### REQ-14: Agent 生命周期 - 主人淘汰时立即淘汰

**User Story:** AS 系统设计者, I want 当人类主人被淘汰时其名下 Agent 立即同步淘汰, so that 规则简单清晰,无额外平衡负担,适合 MVP。

#### Acceptance Criteria

1. WHEN 人类主人被吞噬或淘汰, THE 系统 SHALL 立即将其名下所有 Agent 标记为淘汰状态,与主人同步退出游戏
2. WHILE 主人淘汰事件触发, THE 系统 SHALL 在 Team 广播频道发送主人淘汰通知,其他团队成员可调整战术
3. THE 系统 SHALL 在主人淘汰后的下一 tick 清除主人及名下 Agent 的所有实体数据,释放房间实体空间

## Key Decisions (已确认)

| 决策项 | 结论 | 说明 |
|--------|------|------|
| 人类主人淘汰后 Agent 处理 | 立即淘汰 | 规则简单清晰,降低平衡设计复杂度,适合 MVP |
| 首发平台 | Web(WebSocket) | 兼容性优先,后续评估迁移 WebTransport |
| MVP 每位玩家 Agent 数量 | 1 个 | 算力成本可控,核心体验验证后再开放 2~3 个 |
| LLM 调用架构 | 云端 API | 通过预算限流/语义缓存/Prompt Caching/批处理控制成本 |
