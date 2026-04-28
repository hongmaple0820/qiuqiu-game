const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

// Game State Store
const clients = new Map(); // ws -> { playerId, masterId, agentId, team }
const gameEntities = new Map(); // entityId -> entityData

console.log(`[Server] Blob Battle MVP Server started on port ${PORT}`);

wss.on('connection', (ws) => {
    const playerId = `player_${uuidv4().slice(0, 8)}`;
    const masterId = `master_${uuidv4().slice(0, 8)}`;
    const agentId = `agent_${uuidv4().slice(0, 8)}`;

    console.log(`[Connection] New player connected: ${playerId}`);

    // Initialize player entities
    const initialEntities = {
        [masterId]: {
            entity_id: masterId,
            type: 'master',
            owner_id: playerId,
            x: Math.random() * 800 + 100,
            y: Math.random() * 600 + 100,
            radius: 20,
            vx: 0, vy: 0,
            skin_id: 'skin_blue_01',
            name: 'Player',
            status: 'idle'
        },
        [agentId]: {
            entity_id: agentId,
            type: 'agent',
            owner_id: playerId,
            x: Math.random() * 800 + 100,
            y: Math.random() * 600 + 100,
            radius: 18,
            vx: 0, vy: 0,
            skin_id: 'skin_robot_01',
            name: 'Guardian-AI',
            status: 'follow',
            energy_link: true
        }
    };

    gameEntities.set(masterId, initialEntities[masterId]);
    gameEntities.set(agentId, initialEntities[agentId]);

    clients.set(ws, { playerId, masterId, agentId, team: 'blue' });

    // Send welcome packet
    const welcomePacket = {
        proto_id: 9001,
        timestamp: Date.now(),
        data: {
            message: 'Welcome to Blob Battle MVP!',
            player_id: playerId,
            master_id: masterId,
            agent_id: agentId,
            initial_entities: Object.values(initialEntities)
        }
    };
    ws.send(JSON.stringify(welcomePacket));

    ws.on('message', (message) => {
        try {
            const packet = JSON.parse(message);
            handlePacket(ws, packet, playerId, masterId, agentId);
        } catch (error) {
            console.error('[Error] Invalid JSON packet:', error.message);
        }
    });

    ws.on('close', () => {
        console.log(`[Disconnect] Player ${playerId} disconnected`);
        clients.delete(ws);
        gameEntities.delete(masterId);
        gameEntities.delete(agentId);
    });

    ws.on('error', (error) => {
        console.error(`[Error] Player ${playerId}:`, error.message);
    });
});

function handlePacket(ws, packet, playerId, masterId, agentId) {
    const { proto_id, data } = packet;

    switch (proto_id) {
        case 1001: // Player Position Update
            handlePositionUpdate(ws, data, masterId);
            break;
        
        case 2001: // Chat/Command
            handleChatCommand(ws, data, playerId, masterId, agentId);
            break;
        
        default:
            console.log(`[Unknown] Proto ID: ${proto_id}`);
    }
}

function handlePositionUpdate(ws, data, masterId) {
    const entity = gameEntities.get(masterId);
    if (entity && data.x !== undefined && data.y !== undefined) {
        entity.x = data.x;
        entity.y = data.y;
        entity.vx = data.vx || 0;
        entity.vy = data.vy || 0;
        entity.radius = data.radius || entity.radius;
    }
}

async function handleChatCommand(ws, data, playerId, masterId, agentId) {
    const { content, msg_type } = data;
    console.log(`[Chat] ${playerId}: ${content}`);

    // Simulate AI processing delay
    setTimeout(() => {
        const masterEntity = gameEntities.get(masterId);
        const agentEntity = gameEntities.get(agentId);
        
        if (!masterEntity || !agentEntity) return;

        // Simple rule-based AI response for MVP
        let aiResponse = {
            thought: "Analyzing situation...",
            chat_response: "Understood, executing command.",
            actions: []
        };

        const lowerContent = content.toLowerCase();
        
        if (lowerContent.includes('保护') || lowerContent.includes('defend') || lowerContent.includes('protect')) {
            aiResponse.thought = "Threat detected! Moving to defensive position.";
            aiResponse.chat_response = "Don't worry, I've got your back!";
            aiResponse.actions = [
                {
                    type: "move_to",
                    params: { 
                        x: masterEntity.x - 30, 
                        y: masterEntity.y - 30 
                    }
                }
            ];
        } else if (lowerContent.includes('进攻') || lowerContent.includes('attack')) {
            aiResponse.thought = "Going on the offensive!";
            aiResponse.chat_response = "Let's hunt them down!";
            aiResponse.actions = [
                {
                    type: "move_to",
                    params: { 
                        x: masterEntity.x + 100, 
                        y: masterEntity.y 
                    }
                },
                {
                    type: "split",
                    params: { direction_angle: 45 }
                }
            ];
        } else if (lowerContent.includes('集合') || lowerContent.includes('come')) {
            aiResponse.thought = "Returning to master's side.";
            aiResponse.chat_response = "Coming right over!";
            aiResponse.actions = [
                {
                    type: "move_to",
                    params: { 
                        x: masterEntity.x + 20, 
                        y: masterEntity.y + 20 
                    }
                }
            ];
        } else {
            aiResponse.chat_response = "I'm following your lead. What's the plan?";
            aiResponse.actions = [
                {
                    type: "move_to",
                    params: { 
                        x: agentEntity.x + (Math.random() - 0.5) * 50, 
                        y: agentEntity.y + (Math.random() - 0.5) * 50 
                    }
                }
            ];
        }

        const aiPacket = {
            proto_id: 3001,
            timestamp: Date.now(),
            data: {
                agent_id: agentId,
                decision_reason: aiResponse.thought,
                chat_response: aiResponse.chat_response,
                actions: aiResponse.actions
            }
        };

        ws.send(JSON.stringify(aiPacket));
        console.log(`[AI Response] Sent to ${playerId}: ${aiResponse.chat_response}`);
    }, 300);
}

// Game loop - broadcast world state every 100ms
setInterval(() => {
    const entitiesArray = Array.from(gameEntities.values());
    
    const worldStatePacket = {
        proto_id: 1001,
        timestamp: Date.now(),
        data: {
            player_id: 'server_broadcast',
            entities: entitiesArray
        }
    };

    const message = JSON.stringify(worldStatePacket);
    
    clients.forEach((clientInfo, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}, 100);

console.log('[Server] Game loop started (100ms interval)');
