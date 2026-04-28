# Blob Battle: AI Avatar - MVP Prototype

## 项目结构
```
blob-battle-mvp/
├── server/                 # Node.js 服务端
│   ├── package.json
│   └── server.js          # WebSocket 服务器 + AI 逻辑
├── client/                # Unity 客户端
│   └── Assets/
│       └── Scripts/
│           └── NetworkManager.cs  # 网络通信管理
└── README.md             # 本文件
```

## 快速开始

### 1. 启动服务端
```bash
cd server
npm install
npm start
```

服务端将在 `ws://localhost:8080` 启动

### 2. Unity 客户端设置

#### 依赖包安装
在 Unity Package Manager 中安装：
- **Newtonsoft.Json** (JSON 序列化)
- **WebSocketSharp** (WebSocket 客户端)

或通过 NuGet for Unity 安装：
```
Install-Package Newtonsoft.Json
Install-Package WebSocketSharp
```

#### 场景配置
1. 创建空 GameObject，命名为 "NetworkManager"
2. 将 `NetworkManager.cs` 挂载到该对象
3. 调整 `serverUrl` 为 `ws://localhost:8080`
4. 运行场景

### 3. 测试指令

在 Unity Console 或添加 UI 按钮调用：
```csharp
// 获取 NetworkManager 实例
var network = FindObjectOfType<NetworkManager>();

// 发送指令
network.SendChatCommand("保护我");
network.SendChatCommand("进攻");
network.SendChatCommand("集合");
network.SendChatCommand("随便聊聊");
```

## 通信协议

### ProtoID 9001 - 欢迎包
```json
{
  "proto_id": 9001,
  "data": {
    "player_id": "player_xxx",
    "master_id": "master_xxx",
    "agent_id": "agent_xxx",
    "initial_entities": [...]
  }
}
```

### ProtoID 1001 - 位置同步
```json
{
  "proto_id": 1001,
  "data": {
    "entities": [
      {
        "entity_id": "master_xxx",
        "type": "master",
        "x": 500.0,
        "y": 400.0,
        "radius": 20.0
      }
    ]
  }
}
```

### ProtoID 2001 - 聊天/指令
```json
{
  "proto_id": 2001,
  "data": {
    "sender_id": "player_xxx",
    "target_id": "agent_xxx",
    "msg_type": "command",
    "content": "保护我"
  }
}
```

### ProtoID 3001 - AI 决策
```json
{
  "proto_id": 3001,
  "data": {
    "agent_id": "agent_xxx",
    "decision_reason": "Threat detected!",
    "chat_response": "Don't worry, I've got your back!",
    "actions": [
      {
        "type": "move_to",
        "params": { "x": 100, "y": 200 }
      }
    ]
  }
}
```

## MVP 功能清单

### ✅ 已实现
- [x] WebSocket 双通道通信
- [x] 玩家连接与实体初始化
- [x] 位置同步 (10Hz)
- [x] 聊天指令解析
- [x] 规则基 AI 响应 (保护/进攻/集合)
- [x] 世界状态广播

### 📋 待实现
- [ ] LLM 集成替换规则 AI
- [ ] 物理碰撞检测
- [ ] 分裂/吐孢子机制
- [ ] 地图边界与食物生成
- [ ] 多人房间匹配
- [ ] UI 聊天窗口
- [ ] Agent 行为可视化

## 下一步开发建议

### Phase 1: 核心玩法验证 (Week 1-2)
1. 添加基础物理引擎
2. 实现球球移动、碰撞、吞噬逻辑
3. 添加简单 Bot 敌人

### Phase 2: AI 增强 (Week 3-4)
1. 接入 GPT-4o-mini API
2. 设计 System Prompt
3. 优化指令响应延迟

### Phase 3: 多人对战 (Week 5-6)
1. 房间系统
2. 队伍匹配
3. 胜负判定

## 技术栈
- **后端**: Node.js + ws (WebSocket)
- **前端**: Unity 2022 LTS + C#
- **通信**: WebSocket (JSON over WS)
- **AI**: 规则引擎 → LLM (后续)

## 常见问题

### Q: WebSocket 连接失败？
A: 确保服务端已启动，检查防火墙设置，确认 URL 为 `ws://localhost:8080`

### Q: Unity 收不到消息？
A: 检查 `Update()` 中的消息队列处理，确保主线程执行

### Q: AI 响应太慢？
A: MVP 使用 300ms 模拟延迟，实际部署时优化 LLM 调用或使用边缘计算

---

**版本**: v0.1.0 MVP  
**日期**: 2024  
**状态**: 原型开发中
