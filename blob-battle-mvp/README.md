# 🎮 球球大作战 - Blob Battle MVP

> 一个完整的多人在线竞技游戏实现，支持实时对战、移动端适配和丰富的游戏特性。

## 🎯 项目概述

**球球大作战 MVP** 是一个功能完整的 Web 实时多人游戏原型，复刻了经典"球球大作战"的核心玩法，并添加了多种增强功能。

### 核心特性

- ⚡ **实时多人对战** - WebSocket 低延迟通信
- 📱 **移动端适配** - 虚拟摇杆和触摸按钮
- 🎨 **视觉特效** - 60fps、粒子系统、发光效果
- 🔊 **音效系统** - Web Audio API 程序化音效
- 👥 **团队模式** - 4队对战系统
- 🏆 **段位系统** - 7级段位排名
- 🎨 **皮肤系统** - 10款皮肤，解锁机制
- ⚡ **道具系统** - 4种增益道具

## 📂 文件结构

```
blob-battle-mvp/
├── client/                      # 游戏客户端
│   ├── index-v3.html           # V3 完整版（推荐使用）
│   ├── index-v2.html           # V2 基础版
│   ├── index-enhanced.html     # 增强版（旧）
│   └── audio.js                # 音效系统模块
│
├── server/                      # 游戏服务器
│   ├── server-v3.js            # V3 完整版（推荐使用）
│   ├── server-v2.js            # V2 基础版
│   ├── server-enhanced.js      # 增强版（旧）
│   └── package.json            # 服务器依赖
│
├── docs/                        # 文档目录
│   ├── ARCHITECTURE.md         # 架构文档（计划中）
│   └── API.md                  # API 文档（计划中）
│
├── package.json                 # 项目依赖
├── start.sh                    # Mac/Linux 启动脚本
├── start-v2.sh                 # V2 启动脚本
├── README-ENHANCED.md          # V2 增强版说明
├── README_GAME.md            # 游戏说明（旧）
├── PHASE2_SUMMARY.md         # 阶段2总结
├── PHASE3_COMPLETE.md        # 阶段3完成报告
└── PHASE3_SUMMARY.md         # 阶段3总结
```

## 🚀 快速启动

### 方式一：使用启动脚本（推荐）

```bash
# Mac/Linux
./start.sh

# 手动执行
./start-v2.sh
```

### 方式二：手动启动

```bash
# 1. 安装依赖
npm install

# 2. 启动服务器
cd server
npm install
node server-v3.js

# 3. 启动客户端（新终端）
cd ../client
npx serve -p 8083

# 4. 访问游戏
open http://localhost:8083/index-v3.html
```

## 🎮 游戏版本说明

| 版本 | 文件 | 状态 | 特性 |
|------|------|------|------|
| V3 | `index-v3.html` + `server-v3.js` | ✅ 推荐 | 完整功能：音效、移动端、团队模式、段位、道具 |
| V2 | `index-v2.html` + `server-v2.js` | ⚠️ 兼容 | 基础功能：分裂、合并、Bot |
| Enhanced | `index-enhanced.html` | ❌ 废弃 | 旧版本，不建议使用 |

**建议：使用 V3 版本获得最佳体验。**

## 📋 功能详解

### V3 版本新增功能

#### 🎨 视觉增强
- **60fps 渲染**：基于 requestAnimationFrame 的高性能循环
- **插值动画**：客户端插值平滑过渡服务器状态
- **粒子系统**：吃掉食物时的爆炸特效
- **发光效果**：玩家球体发光和阴影渲染
- **平滑视角**：相机跟随玩家平滑移动

#### 🔊 音效系统 (`audio.js`)
```javascript
// 音效类型
AudioSystem.sounds.eat      // 吃食物音效
AudioSystem.sounds.split    // 分裂音效
AudioSystem.sounds.eject    // 吐孢子音效
AudioSystem.sounds.powerup  // 道具音效
AudioSystem.sounds.levelup  // 升级音效
```

#### 📱 移动端支持
```html
<!-- 虚拟摇杆 -->
<div id="joystickZone">
  <div id="joystickBase"></div>
  <div id="joystick"></div>
</div>

<!-- 触摸按钮 -->
<button id="mobileSplit">⚡</button>
<button id="mobileEject">💫</button>
```

