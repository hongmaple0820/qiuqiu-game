# 🔌 Blob Battle API 文档

> 球球大作战通信协议规范

## 目录

1. [协议概述](#协议概述)
2. [消息格式](#消息格式)
3. [客户端 → 服务器](#客户端--服务器)
4. [服务器 → 客户端](#服务器--客户端)
5. [错误处理](#错误处理)
6. [示例代码](#示例代码)

## 协议概述

### 通信协议

- **传输层**: WebSocket (ws/wss)
- **消息格式**: JSON
- **编码**: UTF-8
- **心跳**: 客户端发送 `ping`，服务器响应 `pong`

### 连接信息

```javascript
const CONFIG = {
  // 开发环境
  dev: 'ws://localhost:8082',
  
  // 预览环境 (自动检测)
  preview: 'wss://{hostname}'
}
```

## 消息格式

### 通用消息结构

```typescript
interface Message {
  proto_id: number;    // 协议ID
  data?: any;           // 消息数据
  timestamp?: number;   // 时间戳（服务器发送时包含）
}
```

### 消息分类

| 范围 | 类型 | 说明 |
|------|------|------|
| 1001-1999 | 客户端 → 服务器 | 玩家操作指令 |
| 2001-2999 | 服务器 → 客户端 | 游戏状态广播 |
| 3001-3999 | 服务器 → 客户端 | 玩家事件通知 |
| 7001-7999 | 服务器 → 客户端 | 系统通知 |

## 客户端 → 服务器

### 1001 - 移动指令

玩家移动方向控制。

**请求:**
```json
{
  "proto_id": 1001,
  "data": {
    "x": 500.5,      // 目标 X 坐标
    "y": 750.3       // 目标 Y 坐标
  }
}
```

**说明:**
- 发送频率: 建议 20Hz (50ms 间隔)
- 服务器根据坐标计算移动角度
- 球会自动向目标方向移动

**示例:**
```javascript
function sendMove(x, y) {
  ws.send(JSON.stringify({
    proto_id: 1001,
    data: { x, y }
  }));
}
```

---

### 1002 - 分裂

将球分裂成两个。

**请求:**
```json
{
  "proto_id": 1002,
  "data": {}
}
```

**说明:**
- 冷却时间: 无
- 分裂后每个球质量为原球的一半
- 分裂后 5 秒自动合并
- 最小分裂质量: 20

---

### 1003 - 吐孢子

吐出孢子攻击或加速。

**请求:**
```json
{
  "proto_id": 1003,
  "data": {
    "angle": 1.5708    // 吐出角度 (弧度)
  }
}
```

**说明:**
- `angle`: 吐出方向，0 = 右，π/2 = 下，π = 左，-π/2 = 上
- 吐出质量: 当前质量的 5%
- 吐出后会获得反冲加速
- 孢子 5 秒后消失或被吃掉

**示例:**
```javascript
function sendEject(angle) {
  ws.send(JSON.stringify({
    proto_id: 1003,
    data: { angle }
  }));
}
```

---

### 1004 - 发送消息

发送聊天消息或快捷指令。

**请求:**
```json
{
  "proto_id": 1004,
  "data": {
    "message": "保护我"
  }
}
```

**快捷指令:**
| 指令 | 说明 |
|------|------|
| "保护我" | 请求队友保护 |
| "进攻" | 发起进攻 |
| "集合" | 召集队友 |

---

### 1005 - 选择队伍

选择游戏队伍（仅限团队模式）。

**请求:**
```json
{
  "proto_id": 1005,
  "data": {
    "team": "red"     // 队伍: red/blue/green/yellow
  }
}
```

**说明:**
- 如果不发送，服务器自动分配
- 团队模式下必须使用队伍颜色皮肤

---

### 1006 - 选择皮肤

选择玩家皮肤。

**请求:**
```json
{
  "proto_id": 1006,
  "data": {
    "skin_id": "gold"   // 皮肤ID
  }
}
```

**可用皮肤:**
| skin_id | 名称 | 解锁条件 |
|---------|------|----------|
| blue | 经典蓝 | 默认 |
| red | 热情红 | 默认 |
| green | 自然绿 | 默认 |
| purple | 神秘紫 | 默认 |
| yellow | 阳光黄 | 默认 |
| orange | 活力橙 | 默认 |
| gold | 黄金传说 | 达到50质量 |
| rainbow | 彩虹渐变 | 连续登录7天 |
| dark | 暗黑骑士 | 吃掉10个Bot |
| ice | 冰雪女王 | 累计练习100分钟 |

---

### 1007 - 初始化玩家

新玩家连接后发送初始化信息。

**请求:**
```json
{
  "proto_id": 1007,
  "data": {
    "name": "Player-1",    // 玩家名称
    "skin_id": "blue"      // 皮肤ID
  }
}
```

**响应:**
服务器返回玩家初始状态和实体ID。

---

## 服务器 → 客户端

### 2001 - 游戏状态

游戏完整状态广播。

**响应:**
```json
{
  "proto_id": 2001,
  "data": {
    "entities": [
      {
        "entity_id": "player_abc123",
        "type": "master",
        "x": 500.5,
        "y": 750.3,
        "radius": 45.2,
        "color": "#4ecdc4",
        "name": "Player-1",
        "team": "red",
        "vx": 2.5,
        "vy": 1.2
      }
    ],
    "foods": [
      {
        "entity_id": "food_xyz789",
        "x": 300.2,
        "y": 400.5,
        "radius": 5.5,
        "color": "#ffe66d"
      }
    ],
    "ejectedMasses": [
      {
        "entity_id": "eject_def456",
        "x": 550.1,
        "y": 760.2,
        "radius": 8,
        "color": "#ff9ff3"
      }
    ],
    "powerups": [
      {
        "entity_id": "powerup_ghi789",
        "type": "speed",
        "x": 600.3,
        "y": 800.5,
        "radius": 15,
        "color": "#00ff00"
      }
    ]
  },
  "timestamp": 1718160000000
}
```

**说明:**
- 发送频率: 10Hz (100ms)
- `entities`: 包含玩家、Bot、分裂球
- `vx`, `vy`: 速度矢量，用于客户端插值

---

### 2002 - 排行榜

当前排行榜数据。

**响应:**
```json
{
  "proto_id": 2002,
  "data": {
    "players": [
      {
        "name": "Player-1",
        "mass": 45.2,
        "team": "red",
        "tier": "silver"
      },
      {
        "name": "Bot-4f2a",
        "mass": 38.7,
        "team": "blue",
        "tier": "bronze"
      }
    ],
    "team_scores": {
      "red": 156,
      "blue": 142,
      "green": 98,
      "yellow": 87
    }
  }
}
```

**说明:**
- 发送频率: 2Hz (500ms)
- 按质量降序排列
- 团队模式下包含 team_scores

---

### 2003 - 玩家消息

其他玩家发送的聊天消息。

**响应:**
```json
{
  "proto_id": 2003,
  "data": {
    "sender": "Player-2",
    "message": "保护我",
    "team": "red"
  }
}
```

---

### 3001 - 玩家死亡

玩家被吃掉通知。

**响应:**
```json
{
  "proto_id": 3001,
  "data": {
    "player_id": "player_abc123",
    "killed_by": "Bot-4f2a",
    "score": 45.2,
    "survival_time": 120.5
  }
}
```

---

### 3002 - 玩家重生

玩家重生通知。

**响应:**
```json
{
  "proto_id": 3002,
  "data": {
    "player_id": "player_abc123",
    "x": 500,
    "y": 750,
    "mass": 20
  }
}
```

---

### 7001 - 道具获得

玩家获得道具通知。

**响应:**
```json
{
  "proto_id": 7001,
  "data": {
    "player_id": "player_abc123",
    "powerup_type": "speed",
    "powerup_name": "加速",
    "duration": 5000
  }
}
```

**道具类型:**
| type | name | duration | effect |
|------|------|----------|--------|
| speed | 加速 | 5000ms | 速度 x1.5 |
| shield | 护盾 | 3000ms | 免疫一次吞噬 |
| magnet | 磁力 | 4000ms | 吸附范围 x2 |
| grow | 生长 | 100ms | 质量 x1.2 |

---

### 7002 - 段位升级

玩家段位提升通知。

**响应:**
```json
{
  "proto_id": 7002,
  "data": {
    "player_id": "player_abc123",
    "old_tier": "bronze",
    "new_tier": "silver",
    "score": 120
  }
}
```

**段位列表:**
| tier | name | min_score | icon |
|------|------|-----------|------|
| bronze | 青铜 | 0 | 🥉 |
| silver | 白银 | 100 | 🥈 |
| gold | 黄金 | 300 | 🥇 |
| platinum | 铂金 | 600 | 💎 |
| diamond | 钻石 | 1000 | 👑 |
| master | 大师 | 1500 | 🔥 |
| king | 王者 | 2000 | 👑 |

---

### 7003 - 连接成功

初始连接成功通知。

**响应:**
```json
{
  "proto_id": 7003,
  "data": {
    "player_id": "player_abc123",
    "x": 500,
    "y": 750,
    "map": {
      "width": 2000,
      "height": 1500
    },
    "teams": {
      "red": { "name": "红队", "color": "#ff4444" },
      "blue": { "name": "蓝队", "color": "#4444ff" },
      "green": { "name": "绿队", "color": "#44ff44" },
      "yellow": { "name": "黄队", "color": "#ffff44" }
    }
  }
}
```

---

### 7004 - 玩家加入

新玩家加入游戏通知。

**响应:**
```json
{
  "proto_id": 7004,
  "data": {
    "player_id": "player_def456",
    "name": "Player-2",
    "team": "blue"
  }
}
```

---

### 7005 - 玩家离开

玩家断开连接通知。

**响应:**
```json
{
  "proto_id": 7005,
  "data": {
    "player_id": "player_def456",
    "name": "Player-2"
  }
}
```

---

### 7006 - 错误通知

服务器错误通知。

**响应:**
```json
{
  "proto_id": 7006,
  "data": {
    "code": 1001,
    "message": "Invalid team selection"
  }
}
```

**错误码:**
| code | message | 说明 |
|------|---------|------|
| 1001 | Invalid team selection | 无效的队伍选择 |
| 1002 | Skin locked | 皮肤未解锁 |
| 1003 | Cannot split | 无法分裂（质量不足） |
| 1004 | Server full | 服务器已满 |

---

## 错误处理

### WebSocket 错误

```javascript
ws.onerror = (error) => {
  console.error('WebSocket error:', error);
  // 显示连接错误提示
  showConnectionError();
};

ws.onclose = (event) => {
  console.log('WebSocket closed:', event.code, event.reason);
  // 尝试重连
  reconnect();
};
```

### 错误码

| Code | 说明 |
|------|------|
| 1000 | 正常关闭 |
| 1001 | 终端离开 |
| 1006 | 连接异常关闭 |
| 1011 | 服务器错误 |

## 示例代码

### 完整客户端示例

```javascript
class GameClient {
  constructor(serverUrl) {
    this.ws = new WebSocket(serverUrl);
    this.setupHandlers();
  }
  
  setupHandlers() {
    this.ws.onopen = () => {
      console.log('Connected');
      this.initPlayer('Player-1', 'blue');
    };
    
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleMessage(msg);
    };
    
    this.ws.onerror = (error) => {
      console.error('Error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('Disconnected');
    };
  }
  
  handleMessage(msg) {
    switch (msg.proto_id) {
      case 2001:
        this.updateGameState(msg.data);
        break;
      case 2002:
        this.updateLeaderboard(msg.data);
        break;
      case 7001:
        this.showPowerupNotification(msg.data);
        break;
      // ... 其他消息处理
    }
  }
  
  // 发送移动指令
  move(x, y) {
    this.send({ proto_id: 1001, data: { x, y } });
  }
  
  // 发送分裂指令
  split() {
    this.send({ proto_id: 1002, data: {} });
  }
  
  // 发送吐孢子指令
  eject(angle) {
    this.send({ proto_id: 1003, data: { angle } });
  }
  
  // 初始化玩家
  initPlayer(name, skinId) {
    this.send({
      proto_id: 1007,
      data: { name, skin_id: skinId }
    });
  }
  
  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

// 使用
const client = new GameClient('ws://localhost:8082');
```

---

<p align="center">
  API 版本: 3.0 | 协议版本: 1.0 | 最后更新: 2024-06-12
</p>
