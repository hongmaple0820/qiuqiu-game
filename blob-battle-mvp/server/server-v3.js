const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = 8082;
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1500;
const FOOD_COUNT = 150;
const BOT_COUNT = 8;

const metrics = {
    connections: { total: 0, current: 0, peak: 0 },
    messages: { received: 0, sent: 0 },
    errors: { total: 0, byType: {} },
    uptime: Date.now()
};

function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

function handleError(error, context) {
    metrics.errors.total++;
    const errorType = error.name || 'UnknownError';
    metrics.errors.byType[errorType] = (metrics.errors.byType[errorType] || 0) + 1;
    log('ERROR', 'Error in ' + context, { error: error.message, type: errorType });
}



// 团队模式配置
const TEAMS = {
    red: { name: '红队', color: '#ff4444', spawnX: 500, spawnY: 750 },
    blue: { name: '蓝队', color: '#4444ff', spawnX: 1500, spawnY: 750 },
    green: { name: '绿队', color: '#44ff44', spawnX: 1000, spawnY: 500 },
    yellow: { name: '黄队', color: '#ffff44', spawnX: 1000, spawnY: 1000 }
};

// 游戏模式
const GAME_MODES = {
    free: '自由模式',
    team: '团队模式'
};

let currentMode = 'free';
let teamScores = { red: 0, blue: 0, green: 0, yellow: 0 };

// 分配玩家到队伍
function assignTeam() {
    const teamSizes = {};
    Object.keys(TEAMS).forEach(team => {
        teamSizes[team] = 0;
    });
    
    // 统计各队人数
    clients.forEach(client => {
        if (client.team) {
            teamSizes[client.team]++;
        }
    });
    
    // 分配到人数最少的队伍
    let minTeam = 'red';
    let minSize = Infinity;
    Object.entries(teamSizes).forEach(([team, size]) => {
        if (size < minSize) {
            minSize = size;
            minTeam = team;
        }
    });
    
    return minTeam;
}
const SKINS = {
    blue: { color: '#4ecdc4', name: '经典蓝', unlocked: true },
    red: { color: '#ff6b6b', name: '热情红', unlocked: true },
    green: { color: '#51cf66', name: '自然绿', unlocked: true },
    purple: { color: '#a64ac9', name: '神秘紫', unlocked: true },
    yellow: { color: '#fcc419', name: '阳光黄', unlocked: true },
    orange: { color: '#ff922b', name: '活力橙', unlocked: true },
    gold: { color: '#ffd700', name: '黄金传说', unlocked: false, requirement: '达到 50 质量' },
    rainbow: { color: 'rainbow', name: '彩虹渐变', unlocked: false, requirement: '连续登录 7 天' },
    dark: { color: '#2b2d4a', name: '暗黑骑士', unlocked: false, requirement: '吃掉 10 个 Bot' },
    ice: { color: '#74c0fc', name: '冰雪女王', unlocked: false, requirement: '累计练习 100 分钟' }
};

// 道具配置
const POWERUPS = {
    speed: { name: '加速', color: '#00ff00', duration: 5000, effect: 1.5 },
    shield: { name: '护盾', color: '#0088ff', duration: 3000, effect: 1 },
    magnet: { name: '磁力', color: '#ff00ff', duration: 4000, effect: 2 },
    grow: { name: '生长', color: '#ff8800', duration: 100, effect: 1.2 }
};

let powerups = [];  // 地图上的道具

// 生成道具
function spawnPowerup() {
    if (powerups.length >= 3) return;  // 最多3个道具
    const types = Object.keys(POWERUPS);
    const type = types[Math.floor(Math.random() * types.length)];
    const powerup = {
        entity_id: 'powerup_' + uuidv4().slice(0, 6),
        type: 'powerup',
        powerup_type: type,
        x: Math.random() * MAP_WIDTH,
        y: Math.random() * MAP_HEIGHT,
        radius: 15,
        color: POWERUPS[type].color
    };
    powerups.push(powerup);
    gameEntities.set(powerup.entity_id, powerup);
    log('INFO', 'Powerup spawned', { type, position: { x: powerup.x, y: powerup.y } });
}

