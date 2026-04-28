#!/usr/bin/env python3
"""
Blob Battle MVP - Python Test Client
用于快速测试服务端功能，无需 Unity 环境
"""

import websocket
import json
import time
import threading

class TestClient:
    def __init__(self, url="ws://localhost:8080"):
        self.url = url
        self.ws = None
        self.player_id = None
        self.master_id = None
        self.agent_id = None
        
    def on_open(self, ws):
        print("\n✅ [Connected] 已连接到服务器")
        
    def on_message(self, ws, message):
        try:
            packet = json.loads(message)
            proto_id = packet.get('proto_id')
            
            if proto_id == 9001:  # Welcome packet
                data = packet['data']
                self.player_id = data['player_id']
                self.master_id = data['master_id']
                self.agent_id = data['agent_id']
                print(f"\n🎮 [Welcome] Player: {self.player_id}")
                print(f"   Master: {self.master_id}")
                print(f"   Agent: {self.agent_id}")
                
            elif proto_id == 1001:  # World state
                entities = packet['data']['entities']
                print(f"\n🌍 [World State] 收到 {len(entities)} 个实体更新")
                
            elif proto_id == 3001:  # AI decision
                data = packet['data']
                print(f"\n🤖 [AI Response] {data['chat_response']}")
                print(f"   Reason: {data['decision_reason']}")
                print(f"   Actions: {json.dumps(data['actions'], ensure_ascii=False)}")
                
        except Exception as e:
            print(f"[Error] 解析消息失败：{e}")
            
    def on_error(self, ws, error):
        print(f"\n❌ [Error] {error}")
        
    def on_close(self, ws, close_status_code, close_msg):
        print(f"\n👋 [Disconnected] {close_msg}")
        
    def connect(self):
        print(f"正在连接 {self.url} ...")
        self.ws = websocket.WebSocketApp(
            self.url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        
        # 在独立线程中运行 WebSocket
        thread = threading.Thread(target=self.ws.run_forever)
        thread.daemon = True
        thread.start()
        
        # 等待连接建立
        time.sleep(1)
        
    def send_command(self, command):
        if not self.agent_id:
            print("❌ 未初始化，请先等待欢迎包")
            return
            
        packet = {
            "proto_id": 2001,
            "timestamp": int(time.time() * 1000),
            "data": {
                "sender_id": self.player_id,
                "target_id": self.agent_id,
                "msg_type": "command",
                "content": command
            }
        }
        
        print(f"\n📤 [Sending Command] \"{command}\"")
        self.ws.send(json.dumps(packet))
        
    def close(self):
        if self.ws:
            self.ws.close()

def main():
    print("=" * 60)
    print("🎮 Blob Battle MVP - Python 测试客户端")
    print("=" * 60)
    
    client = TestClient()
    client.connect()
    
    # 等待初始化
    time.sleep(2)
    
    if client.player_id:
        print("\n" + "=" * 60)
        print("🧪 开始测试指令...")
        print("=" * 60)
        
        # 测试各种指令
        test_commands = [
            "保护我！",
            "进攻！",
            "集合",
            "随便聊聊"
        ]
        
        for cmd in test_commands:
            client.send_command(cmd)
            time.sleep(1.5)  # 等待 AI 响应
            
        print("\n" + "=" * 60)
        print("✅ 所有测试完成！")
        print("=" * 60)
    else:
        print("❌ 连接失败，无法进行测试")
    
    # 保持运行一段时间以接收最后的响应
    time.sleep(3)
    client.close()
    print("\n👋 测试客户端已退出")

if __name__ == "__main__":
    main()
