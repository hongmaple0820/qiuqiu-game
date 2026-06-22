# Requirements Document - 移动端优先重构

## Introduction

《共生球域》(Symbiotic Sphere) 是一款基于 Agar.io 玩法的实时多人竞技游戏。核心机制为"主从共生"——每位玩家操控本体球吞食地图上的食物增大体积，同时指挥一名 AI Agent 分身协同作战。当前 MVP 版本使用固定 800x600 Canvas + 鼠标操控，仅适用于桌面浏览器。本需求文档定义移动端（手机/平板）优先的完整重构方案，覆盖从进入游戏到结算退出的全流程。

## Glossary

| 术语 | 定义 |
|------|------|
| **本体 (Master)** | 玩家直接操控的游戏实体，青色球体 |
| **Agent 分身** | AI 驱动的队友实体，遵循玩家指令自主行动，红色球体带 "AI" 标识 |
| **食物 (Food)** | 地图上随机生成的小球，被吞食后增加质量 |
| **刺球 (Virus)** | 地图上的障碍物，碰撞后触发分裂 |
| **虚拟摇杆 (Joystick)** | 触屏上用于控制本体移动方向的虚拟控件 |
| **指令轮盘 (Command Wheel)** | 触屏上用于向 Agent 发送战术指令的环形菜单 |
| **质量 (Mass)** | 球体大小指标，决定半径、速度和视野 |
| **吞噬 (Swallow)** | 当本体/Agent 的质量超过目标 1.25 倍时，可吞噬目标 |
| **同步帧 (Sync Frame)** | 服务端向客户端发送的实体状态快照 |
| **Tick** | 服务端游戏逻辑周期，默认 30Hz |

## Requirements

### REQ-M1: 移动端自适应画布与渲染

**User Story:** AS a mobile player, I want the game canvas to fit my screen perfectly, so that I can play on any device without zooming or scrolling.

#### Acceptance Criteria

1. WHEN the game page loads on a mobile device, the system SHALL set the canvas size to fill the browser viewport (100vw x 100vh).
2. WHEN the device orientation changes, the system SHALL respond by recalculating canvas dimensions within 300ms.
3. WHEN the canvas renders game entities, the system SHALL draw with pixel-ratio-aware scaling (devicePixelRatio >= 2 时使用高清渲染).
4. WHILE rendering each frame, the system SHALL maintain frame rate at or above 30 FPS on devices with A12 Bionic or equivalent performance.

### REQ-M2: 虚拟摇杆触屏操控

**User Story:** AS a mobile player, I want a responsive virtual joystick to control my blob's movement, so that I can play naturally with my thumbs.

#### Acceptance Criteria

1. WHEN a finger touches the left half of the screen, the system SHALL display a virtual joystick centered at the touch point.
2. WHILE the finger drags away from the joystick center, the system SHALL produce a direction vector with magnitude proportional to the drag distance (clamped at 80px radius).
3. WHEN the finger is released, the system SHALL reset the joystick and stop the player's movement on the next sync frame.
4. WHEN a finger touches the right half of the screen, the system SHALL NOT activate the joystick (right side reserved for Agent commands).
5. IF the player is left-handed, the system SHALL support swapping joystick and command zones via a settings toggle.

### REQ-M3: Agent 指令轮盘交互

**User Story:** AS a mobile player, I want to quickly issue tactical commands to my AI agent with a gesture wheel, so that I don't need to type on a small screen.

#### Acceptance Criteria

1. WHEN a finger long-presses (>= 200ms) on the right half of the screen, the system SHALL display a radial command wheel with 4~6 direction-based options.
2. WHEN the finger drags over a wheel sector and releases, the system SHALL dispatch the corresponding Intent command to the server via proto_id 2002.
3. WHILE the wheel is displayed, the system SHALL highlight the active sector under the finger.
4. WHEN a finger performs a quick tap (< 200ms) on the right half, the system SHALL dispatch a default "attack nearest target" command.
5. WHEN a finger double-taps on the right half, the system SHALL dispatch an "emergency retreat" command.

### REQ-M4: 移动端 UI 布局

**User Story:** AS a mobile player, I want the game UI to be arranged ergonomically for thumb access, so that I can see game information without blocking the action.

#### Acceptance Criteria

1. WHILE the game is in progress, the system SHALL display player mass/rank in a top-center bar spanning no more than 10% of screen height.
2. WHILE the game is in progress, the system SHALL display the minimap in the top-right corner sized at 15% of screen width.
3. WHEN the Agent sends feedback, the system SHALL display a transient toast notification at the top of the screen that auto-dismisses after 3 seconds.
4. WHEN a player is eliminated, the system SHALL display a full-screen overlay with elimination reason, survival time, and final rank within 500ms.