// 检查道具碰撞
function checkPowerupCollisions() {
    const players = Array.from(gameEntities.values()).filter(e => e.type === 'master' || e.type === 'agent');
    
    for (let i = powerups.length - 1; i >= 0; i--) {
        const powerup = powerups[i];
        players.forEach(player => {
            const dx = player.x - powerup.x;
            const dy = player.y - powerup.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < player.radius + powerup.radius) {
                // 玩家获得道具
                applyPowerup(player, powerup);
                powerups.splice(i, 1);
                gameEntities.delete(powerup.entity_id);
            }
        });
    }
}

// 应用道具效果
function applyPowerup(player, powerup) {
    const config = POWERUPS[powerup.powerup_type];
    log('INFO', 'Powerup collected', { player: player.name, type: powerup.powerup_type });
    
    // 广播道具获得消息
    clients.forEach((clientData, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                proto_id: 7001,
                data: {
                    player_id: player.owner_id,
                    powerup_type: powerup.powerup_type,
                    powerup_name: config.name,
                    duration: config.duration
                }
            }));
        }
    });
    
    // 应用效果
    if (powerup.powerup_type === 'grow') {
        player.radius *= config.effect;
    }
    
    // 效果持续时间后恢复
    setTimeout(() => {
        log('INFO', 'Powerup expired', { player: player.name, type: powerup.powerup_type });
    }, config.duration);
}


const wss = new WebSocket.Server({ port: PORT, verifyClient: () => true });
const clients = new Map();
const gameEntities = new Map();
let foods = [], bots = [], ejectedMasses = [];

log('INFO', 'Server starting', { port: PORT, map: MAP_WIDTH + 'x' + MAP_HEIGHT });

function spawnFood(count = 1) {
    for (let i = 0; i < count; i++) {
        foods.push({
            entity_id: 'food_' + uuidv4().slice(0, 6),
            type: 'food',
            x: Math.random() * MAP_WIDTH,
            y: Math.random() * MAP_HEIGHT,
            radius: 4 + Math.random() * 3,
            color: '#ffe66d',
            value: 1
        });
    }
}

function spawnEjectedMass(x, y, owner_id, angle, color = '#ff9ff3') {
    const speed = 8;
    ejectedMasses.push({
        entity_id: 'eject_' + uuidv4().slice(0, 6),
        type: 'eject',
        owner_id,
        x, y, radius: 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        value: 8,
        life: 100
    });
}

function spawnBot() {
    const botId = 'bot_' + uuidv4().slice(0, 6);
    const personalities = ['aggressive', 'passive', 'defensive', 'greedy'];
    const bot = {
        entity_id: botId,
        type: 'enemy',
        owner_id: 'bot',
        x: Math.random() * MAP_WIDTH,
        y: Math.random() * MAP_HEIGHT,
        radius: 15 + Math.random() * 12,
        vx: 0, vy: 0,
        skin_id: 'bot',
        name: 'Bot-' + botId.slice(-4),
        status: 'wander',
        personality: personalities[Math.floor(Math.random() * personalities.length)],
        targetX: Math.random() * MAP_WIDTH,
        targetY: Math.random() * MAP_HEIGHT,
        changeDirTimer: 0,
        splitCooldown: 0
    };
    bots.push(bot);
    gameEntities.set(botId, bot);
}

function initGame() {
    spawnFood(FOOD_COUNT);
    // 定期生成道具
    setInterval(spawnPowerup, 15000);
    for (let i = 0; i < BOT_COUNT; i++) spawnBot();
    log('INFO', 'Game initialized', { food: foods.length, bots: bots.length });
}

function updateEjectedMasses() {
    for (let i = ejectedMasses.length - 1; i >= 0; i--) {
        const eject = ejectedMasses[i];
        eject.x += eject.vx;
        eject.y += eject.vy;
        eject.vx *= 0.9;
        eject.vy *= 0.9;
        eject.life--;
        if (eject.life <= 0) ejectedMasses.splice(i, 1);
    }
}

