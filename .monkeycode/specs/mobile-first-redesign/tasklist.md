# 实施任务列表 - 移动端优先重构

Feature Name: mobile-first-redesign
Created: 2026-06-22
Total Tasks: 18

---

## Phase A: 服务端基础设施 (4 tasks)

### Task A-1: 创建 MobileGameConfig

创建 `server/src/config/MobileGameConfig.js`，继承 GameConfig 并覆盖移动端特定配置。

- [ ] 地图缩小至 8000x8000
- [ ] MOBILE_SEND_RATE = 10 (Hz)
- [ ] MAX_PLAYERS_PER_ROOM = 8
- [ ] BOT_FILL_MIN = 4（房间最少 fill 至此人数）
- [ ] MATCHMAKING_TIMEOUT = 3000 (ms)
- [ ] 验证: Node.js require 无报错，值正确覆盖

### Task A-2: 实现 RoomManager

创建 `server/src/room/RoomManager.js`，实现房间创建和匹配逻辑。

- [ ] `createRoom(roomId, config)` — 创建房间，注册到 GameLoop
- [ ] `joinMatchmaking(player)` — 加入匹配队列，3s 超时触发房间分配
- [ ] `joinRoomByCode(player, code)` — 通过 6 位字母数字码加入房间
- [ ] `fillWithBots(room, targetCount)` — 填充 AI 机器人至目标人数
- [ ] `getRoomList()` — 返回可加入房间列表
- [ ] `generateRoomCode()` — 生成随机房间码
- [ ] 验证: 3 人 + 5 机器人 = 8 人房间，匹配超时逻辑正确

### Task A-3: Gateway 移动端适配

修改 `server/src/gateway/Gateway.js`，添加移动端协议。

- [ ] 增加 proto_id 9002: 移动端设备信息上报 (screenSize, networkType)
- [ ] `_handleDeviceInfo(playerId, payload)` — 记录设备类型，切换 sendRate
- [ ] 移动端玩家 sendRate 自动降至 10Hz
- [ ] proto_id 9003: 房间码加入请求
- [ ] proto_id 9004: 快速匹配请求
- [ ] 验证: 移动端设备连接后 sendRate=10Hz，桌面端保持 15Hz

### Task A-4: InterestManager 移动优化

修改 `server/src/gateway/InterestManager.js`，移动端网络优化。

- [ ] `setMobileMode(playerId, true)` — 标记移动端玩家
- [ ] 移动端玩家 fullSync 频率上限: 1 次/5 秒
- [ ] 食物更新节流: 移动端每 3 tick 更新一次食物位置
- [ ] 移动端初始 viewport 扩大 20%（补偿小屏幕）
- [ ] 验证: 移动端玩家 sync 日志显示 delta sync 占 >85%

---

## Phase B: 客户端核心架构 (5 tasks)

### Task B-1: 创建 HTML 入口与目录结构

创建 `client-v2/` 目录和新 HTML 入口。

- [ ] 创建 `client-v2/index.html` — 移动端优先 HTML
  - meta viewport: width=device-width, user-scalable=no
  - 触摸事件禁用默认行为 (touch-action: none)
  - 全屏 Canvas (100vw x 100vh)
  - 防止页面滚动/缩放
- [ ] 创建 `client-v2/src/` 目录
- [ ] 创建 `client-v2/css/mobile.css` — 移动端样式
- [ ] 验证: 手机浏览器打开无滚动条，Canvas 覆盖全屏

### Task B-2: 实现 GameShell 状态机

创建 `client-v2/src/GameShell.js`。

- [ ] 状态定义: `landing` / `matchmaking` / `playing` / `gameover` / `reconnecting`
- [ ] `switchState(newState)` — 状态切换时触发对应 enter/exit 钩子
- [ ] 状态机: 各状态下允许的转换路径校验
- [ ] 子模块生命周期: 在 `playing` 状态启动 TouchInput/Renderer/AudioHaptic
- [ ] 验证: 手动触发状态切换，UI 和模块正确响应

### Task B-3: 实现 TouchInput 手势识别

创建 `client-v2/src/TouchInput.js`。

