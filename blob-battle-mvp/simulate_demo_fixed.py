#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《球球大作战：智械分身》MVP 核心逻辑模拟演示 - 修复版
"""

import json
import time
import random
import threading

PLAYER_ID = "human_001"
AGENT_ID = "agent_001"
MAP_SIZE = 1000
PROTO_POSITION = 1001
PROTO_CHAT_CMD = 2001
PROTO_AI_DECISION = 3001

human_client = None
agent_client = None

def generate_entity(entity_id, etype, x, y, radius, name, status="normal"):
    return {
        "entity_id": entity_id, "type": etype,
        "x": round(x, 2), "y": round(y, 2), "radius": radius,
        "vx": round(random.uniform(-2, 2), 2), "vy": round(random.uniform(-2, 2), 2),
        "skin_id": "skin_blue_01" if etype == "master" else "skin_robot_01",
        "name": name, "status": status
    }

class GameServer:
    def __init__(self):
        self.running = True
        self.entities = {
            PLAYER_ID: {"x": 500, "y": 500, "radius": 20},
            AGENT_ID: {"x": 510, "y": 510, "radius": 18}
        }

    def send_to_client(self, client_name, packet):
        print(f"\033[90m[SERVER] -> [{client_name}] ProtoID={packet['proto_id']}\033[0m")
        if client_name == "Human" and human_client:
            human_client.receive_packet(packet)
        elif client_name == "Agent" and agent_client:
            agent_client.receive_packet(packet)

    def broadcast_position(self):
        while self.running:
            for pid in self.entities:
                self.entities[pid]["x"] += random.uniform(-5, 5)
                self.entities[pid]["y"] += random.uniform(-5, 5)
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
            time.sleep(0.5)

    def route_message(self, from_client, packet):
        print(f"\033[90m[SERVER] <- [{from_client}] ProtoID={packet['proto_id']}\033[0m")
        if packet["proto_id"] == PROTO_CHAT_CMD:
            self.send_to_client("Agent", packet)
        elif packet["proto_id"] == PROTO_AI_DECISION:
            actions = packet['data'].get('actions', [])
            print(f"\033[92m[SYSTEM] 执行动作：{actions}\033[0m")
            self.send_to_client("Human", packet)

class HumanClient:
    def __init__(self, server):
        self.server = server
        self.running = True

    def receive_packet(self, packet):
        if packet["proto_id"] == PROTO_AI_DECISION:
            data = packet["data"]
            chat = data.get("chat_response", "")
            thought = data.get("thought", "")
            if chat:
                print(f"\033[94m[GAME] 🤖 分身说：\"{chat}\"\033[0m")
            if thought:
                print(f"\033[94m[GAME] 🧠 思路：{thought}\033[0m")

    def send_chat_command(self, text):
        packet = {
            "proto_id": PROTO_CHAT_CMD,
            "timestamp": int(time.time() * 1000),
            "data": {
                "sender_id": PLAYER_ID, "target_id": AGENT_ID,
                "msg_type": "command", "content": text
            }
        }
        print(f"\033[93m[YOU] 💬 指令：\"{text}\"\033[0m")
        self.server.route_message("Human", packet)

    def auto_behavior(self):
        commands = ["保护我！", "前面有人，进攻！", "集合", "去吃点豆子", "小心右边！"]
        while self.running:
            time.sleep(random.uniform(3, 6))
            cmd = random.choice(commands)
            self.send_chat_command(cmd)

class AgentClient:
    def __init__(self, server):
        self.server = server
        self.running = True

    def receive_packet(self, packet):
        if packet["proto_id"] == PROTO_CHAT_CMD:
            self.process_command(packet["data"]["content"])

    def process_command(self, text):
        text_lower = text.lower()
        thought, response, action_type = "", "", "move_to"

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

        decision_packet = {
            "proto_id": PROTO_AI_DECISION,
            "timestamp": int(time.time() * 1000),
            "data": {
                "agent_id": AGENT_ID,
                "decision_reason": thought,
                "chat_response": response,
                "thought": thought,
                "actions": [{"type": action_type, "params": {"priority": "high"}}]
            }
        }
        self.server.route_message("Agent", decision_packet)

def run_simulation():
    global human_client, agent_client
    print("="*60)
    print("🎮 《球球大作战：智械分身》MVP 核心逻辑模拟启动")
    print("="*60)
    print("图例：[SERVER]=网络层  [YOU]=玩家  [GAME]=AI 表现  [SYSTEM]=执行动作")
    print("-"*60)
    
    server = GameServer()
    human_client = HumanClient(server)
    agent_client = AgentClient(server)

    t_server = threading.Thread(target=server.broadcast_position, daemon=True)
    t_server.start()
    t_human = threading.Thread(target=human_client.auto_behavior, daemon=True)
    t_human.start()

    try:
        start_time = time.time()
        while time.time() - start_time < 15:
            time.sleep(1)
        print("\n" + "="*60)
        print("✅ 演示结束。第一版原型逻辑验证成功！")
        print("="*60)
        print("\n下一步建议:")
        print("1. 将此逻辑移植到 Node.js 作为真实后端")
        print("2. 在 Unity 中实现 NetworkManager.cs 对接此协议")
        print("3. 接入真实的 LLM API 替换 process_command 中的规则判断")
    except KeyboardInterrupt:
        print("\n模拟中断。")

if __name__ == "__main__":
    run_simulation()