function updateBots() {
    bots.forEach(bot => {
        bot.changeDirTimer++;
        if (bot.splitCooldown > 0) bot.splitCooldown--;
        if (bot.changeDirTimer > 60) {
            bot.changeDirTimer = 0;
            bot.targetX = Math.random() * MAP_WIDTH;
            bot.targetY = Math.random() * MAP_HEIGHT;
        }
        const dx = bot.targetX - bot.x;
        const dy = bot.targetY - bot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
            const speed = Math.max(1, 3 - bot.radius / 50);
            bot.vx = (dx / dist) * speed;
            bot.vy = (dy / dist) * speed;
            bot.x += bot.vx;
            bot.y += bot.vy;
        }
        bot.x = Math.max(bot.radius, Math.min(MAP_WIDTH - bot.radius, bot.x));
        bot.y = Math.max(bot.radius, Math.min(MAP_HEIGHT - bot.radius, bot.y));
    });
}

function checkCollisions() {
    const allEntities = [...gameEntities.values(), ...bots];
    allEntities.forEach(entity => {
        for (let i = foods.length - 1; i >= 0; i--) {
            const food = foods[i];
            const dx = entity.x - food.x;
            const dy = entity.y - food.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < entity.radius) {
                entity.radius = Math.min(100, entity.radius + food.value * 0.3);
                foods.splice(i, 1);
            }
        }
        for (let i = ejectedMasses.length - 1; i >= 0; i--) {
            const eject = ejectedMasses[i];
            if (eject.owner_id !== entity.owner_id) {
                const dx = entity.x - eject.x;
                const dy = entity.y - eject.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < entity.radius) {
                    entity.radius = Math.min(100, entity.radius + eject.value * 0.2);
                    ejectedMasses.splice(i, 1);
                }
            }
        }
    });
    for (let i = 0; i < allEntities.length; i++) {
        for (let j = i + 1; j < allEntities.length; j++) {
            const a = allEntities[i], b = allEntities[j];
            if (a.owner_id === 'bot' && b.owner_id === 'bot') continue;
            if (a.owner_id === b.owner_id) continue;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = a.radius + b.radius;
            if (dist < minDist && a.radius > b.radius * 1.15) {
                const growth = b.radius * 0.25;
                a.radius = Math.min(100, a.radius + growth);
                if (b.owner_id === 'bot') {
                    const idx = bots.indexOf(b);
                    if (idx > -1) {
                        bots.splice(idx, 1);
                        gameEntities.delete(b.entity_id);
                        setTimeout(spawnBot, 5000);
                    }
                }
            }
        }
    }
    if (foods.length < FOOD_COUNT) spawnFood(FOOD_COUNT - foods.length);
}

function syncBotsToEntities() {
    bots.forEach(bot => gameEntities.set(bot.entity_id, { ...bot }));
    ejectedMasses.forEach(eject => gameEntities.set(eject.entity_id, { ...eject }));
}

function splitEntity(entity, angle) {
    if (entity.radius < 35) return false;
    const splitRadius = entity.radius * 0.707;
    entity.radius = splitRadius;
    const newEntity = {
        entity_id: 'split_' + uuidv4().slice(0, 6),
        type: entity.type,
        owner_id: entity.owner_id,
        x: entity.x + Math.cos(angle) * 30,
        y: entity.y + Math.sin(angle) * 30,
        radius: splitRadius,
        vx: Math.cos(angle) * 10,
        vy: Math.sin(angle) * 10,
        skin_id: entity.skin_id,
        name: entity.name,
        status: 'split',
        splitCooldown: 120,
        createdAt: Date.now()  // 记录创建时间
    };
    if (entity.type === 'enemy') bots.push(newEntity);
    else gameEntities.set(newEntity.entity_id, newEntity);
    return true;
}