- [ ] 多点触控支持 (最多 2 点同时)
- [ ] 手势类型: `tap` (<200ms, <10px), `longpress` (>=200ms), `pan`, `doubletap`
- [ ] 分区识别: 左半屏(0-45%) / 右半屏(55-100%) / 缓冲(45-55%)
- [ ] 事件发射: `onGesture(type, detail)` 回调
- [ ] 触控区域注册: `registerZone(id, rect)`
- [ ] 验证: 在 Canvas 上绘制触控点位置和手势类型标签

### Task B-4: 实现 MobileRenderer 响应式渲染

创建 `client-v2/src/MobileRenderer.js`。

- [ ] Canvas 自动 resize: 监听 `resize` + `orientationchange`
- [ ] devicePixelRatio 适配: `canvas.width = vw * dpr`, `canvas.style.width = "100vw"`
- [ ] 相机系统: `updateCamera(target)` — lerp 平滑跟随本体
- [ ] 视野缩放: viewport = target.radius * 4
- [ ] 边界 Clamp: 相机不超出地图边缘
- [ ] 实体渲染: 复用现有 rendering 函数，添加 `renderEntity(ctx, entity, viewport)`
- [ ] 网格背景自适应视口
- [ ] 验证: 多个实体在地图上位置正确，相机跟踪顺滑

### Task B-5: 实现 NetworkSync 移动客户端

创建 `client-v2/src/NetworkSync.js`。

- [ ] WebSocket 自动地址: `wss://` if https, else `ws://`
- [ ] 断线重连: 延迟 1s/2s/4s/8s（上限 15s），最多重试 5 次
- [ ] proto_id 9002 上报设备信息
- [ ] 消息路由: 1001(sync) / 2003(ack) / 3001(ai_feedback) / 9001(welcome)
- [ ] 全量/增量同步处理: 复用现有逻辑
- [ ] 心跳机制: 每 15 秒发送 ping，30 秒无响应视为断线
- [ ] 验证: 模拟断网 10 秒后重连，状态恢复

---

## Phase C: 触屏交互组件 (4 tasks)

### Task C-1: 实现 VirtualJoystick

创建 `client-v2/src/VirtualJoystick.js`。

- [ ] 跟随式激活: touchstart 位置设为摇杆中心
- [ ] 外圈半径 60px, 死区 5px
- [ ] 方向输出: `getDirection()` 返回 `{vx, vy, magnitude: 0~1}`
- [ ] 渲染: 半透明圆形底座 + 实心拖拽球
- [ ] 释放动画: 150ms 回弹至中心
- [ ] 验证: 拖拽至 80px 外时 magnitude=1.0

### Task C-2: 实现 CommandWheel 指令轮盘

创建 `client-v2/src/CommandWheel.js`。

- [ ] 长按 >= 200ms 触发显示
- [ ] 4 扇形布局: 进攻(上) / 集合(右) / 撤退(下) / 自由行动(左)
- [ ] 扇形角度: 每扇区 90°, 5°间隙
- [ ] 高亮当前指向扇区
- [ ] 释放触发: `getSelectedAction()` 返回指令
- [ ] 快速点击 (<200ms) 默认进攻
- [ ] 双击 = 紧急撤退
- [ ] 渲染: 半透明扇形 + 图标 Unicode 符号
- [ ] 验证: 在各角度释放，返回正确指令

### Task C-3: 实现 AudioHaptic

创建 `client-v2/src/AudioHaptic.js`。

- [ ] Web Audio API 初始化 (lazy init on first user gesture)
- [ ] `playBeat()` — 振荡器 freq ramp 800->400Hz, gain 0.3, 80ms
- [ ] `playDeath()` — 白噪声 burst, gain 0.5, 300ms, 渐弱
- [ ] `playCommandAck()` — 三角波 600Hz, 100ms
- [ ] `vibrate(pattern)` — navigator.vibrate 封装
- [ ] `setMute(muted)` — 断开/重连 AudioContext
- [ ] 验证: 调用各方法，声音和震动按预期触发

### Task C-4: 实现 UIManager 移动端布局

创建 `client-v2/src/UIManager.js`。