#### 👥 团队模式
```javascript
// 4个队伍
const TEAMS = {
  red:    { name: '红队', color: '#ff4444', spawnX: 500,  spawnY: 750 },
  blue:   { name: '蓝队', color: '#4444ff', spawnX: 1500, spawnY: 750 },
  green:  { name: '绿队', color: '#44ff44', spawnX: 1000, spawnY: 500 },
  yellow: { name: '黄队', color: '#ffff44', spawnX: 1000, spawnY: 1000 }
};
```

#### ⚡ 道具系统
```javascript
const POWERUPS = {
  speed:  { name: '加速', color: '#00ff00', duration: 5000, effect: 1.5 },
  shield: { name: '护盾', color: '#0088ff', duration: 3000, effect: 1 },
  magnet: { name: '磁力', color: '#ff00ff', duration: 4000, effect: 2 },
  grow:   { name: '生长', color: '#ff8800', duration: 100,  effect: 1.2 }
};
```

#### 🏆 段位系统
```javascript
const TIERS = {
  bronze:  { name: '青铜', minScore: 0,    icon: '🥉' },
  silver:  { name: '白银', minScore: 100,  icon: '🥈' },
  gold:    { name: '黄金', minScore: 300,  icon: '🥇' },
  platinum:{ name: '铂金', minScore: 600,  icon: '💎' },
  diamond: { name: '钻石', minScore: 1000, icon: '👑' },
  master:  { name: '大师', minScore: 1500, icon: '🔥' },
  king:    { name: '王者', minScore: 2000, icon: '👑' }
};
```

## 🔧 开发文档

### 通信协议

#### 客户端 → 服务器

| proto_id | 动作 | 数据 |
|----------|------|------|
| 1001 | 移动 | `{x, y}` |
| 1002 | 分裂 | `{}` |
| 1003 | 吐孢子 | `{angle}` |
| 1004 | 发送消息 | `{message}` |
| 1005 | 选择队伍 | `{team}` |
| 1006 | 选择皮肤 | `{skin_id}` |

#### 服务器 → 客户端

| proto_id | 动作 | 数据 |
|----------|------|------|
| 2001 | 游戏状态 | `{entities, foods, ejectedMasses}` |
| 2002 | 排行榜 | `{players}` |
| 2003 | 玩家消息 | `{sender, message}` |
| 7001 | 道具获得 | `{player_id, powerup_type}` |
| 7002 | 段位升级 | `{player_id, old_tier, new_tier}` |

### 配置参数

```javascript
// server-v3.js
const CONFIG = {
  PORT: 8082,
  MAP_WIDTH: 2000,
  MAP_HEIGHT: 1500,
  FOOD_COUNT: 150,
  BOT_COUNT: 8
};

// index-v3.html
const CONFIG = {
  serverUrl: 'ws://localhost:8082'  // 或自动检测
};
```

## 🐛 调试

```bash
# 查看服务器日志
tail -f server.log

# 浏览器开发者工具
# 1. 按 F12 打开
# 2. Console 查看日志
# 3. Network → WS 查看 WebSocket 消息
```

## 📝 更新日志

### V3.0 (2024-06-12)
- ✅ 添加 60fps 流畅渲染和插值动画
- ✅ 实现音效系统（Web Audio API）
- ✅ 添加移动端虚拟摇杆和触摸按钮
- ✅ 实现团队模式（4队对战）
- ✅ 添加段位系统（青铜到王者）
- ✅ 实现皮肤发光和粒子特效
- ✅ 添加道具系统（4种道具）
- ✅ 实现平滑视角跟随
- ✅ 添加分裂后自动合并机制
- ✅ 优化碰撞检测和边界限制

### V2.0 (2024-06-09)
- ✅ 基础游戏框架
- ✅ WebSocket 实时通信
- ✅ 分裂/吐孢子机制
- ✅ AI Bot 系统
- ✅ 排行榜系统

## 📞 支持

如有问题，请提交 [GitHub Issue](https://github.com/hongmaple0820/qiuqiu-game/issues)。

---

<p align="center">
  Made with ❤️ by 鸿枫
</p>
