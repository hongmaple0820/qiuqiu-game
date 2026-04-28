#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《球球大作战：智械分身》MVP 核心逻辑模拟演示
功能：模拟 Server, Human Player, AI Agent 三者之间的实时交互
无需外部依赖，直接运行即可看到完整通信流程
"""

import json
import time
import random
import threading
from datetime import datetime

# ================= 配置常量 =================
SERVER_URL = "ws://localhost:8080"  # 模拟地址
PLAYER_ID = "human_001"
AGENT_ID = "agent_001"
MAP_SIZE = 1000

# ================= 协议定义 (ProtoID) =================
PROTO_WELCOME = 9001
PROTO_POSITION = 1001
PROTO_CHAT_CMD = 2001
PROTO_AI_DECISION = 3001

# ================= 模拟数据生成器 =================
def generate_entity(entity_id, etype, x, y, radius, name, status="normal"):
    return {
        "entity_id": entity_id,
        "type": etype,
        "x": round(x, 2),
        "y": round(y, 2),
        "radius": radius,
        "vx": round(random.uniform(-2, 2), 2),
        "vy": round(random.uniform(-2, 2), 2),
        "skin_id": "skin_blue_01" if etype == "master" else "skin_robot_01",
        "name": name,
        "status": status
    }

# ================= 全局变量声明 =================
human_client = None
agent_client = None

# ================= 角色类定义 =================

class GameServer:
    """模拟 WebSocket 服务器"""
    def __init__(self):
        self.clients = {}
        self.running = True
        self.entities = {
            PLAYER_ID: {"x": 500, "y": 500, "radius": 20},
            AGENT_ID: {"x": 510, "y": 510, "radius": 18}
        }

    def send_to_client(self, client_name, packet):
        """模拟发送数据包"""
        print(f"\033[90m[SERVER] -> [{client_name}] 发送包: ProtoID={packet['proto_id']}\033[0m")
        # 实际逻辑中这里会通过 socket 发送，这里直接调用接收方的处理函数
        if client_name == "Human":
            human_client.receive_packet(packet)
        elif client_name == "Agent":
            agent_client.receive_packet(packet)

    def broadcast_position(self):
        """模拟高频位置广播 (10Hz)"""
        while self.running:
            # 更新实体位置 (随机游走模拟)
            for pid in self.entities:
                self.entities[pid]["x"] += random.uniform(-5, 5)
                self.entities[pid]["y"] += random.uniform(-5, 5)
                # 边界检查
                self.entities[pid]["x"] = max(0, min(MAP_SIZE, self.entities[pid]["x"]))
                self.entities[pid]["y"] = max(0, min(MAP_SIZE, self.entities[pid]["y"]))

            packet = {
                "proto_id": PROTO_POSITION,
                "timestamp": int(time.time() * 1000),
                "data": {
                    "player_id": "server_broadcast",
                    "entities": [
                        generate_entity(PLAYER_ID, "master", self.entities[PLAYER_ID]["x"], self.entities[PLAYER_ID]["y"], self.entities[PLAYER_ID]["radius"], "PlayerOne"),
                        generate_entity(AGENT_ID, "agent", self.entities[AGENT_ID]["x"], self.entities[AGENT_ID]["y"], self.entities[AGENT_ID]["radius"], "Guardian-AI", "follow")
                    ]
                }
            }
            self.send_to_client("Human", packet)
            self.send_to_client("Agent", packet)
            time.sleep(0.5) # 加速模拟，实际为 0.1s

    def route_message(self, from_client, packet):
        """路由消息"""
        print(f"\033[90m[SERVER] <- [{from_client}] 接收包: ProtoID={packet['proto_id']}\033[0m")
        
        if packet["proto_id"] == PROTO_CHAT_CMD:
            # 聊天包需要转发给 AI 处理
            self.send_to_client("Agent", packet)
        elif packet["proto_id"] == PROTO_AI_DECISION:
            # AI 决策包需要转发给服务器执行（模拟）并反馈给人类
            print(f"\033[92m[SYSTEM] 执行 AI 动作: {packet['data']['actions']}\033[0m")
            self.send_to_client("Human", packet)

class HumanClient:
    """模拟人类玩家客户端 (Unity)"""
    def __init__(self, server):
        self.server = server
        self.running = True

    def receive_packet(self, packet):
        if packet["proto_id"] == PROTO_POSITION:
            # 渲染逻辑略
            pass
        elif packet["proto_id"] == PROTO_AI_DECISION:
            data = packet["data"]
            print(f"            print(f"\033[94m[GAME] 🤖 分身说: \"{data['chat_response']}\"\033[0m")33[94m[GAME] 🤖 分身说："{packet['data'].get('chat_response', '')}"            print(f"\033[94m[GAME] 🤖 分身说: \"{data['chat_response']}\"\033[0m")33[0m")
            print(f"            print(f"\033[94m[GAME] 🧠 分身思路: {data['thought']}\033[0m")33[94m[GAME] 🤖 分身说："{packet['data'].get('chat_response', '')}"            print(f"\033[94m[GAME] 🧠 分身思路: {data['thought']}\033[0m")33[0m")
            if "thought" in packet["data"]: print(f"\033[94m[GAME] 🧠 分身思路：{packet[\"data\"][\"thought\"]}\033[0m")

    def send_chat_command(self, text):
        """玩家发送指令"""
        packet = {
            "proto_id": PROTO_CHAT_CMD,
            "timestamp": int(time.time() * 1000),
            "data": {
                "sender_id": PLAYER_ID,
                "target_id": AGENT_ID,
                "msg_type": "command",
                "content": text
            }
        }
        print(f"\033[93m[YOU] 💬 输入指令: \"{text}\"\033[0m")
        self.server.route_message("Human", packet)

    def auto_behavior(self):
        """模拟玩家随机行为"""
        commands = ["保护我！", "前面有人，进攻！", "集合", "去吃点豆子", "小心右边！"]
        while self.running:
            time.sleep(random.uniform(3, 6)) # 每隔几秒发个指令
            cmd = random.choice(commands)
            self.send_chat_command(cmd)

class AgentClient:
    """模拟 AI 分身 (本地规则引擎 或 LLM)"""
    def __init__(self, server):
        self.server = server
        self.running = True
        self.state = "idle"
        self.threat_level = 0

    def receive_packet(self, packet):
        if packet["proto_id"] == PROTO_POSITION:
            # 更新世界观
            self.update_world_view(packet["data"]["entities"])
        elif packet["proto_id"] == PROTO_CHAT_CMD:
            # 收到主人指令，触发决策
            self.process_command(packet["data"]["content"])

    def update_world_view(self, entities):
        """简单的威胁检测逻辑"""
        my_pos = next((e for e in entities if e["entity_id"] == AGENT_ID), None)
        master_pos = next((e for e in entities if e["entity_id"] == PLAYER_ID), None)
        
        if not my_pos or not master_pos:
            return

        # 模拟检测敌人
        distance = ((my_pos["x"] - master_pos["x"])**2 + (my_pos["y"] - master_pos["y"])**2)**0.5
        if distance > 100:
            self.threat_level = 1 # 距离过远也是威胁
        else:
            self.threat_level = 0

    def process_command(self, text):
        """模拟 LLM 的 System Prompt 解析逻辑"""
        text_lower = text.lower()
        thought = ""
        action_type = "move_to"
        params = {}
        response = ""

        # 简易规则引擎模拟 LLM
        if "保护" in text_lower or "help" in text_lower:
            thought = "检测到主人请求保护，立即切换至防御姿态，贴近主人。"
            response = "别怕，我来挡住他！"
            action_type = "follow_close"
        elif "进攻" in text_lower or "attack" in text_lower:
            thought = "收到进攻指令，寻找最近的大于我的敌人或分裂机会。"
            response = "让我们猎杀他们！准备分裂！"
            action_type = "split_attack"
        elif "集合" in text_lower or "come" in text_lower:
            thought = "主人要求集合，取消当前任务，全速前往主人位置。"
            response = "马上过来！"
            action_type = "rush_to_master"
        else:
            thought = "未识别到明确战术指令，保持当前巡逻/跟随状态。"
            response = "收到，继续执行当前任务。"
            action_type = "maintain"

        # 构建决策包
        decision_packet = {
            "proto_id": PROTO_AI_DECISION,
            "timestamp": int(time.time() * 1000),
            "data": {
                "agent_id": AGENT_ID,
                "decision_reason": thought,
                "chat_response": response,
                "actions": [
                    {
                        "type": action_type,
                        "params": {"priority": "high"}
                    }
                ]
            }
        }
        self.server.route_message("Agent", decision_packet)

# ================= 主程序入口 =================

def run_simulation():
    print("="*60)
    print("🎮 《球球大作战：智械分身》MVP 核心逻辑模拟启动")
    print("="*60)
    print("图例说明:")
    print("  [SERVER] : 网络通信层")
    print("  [YOU]    : 人类玩家 (模拟输入)")
    print("  [GAME]   : 游戏内表现 (AI 回复与动作)")
    print("  [SYSTEM] : 底层执行动作")
    print("-"*60)
    
    server = GameServer()
    global human_client, agent_client  # 声明为全局变量
    human_client = HumanClient(server)
    agent_client = AgentClient(server)

    # 启动服务器广播线程
    t_server = threading.Thread(target=server.broadcast_position, daemon=True)
    t_server.start()

    # 启动人类自动行为线程
    t_human = threading.Thread(target=human_client.auto_behavior, daemon=True)
    t_human.start()

    # 主线程保持运行，模拟时间流逝
    try:
        start_time = time.time()
        while time.time() - start_time < 20: # 运行 20 秒演示
            time.sleep(1)
        print("\n" + "="*60)
        print("演示结束。第一版原型逻辑验证成功！")
        print("="*60)
        print("\n下一步建议:")
        print("1. 将此逻辑移植到 Node.js 作为真实后端")
        print("2. 在 Unity 中实现 NetworkManager.cs 对接此协议")
        print("3. 接入真实的 LLM API 替换 process_command 中的规则判断")
        
    except KeyboardInterrupt:
        print("\n模拟中断。")

if __name__ == "__main__":
    run_simulation()