- [ ] `renderTopBar(data)` — 顶部: 当前质量 + 排名 + 第一名昵称
- [ ] `renderMinimap(entities)` — 右上角小地图 (15vw 方形)
- [ ] `showToast(msg)` — 顶部浮动提示，3s 自动消失
- [ ] `showOverlay(type)` — 覆盖层: gameover / reconnecting / landing
- [ ] landing 覆盖层: 快速开局按钮 + 房间码输入 + 设置按钮
- [ ] gameover 覆盖层: 排名 + 存活时间 + 峰值质量 + 击杀数 + 再来一局按钮
- [ ] reconnecting 覆盖层: 重连动画 + 计时器
- [ ] 验证: 各状态覆盖层 UI 正确渲染，按钮触发对应状态切换

---

## Phase D: 整合与入口 (3 tasks)

### Task D-1: 创建 server-v5.js 移动端服务入口

创建 `server/src/server-v5.js`。

- [ ] 集成 RoomManager
- [ ] 使用 MobileGameConfig
- [ ] 复用 BlobBattleV4Server 的核心架构 (GameLoop + Gateway + InterestManager)
- [ ] 新增 proto_id 路由: 9002(设备信息) / 9003(房间码加入) / 9004(快速匹配)
- [ ] 启动时创建默认房间 + fill bots
- [ ] 端口: 8085
- [ ] 验证: 启动成功，日志显示 RoomManager 就绪

### Task D-2: 整合客户端 HTML

更新 `client-v2/index.html`，组装全部组件。

- [ ] 引入所有 JS 模块 (按依赖顺序)
- [ ] GameShell 初始化: 根据 URL hash 选择入口状态
- [ ] landing 页面覆盖层: 快速开局按钮
- [ ] playing 状态: 启动 GameLoop(render) + TouchInput + Joystick + CommandWheel + Audio
- [ ] 摇杆方向实时送服务端 (throttle 50ms)
- [ ] 指令轮盘确认送服务端
- [ ] 验证: 完整加载无 JS 错误

### Task D-3: package.json 脚本更新

更新 `server/package.json`。

- [ ] 添加 `"start:v5": "node server-v5.js"`
- [ ] 添加 `"start:mobile": "node server-v5.js"`
- [ ] 验证: `npm run start:mobile` 启动成功

---

## Phase E: 测试与部署 (2 tasks)

### Task E-1: 集成测试

创建 `server/test/mobile_integration_test.js`。

- [ ] 测试 RoomManager: 匹配超时后自动分房
- [ ] 测试 RoomManager: 机器人填充至目标人数
- [ ] 测试 Gateway: 移动端设备上报切换 sendRate
- [ ] 测试 InterestManager: 移动端玩家 fullSync 限制
- [ ] 测试状态机: landing -> matchmaking -> playing -> gameover 全链路
- [ ] 测试断线重连: 30s 内恢复
- [ ] 测试指令轮盘: 各角度映射正确指令
- [ ] 验证: 全部测试通过

### Task E-2: 部署与预览验证

- [ ] 启动 server-v5.js
- [ ] 生成预览链接
- [ ] 手机实际访问验证: Canvas 全屏、摇杆可用、指令轮盘可用
- [ ] 验证: 手机浏览器可正常对战

---

## 依赖关系

```
A-1(Config) ──> A-2(RoomManager) ──> D-1(server-v5)
A-1 ──> A-3(Gateway) ──> D-1
A-1 ──> A-4(InterestManager) ──> D-1
B-1(HTML) ──> B-2(GameShell) ──> D-2(client HTML)
B-1 ──> B-3(TouchInput)
B-1 ──> B-4(MobileRenderer)
B-3 ──> C-1(Joystick)
B-3 ──> C-2(CommandWheel)
B-4 ──> D-2
B-5(NetworkSync) ──> D-2
C-1 ──> D-2
C-2 ──> D-2
C-3 ──> D-2
C-4 ──> D-2
D-1 ──> D-3(package.json)
D-1 + D-2 ──> E-1(tests)
E-1 ──> E-2(deploy)
```

## 预估代码量

| Phase | 模块 | 预估行数 |
|-------|------|---------|
| A | 服务端 | ~350 |
| B | 客户端核心 | ~700 |
| C | 触屏交互 | ~550 |
| D | 整合入口 | ~250 |
| E | 测试 | ~150 |
| **总计** | | **~2000** |