### REQ-M5: 快速开局与房间系统

**User Story:** AS a mobile player, I want to start playing within 5 seconds of opening the app, so that I don't waste time in menus.

#### Acceptance Criteria

1. WHEN the game page first loads, the system SHALL display a landing screen with a single prominent "快速开局" button centered on screen.
2. WHEN the "快速开局" button is tapped, the system SHALL connect to the matchmaking queue and enter a game within 5 seconds.
3. WHEN a player is matched, the system SHALL assign the player to a room with 4~10 total players.
4. IF no human opponents are available within 3 seconds, the system SHALL fill the room with AI bots to ensure a playable match.
5. WHILE in the landing screen, the system SHALL support entering a room code to join a friend's game.

### REQ-M6: 断线重连与网络容错

**User Story:** AS a mobile player, I want the game to recover gracefully when my network drops, so that I don't lose progress during subway rides.

#### Acceptance Criteria

1. WHEN the WebSocket connection drops, the system SHALL display a "重新连接中..." overlay within 1 second.
2. WHEN the reconnection succeeds within 30 seconds, the system SHALL restore the player's entity state from the next full sync frame.
3. IF reconnection exceeds 30 seconds, the system SHALL transition to the game-over screen with the message "连接超时，游戏结束".
4. WHILE reconnecting, the system SHALL attempt to reconnect with exponential backoff (1s, 2s, 4s, 8s, max 15s).

### REQ-M7: 游戏结算与战报

**User Story:** AS a mobile player, I want to see my match results and agent performance after each game, so that I know how well I played.

#### Acceptance Criteria

1. WHEN the game ends, the system SHALL display a result screen showing: final rank, survival time, peak mass, eliminations count, and agent's contribution score.
2. WHEN the player taps "再来一局" on the result screen, the system SHALL re-enter the matchmaking queue within 2 seconds.
3. WHEN the player taps "返回大厅" on the result screen, the system SHALL return to the landing screen.
4. WHILE on the result screen, the system SHALL animate the rank display (number counting up to final rank over 1 second).

### REQ-M8: 音效与触觉反馈

**User Story:** AS a mobile player, I want audio and haptic cues that reinforce game actions, so that the game feels more immersive.

#### Acceptance Criteria

1. WHEN the player swallows another entity, the system SHALL play a short "pop" sound effect.
2. WHEN the player is eliminated, the system SHALL play a "game over" sound effect.
3. WHEN the Agent dispatches a command acknowledgment, the system SHALL trigger a haptic vibration (on supported devices).
4. WHILE the joystick is active, the system SHALL play a subtle continuous hum at volume proportional to movement speed.

### REQ-M9: 服务端移动端适配

**User Story:** AS a mobile player, I want the server to handle mobile network conditions gracefully, so that gameplay stays smooth on 4G/5G.

#### Acceptance Criteria

1. WHEN a player connects from a mobile device, the system SHALL reduce the sync send rate to 10Hz (from default 15Hz) to conserve bandwidth.
2. WHEN packet loss is detected for a player, the system SHALL increase entity interpolation buffer by 50ms.
3. WHILE the player is on mobile, the system SHALL prioritize delta sync over full sync, capping full syncs at once per 5 seconds.
4. IF mobile bandwidth drops below 50KB/s estimated, the system SHALL throttle food entity updates to once per 3 ticks.

## Decision Points

| # | 决策项 | 确认方案 | 理由 |
|---|--------|---------|------|
| 1 | 前端技术栈 | 纯 HTML5 Canvas + Vanilla JS | 复用现有渲染/同步模块 |
| 2 | 摇杆样式 | 跟随式（触摸点为中心） | 拇指自然落点，适应不同握姿 |
| 3 | 指令轮盘 | 4 扇区（进攻/撤退/集合/自由行动） | 拇指友好，低误触率 |
| 4 | 房间人数 | 8 人 FFA（含机器人填充） | 快速匹配，足够激烈 |
| 5 | 音效方案 | Web Audio API 程序化音效 + 震动 API | 沉浸感强，加载体积小 |
| 6 | 地图大小 | 8000x8000 | 移动端约 3 分钟横穿，节奏紧凑 |
| 7 | 注册/登录 | 游客模式（随机昵称） | 零摩擦开局 |
