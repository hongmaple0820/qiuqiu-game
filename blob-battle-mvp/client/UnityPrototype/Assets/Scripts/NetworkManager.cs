using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using WebSocketSharp;
using Newtonsoft.Json;

/// <summary>
/// Phase 3: Unity 客户端网络管理器
/// 负责与 Node.js 服务端通信，处理位置同步、聊天指令和 AI 决策
/// </summary>
public class NetworkManager : MonoBehaviour
{
    [Header("Network Settings")]
    public string serverUrl = "ws://localhost:8080";
    public float sendPositionInterval = 0.1f; // 10Hz

    [Header("Game Objects")]
    public GameObject masterPrefab;
    public GameObject agentPrefab;
    public GameObject foodPrefab;

    // State
    private WebSocket ws;
    private string playerId;
    private GameObject masterObj;
    private GameObject agentObj;
    private Dictionary<string, GameObject> otherPlayers = new Dictionary<string, GameObject>();
    
    // Message Queue (Main Thread Safe)
    private Queue<Action> messageQueue = new Queue<Action>();
    private object queueLock = new object();

    // Timers
    private float sendTimer = 0f;

    void Start()
    {
        Connect();
    }

    void Update()
    {
        // Process Message Queue in Main Thread
        lock (queueLock)
        {
            while (messageQueue.Count > 0)
            {
                var action = messageQueue.Dequeue();
                action?.Invoke();
            }
        }

        // Send Position Periodically
        if (ws != null && ws.IsAlive)
        {
            sendTimer += Time.deltaTime;
            if (sendTimer >= sendPositionInterval)
            {
                sendTimer = 0f;
                SendPosition();
            }
        }

        // Player Input (WASD or Arrow Keys)
        if (masterObj != null)
        {
            HandlePlayerInput();
        }
    }

    void OnApplicationQuit()
    {
        Disconnect();
    }

    #region Connection Management

    void Connect()
    {
        Debug.Log($"[Network] Connecting to {serverUrl}...");
        ws = new WebSocket(serverUrl);

        ws.OnOpen += (sender, e) =>
        {
            Debug.Log("[Network] Connected!");
        };

        ws.OnMessage += (sender, e) =>
        {
            try
            {
                var data = JsonConvert.DeserializeObject<Dictionary<string, object>>(e.Data);
                int protoId = (int)data["proto_id"];

                switch (protoId)
                {
                    case 9001: // Welcome Packet
                        HandleWelcome(e.Data);
                        break;
                    case 1001: // World State / Position Sync
                        HandleWorldState(e.Data);
                        break;
                    case 3001: // AI Decision
                        HandleAIDecision(e.Data);
                        break;
                    default:
                        Debug.Log($"[Network] Unknown ProtoID: {protoId}");
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Network] Parse Error: {ex.Message}");
            }
        };

        ws.OnError += (sender, e) =>
        {
            Debug.LogError($"[Network] Error: {e.Message}");
        };

        ws.OnClose += (sender, e) =>
        {
            Debug.Log($"[Network] Disconnected: {e.Reason}");
        };

        ws.ConnectAsync();
    }

    void Disconnect()
    {
        if (ws != null && ws.IsAlive)
        {
            ws.CloseAsync();
            ws = null;
        }
    }

    #endregion

    #region Send Packets

    void SendPosition()
    {
        if (masterObj == null || agentObj == null) return;

        var packet = new
        {
            proto_id = 1001,
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            @data = new
            {
                player_id = playerId ?? "unknown",
                entities = new[]
                {
                    new
                    {
                        entity_id = "master_01",
                        type = "master",
                        x = masterObj.transform.position.x,
                        y = masterObj.transform.position.y,
                        radius = 20f,
                        vx = 0f,
                        vy = 0f,
                        skin_id = "skin_blue_01",
                        name = "PlayerOne",
                        status = "normal"
                    },
                    new
                    {
                        entity_id = "agent_01",
                        type = "agent",
                        x = agentObj.transform.position.x,
                        y = agentObj.transform.position.y,
                        radius = 18f,
                        vx = 0f,
                        vy = 0f,
                        skin_id = "skin_robot_01",
                        name = "Guardian-AI",
                        status = "follow",
                        energy_link = true
                    }
                }
            }
        };

        string json = JsonConvert.SerializeObject(packet);
        ws.Send(json);
    }

    public void SendChatCommand(string command)
    {
        if (ws == null || !ws.IsAlive)
        {
            Debug.LogWarning("[Network] Cannot send command: Not connected");
            return;
        }

        var packet = new
        {
            proto_id = 2001,
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            @data = new
            {
                sender_id = playerId ?? "unknown",
                target_id = "agent_01",
                msg_type = "command",
                content = command
            }
        };

        string json = JsonConvert.SerializeObject(packet);
        ws.Send(json);
        Debug.Log($"[Chat] Sent command: {command}");
    }

