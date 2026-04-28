using System;
using System.Collections.Generic;
using UnityEngine;
using WebSocketSharp;
using Newtonsoft.Json;

public class NetworkManager : MonoBehaviour
{
    [Header("Connection Settings")]
    public string serverUrl = "ws://localhost:8080";
    
    [Header("Debug")]
    public bool showDebugLogs = true;

    private WebSocket ws;
    private string playerId;
    private string masterId;
    private string agentId;

    // Entity data
    private Dictionary<string, EntityData> entities = new Dictionary<string, EntityData>();
    
    // Message queue for thread safety
    private Queue<string> messageQueue = new Queue<string>();
    private object lockObject = new object();

    void Start()
    {
        ConnectToServer();
    }

    void Update()
    {
        // Process messages in main thread
        lock (lockObject)
        {
            while (messageQueue.Count > 0)
            {
                string message = messageQueue.Dequeue();
                HandleMessage(message);
            }
        }

        // Send player position update every 50ms (20 times per second)
        if (ws != null && ws.IsAlive && Time.frameCount % 3 == 0)
        {
            SendPositionUpdate();
        }
    }

    void OnApplicationQuit()
    {
        Disconnect();
    }

    void OnDestroy()
    {
        Disconnect();
    }

    void ConnectToServer()
    {
        try
        {
            ws = new WebSocket(serverUrl);
            
            ws.OnOpen += (sender, e) =>
            {
                Log("Connected to server!");
            };

            ws.OnMessage += (sender, e) =>
            {
                lock (lockObject)
                {
                    messageQueue.Enqueue(e.Data);
                }
            };

            ws.OnClose += (sender, e) =>
            {
                Log($"Disconnected: {e.Reason}");
            };

            ws.OnError += (sender, e) =>
            {
                Log($"Error: {e.Message}");
            };

            ws.ConnectAsync();
        }
        catch (Exception ex)
        {
            Log($"Connection failed: {ex.Message}");
        }
    }

    void Disconnect()
    {
        if (ws != null && ws.IsAlive)
        {
            ws.CloseAsync();
            ws = null;
        }
    }

    void HandleMessage(string message)
    {
        try
        {
            var packet = JsonConvert.DeserializeObject<ServerPacket>(message);
            
            switch (packet.proto_id)
            {
                case 9001: // Welcome packet
                    HandleWelcomePacket(packet.data);
                    break;
                    
                case 1001: // World state update
                    HandleWorldState(packet.data);
                    break;
                    
                case 3001: // AI decision
                    HandleAIDecision(packet.data);
                    break;
                    
                default:
                    Log($"Unknown packet type: {packet.proto_id}");
                    break;
            }
        }
        catch (Exception ex)
        {
            Log($"Error parsing message: {ex.Message}");
        }
    }

    void HandleWelcomePacket(WelcomeData data)
    {
        playerId = data.player_id;
        masterId = data.master_id;
        agentId = data.agent_id;
        
        Log($"Welcome! Player: {playerId}, Master: {masterId}, Agent: {agentId}");
        
        // Initialize entities
        foreach (var entityData in data.initial_entities)
        {
            entities[entityData.entity_id] = entityData;
        }
        
        Log($"Initialized {entities.Count} entities");
    }

    void HandleWorldState(WorldStateData data)
    {
        foreach (var entityData in data.entities)
        {
            if (entities.ContainsKey(entityData.entity_id))
            {
                // Update existing entity
                entities[entityData.entity_id].x = entityData.x;
                entities[entityData.entity_id].y = entityData.y;
                entities[entityData.entity_id].vx = entityData.vx;
                entities[entityData.entity_id].vy = entityData.vy;
                entities[entityData.entity_id].radius = entityData.radius;
            }
            else
            {
                // Add new entity
                entities[entityData.entity_id] = entityData;
            }
        }
    }

    void HandleAIDecision(AIDecisionData data)
    {
        Log($"AI Decision: {data.chat_response}");
        Log($"Actions: {JsonConvert.SerializeObject(data.actions)}");
        
        // Execute AI actions
        foreach (var action in data.actions)
        {
            ExecuteAction(action);
        }
    }

