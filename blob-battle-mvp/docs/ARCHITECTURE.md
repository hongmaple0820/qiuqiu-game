# 🏗️ Blob Battle 架构文档

> 球球大作战游戏系统架构设计说明

## 系统概述

### 设计目标

- **低延迟**: WebSocket 实时通信，延迟 < 100ms
- **高并发**: 支持 100+ 玩家同时在线
- **跨平台**: 桌面端和移动端统一体验
- **可扩展**: 模块化设计，易于添加新功能

## 架构设计

### 整体架构

```
Client Layer (HTML5 Canvas + WebSocket)
         |
         | WebSocket
         v
Transport Layer (ws library, Port 8082)
         |
         v
Game Logic Layer (Node.js)
         |
         v
Data Layer (In-Memory)
```

### 模块说明

#### 1. 客户端模块

**渲染引擎**: Canvas 2D API, 60fps, 插值渲染
**输入处理**: 鼠标 + 虚拟摇杆
**音效系统**: Web Audio API

#### 2. 服务器模块

**WebSocket Server**: ws library
**游戏状态**: Map + Array 内存存储
**碰撞检测**: 圆形碰撞 + 距离计算
**AI Bot**: 状态机 (wander/chase/flee)

## 性能优化

### 客户端优化

- requestAnimationFrame 60fps 循环
- 状态插值平滑动画
- 粒子池复用

### 服务器优化

- 10Hz 状态广播
- 空间分割 (计划中)
- 增量更新 (计划中)

## 通信协议

详见 API.md