// 检查并合并分裂的球
function checkMerge() {
    const now = Date.now();
    const entities = Array.from(gameEntities.values());
    const toMerge = [];
    
    // 找到同一玩家的分裂球
    const playerEntities = {};
    entities.forEach(e => {
        if (e.type === 'master' || e.type === 'agent' || (e.type === 'split' && e.owner_id !== 'bot')) {
            if (!playerEntities[e.owner_id]) playerEntities[e.owner_id] = [];
            playerEntities[e.owner_id].push(e);
        }
    });
    
    // 检查合并条件
    Object.entries(playerEntities).forEach(([ownerId, playerParts]) => {
        if (playerParts.length < 2) return;
        
        for (let i = 0; i < playerParts.length; i++) {
            for (let j = i + 1; j < playerParts.length; j++) {
                const a = playerParts[i], b = playerParts[j];
                
                // 必须都是分裂出来的，且创建超过5秒
                if (a.status !== 'split' || b.status !== 'split') continue;
                if (!a.createdAt || !b.createdAt) continue;
                if (now - a.createdAt < 5000 || now - b.createdAt < 5000) continue;
                
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                // 如果距离小于两个球的半径之和，合并
                if (dist < a.radius + b.radius) {
                    const totalMass = a.radius * a.radius + b.radius * b.radius;
                    const newRadius = Math.sqrt(totalMass);
                    
                    // 保留大的那个
                    const survivor = a.radius > b.radius ? a : b;
                    const removed = a.radius > b.radius ? b : a;
                    
                    survivor.radius = Math.min(100, newRadius);
                    survivor.status = 'idle';
                    survivor.x = (a.x + b.x) / 2;
                    survivor.y = (a.y + b.y) / 2;
                    
                    gameEntities.delete(removed.entity_id);
                    toMerge.push({ survivor, removed });
                    
                    log('INFO', 'Entities merged', { ownerId, newRadius });
                }
            }
        }
    });
}

wss.on('connection', (ws, req) => {
    const origin = req.headers.origin || 'unknown';
    const clientIp = req.socket.remoteAddress;
    metrics.connections.total++;
    metrics.connections.current++;
    if (metrics.connections.current > metrics.connections.peak) {
        metrics.connections.peak = metrics.connections.current;
    }
    log('INFO', 'Player connected', { origin, clientIp, connections: metrics.connections.current });

    const playerId = 'player_' + uuidv4().slice(0, 8);
    const masterId = 'master_' + uuidv4().slice(0, 8);
    const agentId = 'agent_' + uuidv4().slice(0, 8);
    
    const clientData = {
        playerId, masterId, agentId, team,
        unlockedSkins: ['blue', 'red', 'green', 'purple', 'yellow', 'orange'],
        selectedSkin: 'blue',
        stats: { botsKilled: 0, maxMass: 0, playTime: 0 }
    };
    
    gameEntities.set(masterId, {
        entity_id: masterId, type: 'master', owner_id: playerId, team,
        x: teamConfig.spawnX + (Math.random() - 0.5) * 200, 
        y: teamConfig.spawnY + (Math.random() - 0.5) * 200,
        radius: 20, vx: 0, vy: 0,
        skin_id: clientData.selectedSkin,
        name: 'Player-' + playerId.slice(-4),
        status: 'idle', splitCooldown: 0
    });
    
    gameEntities.set(agentId, {
        entity_id: agentId, type: 'agent', owner_id: playerId, team,
        x: teamConfig.spawnX + (Math.random() - 0.5) * 200 + 50, 
        y: teamConfig.spawnY + (Math.random() - 0.5) * 200 + 50,
        radius: 18, vx: 0, vy: 0,
        skin_id: clientData.selectedSkin,
        name: 'AI-Partner',
        status: 'follow', splitCooldown: 0
    });
    
    clients.set(ws, clientData);
    
    ws.send(JSON.stringify({
        proto_id: 9001,
        timestamp: Date.now(),
        data: {
            message: 'Welcome to Blob Battle V3!',
            player_id: playerId, master_id: masterId, agent_id: agentId,
            team, team_name: teamConfig.name, team_color: teamConfig.color,
            map_width: MAP_WIDTH, map_height: MAP_HEIGHT,
            available_skins: SKINS,
            unlocked_skins: clientData.unlockedSkins,
            selected_skin: clientData.selectedSkin,
            game_mode: currentMode,
            team_scores: teamScores
        }
    }));
    
    ws.on('message', (message) => {
        try {
            metrics.messages.received++;
            const packet = JSON.parse(message);
            const { proto_id, data } = packet;
            const client = clients.get(ws);
            if (!client) return;
            
            if (proto_id === 1001) {
                const entity = gameEntities.get(client.masterId);
                if (entity && data.x !== undefined) {
                    entity.x = Math.max(0, Math.min(MAP_WIDTH, data.x));
                    entity.y = Math.max(0, Math.min(MAP_HEIGHT, data.y));
                }
            } else if (proto_id === 2001) {
                // Chat
            } else if (proto_id === 4001) {
                const master = gameEntities.get(client.masterId);
                const agent = gameEntities.get(client.agentId);
                const angle = data.angle || 0;
                if (master && master.splitCooldown <= 0 && master.radius >= 35) splitEntity(master, angle);
                if (agent && agent.splitCooldown <= 0 && agent.radius >= 35) splitEntity(agent, angle);
            } else if (proto_id === 5001) {
                const master = gameEntities.get(client.masterId);
                if (master && master.radius >= 20) {
                    master.radius -= 4;
                    const angle = data.angle || 0;
                    spawnEjectedMass(master.x, master.y, client.playerId, angle, SKINS[master.skin_id]?.color || '#ff9ff3');
                }
            } else if (proto_id === 6001) {
                if (data.skin_id && client.unlockedSkins.includes(data.skin_id)) {
                    client.selectedSkin = data.skin_id;
                    const master = gameEntities.get(client.masterId);
                    const agent = gameEntities.get(client.agentId);
                    if (master) master.skin_id = data.skin_id;
                    if (agent) agent.skin_id = data.skin_id;
                    ws.send(JSON.stringify({
                        proto_id: 6002,
                        data: { message: 'Skin changed', skin_id: data.skin_id }
                    }));
                }
            }
        } catch (error) {
            handleError(error, 'messageHandler');
        }
    });
    
    ws.on('close', (code, reason) => {
        metrics.connections.current--;
        log('INFO', 'Player disconnected', { playerId, code });
        clients.delete(ws);
        gameEntities.delete(masterId);
        gameEntities.delete(agentId);
    });
    
    ws.on('error', (error) => handleError(error, 'websocket'));
});