    void ExecuteAction(ActionData action)
    {
        switch (action.type)
        {
            case "move_to":
                MoveAgentTo(action.params_data.x, action.params_data.y);
                break;
            case "split":
                SplitAgent(action.params_data.direction_angle);
                break;
            default:
                Log($"Unknown action type: {action.type}");
                break;
        }
    }

    void MoveAgentTo(float x, float y)
    {
        if (entities.ContainsKey(agentId))
        {
            var agent = entities[agentId];
            // In a real game, you would apply force or set target position here
            Log($"Moving agent to ({x}, {y})");
        }
    }

    void SplitAgent(float angle)
    {
        Log($"Splitting agent at angle {angle}");
        // Implement split logic
    }

    void SendPositionUpdate()
    {
        if (string.IsNullOrEmpty(masterId) || !entities.ContainsKey(masterId))
            return;

        var master = entities[masterId];
        
        // Simulate player input (in real game, get from input system)
        float moveSpeed = 5f;
        float newX = master.x + Input.GetAxis("Horizontal") * moveSpeed;
        float newY = master.y + Input.GetAxis("Vertical") * moveSpeed;
        
        // Clamp to map bounds (assuming 1000x800 map)
        newX = Mathf.Clamp(newX, 0, 1000);
        newY = Mathf.Clamp(newY, 0, 800);

        var positionPacket = new PositionUpdatePacket
        {
            proto_id = 1001,
            timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
            data = new PositionUpdateData
            {
                x = newX,
                y = newY,
                vx = (newX - master.x) * 20, // Approximate velocity
                vy = (newY - master.y) * 20,
                radius = master.radius
            }
        };

        SendPacket(positionPacket);
        
        // Update local entity
        master.x = newX;
        master.y = newY;
        entities[masterId] = master;
    }

    public void SendChatCommand(string command)
    {
        if (string.IsNullOrEmpty(agentId))
        {
            Log("Cannot send command: Agent not initialized");
            return;
        }

        var chatPacket = new ChatCommandPacket
        {
            proto_id = 2001,
            timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
            data = new ChatCommandData
            {
                sender_id = playerId,
                target_id = agentId,
                msg_type = "command",
                content = command
            }
        };

        SendPacket(chatPacket);
        Log($"Sent command: {command}");
    }

    void SendPacket(object packet)
    {
        if (ws == null || !ws.IsAlive)
        {
            Log("Cannot send: Not connected");
            return;
        }

        try
        {
            string json = JsonConvert.SerializeObject(packet);
            ws.SendAsync(json, null);
        }
        catch (Exception ex)
        {
            Log($"Send error: {ex.Message}");
        }
    }

    void Log(string message)
    {
        if (showDebugLogs)
        {
            Debug.Log($"[Network] {message}");
        }
    }

    // Data Classes
    [Serializable]
    public class ServerPacket
    {
        public int proto_id;
        public long timestamp;
        public object data;
    }

    [Serializable]
    public class PositionUpdatePacket
    {
        public int proto_id;
        public long timestamp;
        public PositionUpdateData data;
    }

    [Serializable]
    public class PositionUpdateData
    {
        public float x;
        public float y;
        public float vx;
        public float vy;
        public float radius;
    }

    [Serializable]
    public class ChatCommandPacket
    {
        public int proto_id;
        public long timestamp;
        public ChatCommandData data;
    }

    [Serializable]
    public class ChatCommandData
    {
        public string sender_id;
        public string target_id;
        public string msg_type;
        public string content;
    }

    [Serializable]
    public class WelcomeData
    {
        public string message;
        public string player_id;
        public string master_id;
        public string agent_id;
        public List<EntityData> initial_entities;
    }

    [Serializable]
    public class WorldStateData
    {
        public string player_id;
        public List<EntityData> entities;
    }

    [Serializable]
    public class AIDecisionData
    {
        public string agent_id;
        public string decision_reason;
        public string chat_response;
        public List<ActionData> actions;
    }

    [Serializable]
    public class EntityData
    {
        public string entity_id;
        public string type;
        public string owner_id;
        public float x;
        public float y;
        public float vx;
        public float vy;
        public float radius;
        public string skin_id;
        public string name;
        public string status;
        public bool energy_link;
    }

    [Serializable]
    public class ActionData
    {
        public string type;
        public ActionParams params_data;
    }

    [Serializable]
    public class ActionParams
    {
        public float x;
        public float y;
        public float direction_angle;
    }
}
