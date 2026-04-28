using UnityEngine;

/// <summary>
/// 简单的 UI 管理器 - Phase 3
/// 提供聊天输入框和 AI 状态显示
/// </summary>
public class UIManager : MonoBehaviour
{
    [Header("UI Settings")]
    public Rect chatWindowRect = new Rect(20, 20, 300, 400);
    public Rect aiStatusRect = new Rect(20, 450, 300, 100);

    private string chatInput = "";
    private string aiStatusText = "AI: 待命";
    private string aiThoughtText = "";
    private bool showChat = true;

    private NetworkManager network;

    void Start()
    {
        network = FindObjectOfType<NetworkManager>();
    }

    void OnGUI()
    {
        if (!showChat) return;

        // Chat Window
        chatWindowRect = GUI.Window(0, chatWindowRect, DrawChatWindow, "🤖 智械分身控制台");
        
        // AI Status Panel
        aiStatusRect = GUI.Window(1, aiStatusRect, DrawAIStatus, "📊 AI 状态");
    }

    void DrawChatWindow(int windowID)
    {
        GUILayout.BeginVertical();

        // Chat History (Placeholder)
        GUILayout.Box("系统：连接成功\nAI: 等待指令...", GUILayout.Height(250));

        // Input Field
        GUILayout.Space(10);
        GUILayout.Label("发送指令:");
        chatInput = GUILayout.TextField(chatInput, GUILayout.Height(30));

        GUILayout.BeginHorizontal();
        if (GUILayout.Button("发送", GUILayout.Height(30)))
        {
            SendCommand();
        }
        if (GUILayout.Button("保护我", GUILayout.Height(30)))
        {
            SendCommand("保护我");
        }
        if (GUILayout.Button("进攻", GUILayout.Height(30)))
        {
            SendCommand("进攻");
        }
        if (GUILayout.Button("集合", GUILayout.Height(30)))
        {
            SendCommand("集合");
        }
        GUILayout.EndHorizontal();

        GUILayout.EndVertical();
        GUI.DragWindow(new Rect(0, 0, 10000, 20));
    }

    void DrawAIStatus(int windowID)
    {
        GUILayout.BeginVertical();
        
        GUILayout.Label(aiStatusText);
        if (!string.IsNullOrEmpty(aiThoughtText))
        {
            GUIStyle style = new GUIStyle(GUI.skin.label);
            style.wordWrap = true;
            GUILayout.Label($"💭 思考：{aiThoughtText}", style);
        }

        GUILayout.EndVertical();
        GUI.DragWindow(new Rect(0, 0, 10000, 20));
    }

    void SendCommand(string command = null)
    {
        string cmd = command ?? chatInput;
        if (string.IsNullOrEmpty(cmd)) return;

        if (network != null)
        {
            network.SendChatCommand(cmd);
            chatInput = "";
            
            // Update status
            aiStatusText = $"AI: 收到指令 \"{cmd}\"";
        }
        else
        {
            Debug.LogWarning("[UI] NetworkManager not found!");
        }
    }

    // Called by NetworkManager when AI decision received
    public void UpdateAIStatus(string status, string thought = "")
    {
        aiStatusText = status;
        aiThoughtText = thought;
    }
}