// 游戏循环 - 60Hz
setInterval(() => {
    try {
        // 平滑移动插值
        gameEntities.forEach(entity => {
            if (entity.vx || entity.vy) {
                // 使用插值计算位置，更平滑
                entity.x += entity.vx * 0.8;  // 稍微减速使移动更平滑
                entity.y += entity.vy * 0.8;
                entity.vx *= 0.95;  // 增加摩擦系数
                entity.vy *= 0.95;
                
                // 边界限制
                entity.x = Math.max(entity.radius, Math.min(MAP_WIDTH - entity.radius, entity.x));
                entity.y = Math.max(entity.radius, Math.min(MAP_HEIGHT - entity.radius, entity.y));
            }
            if (entity.splitCooldown > 0) entity.splitCooldown--;
        });
        
        // 检查分裂球合并
        checkMerge();
        
        updateEjectedMasses();
        updateBots();
        checkCollisions();
        checkPowerupCollisions();
        syncBotsToEntities();
    } catch (error) {
        handleError(error, 'gameLoop');
    }
}, 1000 / 60);

setInterval(() => {
    try {
        const worldState = {
            proto_id: 1001,
            timestamp: Date.now(),
            data: {
                entities: Array.from(gameEntities.values()),
                foods: foods.slice(0, 80),
                powerups: powerups.slice(0, 10),
                map_width: MAP_WIDTH,
                map_height: MAP_HEIGHT
            }
        };
        const msg = JSON.stringify(worldState);
        clients.forEach((info, ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(msg);
                metrics.messages.sent++;
            }
        });
    } catch (error) {
        handleError(error, 'broadcast');
    }
}, 100);

initGame();
log('INFO', 'V3 Server ready with skins!', { port: PORT });

setInterval(() => {
    const uptime = Math.floor((Date.now() - metrics.uptime) / 1000);
    log('METRICS', 'Server metrics', {
        uptime: uptime + 's',
        connections: metrics.connections,
        messages: metrics.messages,
        errors: metrics.errors.total,
        entities: gameEntities.size,
        foods: foods.length,
        bots: bots.length
    });
}, 60000);