    #endregion

    #region Receive Handlers

    void HandleWelcome(string json)
    {
        var data = JsonConvert.DeserializeObject<Dictionary<string, object>>(json);
        var innerData = JsonConvert.DeserializeObject<Dictionary<string, object>>(data["data"].ToString());
        
        playerId = innerData["player_id"].ToString();
        Debug.Log($"[Network] Welcome! PlayerID: {playerId}");

        // Spawn Master & Agent
        EnqueueAction(() =>
        {
            masterObj = Instantiate(masterPrefab, new Vector3(0, 0, 0), Quaternion.identity);
            agentObj = Instantiate(agentPrefab, new Vector3(5, 5, 0), Quaternion.identity);
            Debug.Log("[Network] Spawned Master and Agent entities");
        });
    }

    void HandleWorldState(string json)
    {
        var data = JsonConvert.DeserializeObject<Dictionary<string, object>>(json);
        var innerData = JsonConvert.DeserializeObject<Dictionary<string, object>>(data["data"].ToString());
        
        if (!innerData.ContainsKey("entities")) return;
        
        var entities = JsonConvert.DeserializeObject<List<Dictionary<string, object>>>(innerData["entities"].ToString());

        foreach (var entity in entities)
        {
            string type = entity["type"].ToString();
            
            if (type == "enemy" || type == "player")
            {
                // Handle other players/enemies
                string entityId = entity["entity_id"].ToString();
                float x = (float)Convert.ToDouble(entity["x"]);
                float y = (float)Convert.ToDouble(entity["y"]);

                EnqueueAction(() =>
                {
                    if (!otherPlayers.ContainsKey(entityId))
                    {
                        var obj = Instantiate(masterPrefab, new Vector3(x, y, 0), Quaternion.identity);
                        otherPlayers[entityId] = obj;
                    }
                    else
                    {
                        otherPlayers[entityId].transform.position = new Vector3(x, y, 0);
                    }
                });
            }
            else if (type == "food")
            {
                // Handle food spawning
                float x = (float)Convert.ToDouble(entity["x"]);
                float y = (float)Convert.ToDouble(entity["y"]);
                
                EnqueueAction(() =>
                {
                    var food = Instantiate(foodPrefab, new Vector3(x, y, 0), Quaternion.identity);
                    Destroy(food, 10f); // Auto-despawn after 10s
                });
            }
        }
    }

    void HandleAIDecision(string json)
    {
        var data = JsonConvert.DeserializeObject<Dictionary<string, object>>(json);
        var innerData = JsonConvert.DeserializeObject<Dictionary<string, object>>(data["data"].ToString());
        
        string agentId = innerData["agent_id"].ToString();
        string reason = innerData["decision_reason"].ToString();
        var actions = JsonConvert.DeserializeObject<List<Dictionary<string, object>>>(innerData["actions"].ToString());

        Debug.Log($"[AI] Decision: {reason}");

        EnqueueAction(() =>
        {
            foreach (var action in actions)
            {
                string actionType = action["type"].ToString();
                var parameters = JsonConvert.DeserializeObject<Dictionary<string, double>>(action["params"].ToString());

                if (agentObj != null)
                {
                    switch (actionType)
                    {
                        case "move_to":
                            agentObj.transform.position = new Vector3((float)parameters["x"], (float)parameters["y"], 0);
                            break;
                        case "split":
                            Debug.Log("[AI] Split action triggered (visual effect pending)");
                            break;
                        case "defend":
                            Debug.Log("[AI] Defend mode activated");
                            break;
                    }
                }
            }
        });
    }

    #endregion

    #region Utilities

    void EnqueueAction(Action action)
    {
        lock (queueLock)
        {
            messageQueue.Enqueue(action);
        }
    }

    void HandlePlayerInput()
    {
        float moveX = Input.GetAxis("Horizontal");
        float moveY = Input.GetAxis("Vertical");

        if (moveX != 0 || moveY != 0)
        {
            Vector3 moveDir = new Vector3(moveX, moveY, 0).normalized;
            masterObj.transform.position += moveDir * 5f * Time.deltaTime;
            
            // Camera follow
            Camera.main.transform.position = new Vector3(masterObj.transform.position.x, masterObj.transform.position.y, -10);
        }

        // Split on Space
        if (Input.GetKeyDown(KeyCode.Space))
        {
            Debug.Log("[Input] Split triggered");
            // TODO: Send split command to server
        }

        // Eject mass on Q
        if (Input.GetKeyDown(KeyCode.Q))
        {
            Debug.Log("[Input] Eject mass triggered");
            // TODO: Send eject command to server
        }
    }

    #endregion
}
