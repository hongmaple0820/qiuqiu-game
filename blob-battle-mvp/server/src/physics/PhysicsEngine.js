/**
 * 球球大作战物理引擎 v2 - 权威服务器端物理仿真
 * 负责：碰撞检测、吞噬逻辑、分裂/合并、吐孢子、刺球、边界处理
 * 对应 REQ-1 核心游戏物理与吞噬规则
 */

const GameConfig = require('../config/GameConfig');

class PhysicsEngine {
  constructor(config = {}) {
    this.config = {
      // 基础物理参数
      friction: config.friction || 0.98,
      bounceFactor: config.bounceFactor || 0.8,

      // 地图边界 (默认来自 GameConfig)
      mapWidth: config.mapWidth || GameConfig.MAP_WIDTH,
      mapHeight: config.mapHeight || GameConfig.MAP_HEIGHT,

      // 性能优化
      spatialGridSize: config.spatialGridSize || 300, // 14000/300 ≈ 47 格

      // 吞噬阈值 (REQ-1.AC2)
      swallowRatio: config.swallowRatio || GameConfig.SWALLOW_RATIO,

      // 质量-半径常数 (REQ-1.AC1)
      massRadiusK: config.massRadiusK || GameConfig.MASS_RADIUS_K,

      // 速度公式参数 (REQ-1.AC1)
      speedVMax: config.speedVMax || GameConfig.SPEED_V_MAX,
      speedMassMin: config.speedMassMin || GameConfig.SPEED_MASS_MIN,
      speedA: config.speedA || GameConfig.SPEED_A,

      // 分裂参数
      maxSplit: config.maxSplit || GameConfig.MAX_SPLIT,
      minSplitMass: config.minSplitMass || GameConfig.MIN_SPLIT_MASS,
      splitCount: config.splitCount || GameConfig.SPLIT_COUNT,
      splitMotherRatio: config.splitMotherRatio || GameConfig.SPLIT_MOTHER_RATIO,
      splitInitialSpeed: config.splitInitialSpeed || 15,

      // 合并冷却
      mergeCooldownTicks: config.mergeCooldownTicks || GameConfig.MERGE_COOLDOWN_TICKS,

      // 吐孢子
      ejectMassUnit: config.ejectMassUnit || GameConfig.EJECT_MASS_UNIT,
      minEjectMass: config.minEjectMass || GameConfig.MIN_EJECT_MASS,
      ejectSpeed: config.ejectSpeed || GameConfig.EJECT_SPEED,

      // 刺球
      virusDensity: config.virusDensity || GameConfig.VIRUS_DENSITY,
      virusSplitCount: config.virusSplitCount || GameConfig.VIRUS_SPLIT_COUNT,
      virusTriggerMassRatio: config.virusTriggerMassRatio || GameConfig.VIRUS_TRIGGER_MASS_RATIO,
    };

    // 空间分区网格
    this.spatialGrid = new Map();

    // 合并冷却追踪: entityId -> mergeReadyTick
    this.mergeCooldowns = new Map();

    // 当前 tick 计数器
    this.currentTick = 0;
  }

  // ========== 公开工具方法 ==========

  /** 质量 -> 半径 r = k * sqrt(mass / pi) (REQ-1.AC1) */
  static massToRadius(mass, k = GameConfig.MASS_RADIUS_K) {
    return k * Math.sqrt(mass / Math.PI);
  }

  /** 半径 -> 质量 mass = pi * r^2 / k^2 */
  static radiusToMass(radius, k = GameConfig.MASS_RADIUS_K) {
    return (Math.PI * radius * radius) / (k * k);
  }

  /** 计算移动速度 v = v_max * (mass_min / mass)^a (REQ-1.AC1) */
  static calcSpeed(mass, config = {}) {
    const vMax = config.speedVMax || GameConfig.SPEED_V_MAX;
    const massMin = config.speedMassMin || GameConfig.SPEED_MASS_MIN;
    const a = config.speedA || GameConfig.SPEED_A;
    const ratio = massMin / Math.max(mass, massMin * 0.01);
    return vMax * Math.pow(ratio, a);
  }

  /** 两点距离 */
  static distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** 检查点是否在圆内 */
  static pointInCircle(px, py, cx, cy, radius) {
    return PhysicsEngine.distance(px, py, cx, cy) <= radius;
  }

  // ========== 主更新循环 ==========

  /**
   * 更新所有实体物理状态
   * @param {Array} entities - 实体数组
   * @param {number} tick - 当前 tick 序号
   * @param {number} deltaTime - 时间增量(ms),默认按 TICK_RATE 计算
   * @returns {Object} { entities, events: [{type, data}] }
   */
  update(entities, tick = 0, deltaTime = null) {
    this.currentTick = tick;
    if (deltaTime === null) {
      deltaTime = 1000 / GameConfig.TICK_RATE; // 默认 33.3ms @30Hz
    }

    const events = [];

    // 1. 清空空间网格
    this.spatialGrid.clear();

    // 2. 实体分配到空间网格
    this._updateSpatialGrid(entities);

    // 3. 应用速度和摩擦力
    entities.forEach(entity => {
      if (entity.status === 'eaten' || entity.status === 'eliminated') return;
      if (entity.status === 'normal' || entity.status === 'follow' || !entity.status) {
        // 计算基于质量的当前最大速度
        const mass = this._getEntityMass(entity);
        const maxSpeed = PhysicsEngine.calcSpeed(mass, this.config);

        // 限制速度不超过最大值
        const currentSpeed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
        if (currentSpeed > maxSpeed) {
          const scale = maxSpeed / currentSpeed;
          entity.vx *= scale;
          entity.vy *= scale;
        }

        // 更新位置
        entity.x += entity.vx * (deltaTime / 16);
        entity.y += entity.vy * (deltaTime / 16);

        // 应用摩擦力
        entity.vx *= this.config.friction;
        entity.vy *= this.config.friction;

        // 速度低于阈值时停止
        if (Math.abs(entity.vx) < 0.01) entity.vx = 0;
        if (Math.abs(entity.vy) < 0.01) entity.vy = 0;

        // 边界检测 (REQ-1.AC3: 禁止穿越)
        this._handleBoundaryCollision(entity);
      }
    });

    // 4. 碰撞检测和解决
    const collisionEvents = this._resolveCollisions(entities);
    events.push(...collisionEvents);

    return { entities, events };
  }

  // ========== 空间网格 ==========

  _updateSpatialGrid(entities) {
    entities.forEach((entity, index) => {
      if (entity.status === 'eaten' || entity.status === 'eliminated') return;
      const gridX = Math.floor(entity.x / this.config.spatialGridSize);
      const gridY = Math.floor(entity.y / this.config.spatialGridSize);
      const key = `${gridX},${gridY}`;
      if (!this.spatialGrid.has(key)) {
        this.spatialGrid.set(key, []);
      }
      this.spatialGrid.get(key).push(index);
    });
  }

  // ========== 边界处理 ==========

  /**
   * 边界碰撞 - 硬边界禁止穿越 (REQ-1.AC3)
   */
  _handleBoundaryCollision(entity) {
    const { mapWidth, mapHeight, bounceFactor } = this.config;
    const radius = entity.radius;

    if (entity.x - radius < 0) {
      entity.x = radius;
      entity.vx = Math.abs(entity.vx) * bounceFactor;
    }
    if (entity.x + radius > mapWidth) {
      entity.x = mapWidth - radius;
      entity.vx = -Math.abs(entity.vx) * bounceFactor;
    }
    if (entity.y - radius < 0) {
      entity.y = radius;
      entity.vy = Math.abs(entity.vy) * bounceFactor;
    }
    if (entity.y + radius > mapHeight) {
      entity.y = mapHeight - radius;
      entity.vy = -Math.abs(entity.vy) * bounceFactor;
    }
  }

  // ========== 碰撞解决 ==========

  _resolveCollisions(entities) {
    const checkedPairs = new Set();
    const events = [];

    entities.forEach((entityA, indexA) => {
      if (entityA.status === 'eaten' || entityA.status === 'eliminated') return;

      const gridX = Math.floor(entityA.x / this.config.spatialGridSize);
      const gridY = Math.floor(entityA.y / this.config.spatialGridSize);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKey = `${gridX + dx},${gridY + dy}`;
          const neighbors = this.spatialGrid.get(neighborKey) || [];

          neighbors.forEach(indexB => {
            if (indexA >= indexB) return;

            const pairKey = `${Math.min(indexA, indexB)}-${Math.max(indexA, indexB)}`;
            if (checkedPairs.has(pairKey)) return;
            checkedPairs.add(pairKey);

            const entityB = entities[indexB];
            if (entityB.status === 'eaten' || entityB.status === 'eliminated') return;

            const result = this._resolveSingleCollision(entityA, entityB);
            if (result && result.event) {
              events.push(result.event);
            }
          });
        }
      }
    });

    return events;
  }

  /**
   * 解决单对碰撞 (REQ-1.AC2 核心逻辑)
   */
  _resolveSingleCollision(entityA, entityB) {
    const dx = entityB.x - entityA.x;
    const dy = entityB.y - entityA.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = entityA.radius + entityB.radius;

    if (distance >= minDistance || distance === 0) return null;

    const nx = dx / distance;
    const ny = dy / distance;

    const massA = this._getEntityMass(entityA);
    const massB = this._getEntityMass(entityB);
    const massRatio = massA >= massB ? massA / massB : massB / massA;

    // 判定是否能吞噬 (REQ-1.AC2: mass_A >= mass_B * 1.25 且 A 边界覆盖 B 中心)
    const canSwallow = massRatio > this.config.swallowRatio;

    // 检查是否可以吞噬 (考虑队伍/Agent关系)
    const sameTeam = entityA.teamId && entityB.teamId && entityA.teamId === entityB.teamId;
    const isSameOwner = entityA.player_id && entityB.player_id && entityA.player_id === entityB.player_id;

    if (canSwallow && !sameTeam) {
      let large, small;
      if (massA >= massB * this.config.swallowRatio) {
        // 检查 A 边界是否覆盖 B 中心 (REQ-1.AC2 中心覆盖判定)
        if (PhysicsEngine.pointInCircle(entityB.x, entityB.y, entityA.x, entityA.y, entityA.radius)) {
          large = entityA;
          small = entityB;
        }
      }
      if (!large && massB >= massA * this.config.swallowRatio) {
        if (PhysicsEngine.pointInCircle(entityA.x, entityA.y, entityB.x, entityB.y, entityB.radius)) {
          large = entityB;
          small = entityA;
        }
      }

      if (large && small) {
        // 检查合并冷却
        if (!this._canSwallow(large, small)) {
          // 冷却未过,转为弹性碰撞
          this._elasticCollision(entityA, entityB, nx, ny, distance, minDistance, massA, massB);
          return null;
        }

        const event = this._mergeEntities(large, small);
        return { event };
      }
    }

    // 弹性碰撞 (队伍内/Agent之间/质量相近/冷却未过)
    this._elasticCollision(entityA, entityB, nx, ny, distance, minDistance, massA, massB);
    return null;
  }

  /**
   * 检查是否可以吞噬 (合并冷却 + 同主限制)
   */
  _canSwallow(large, small) {
    // 同主人的实体之间不可吞噬
    if (large.player_id && small.player_id && large.player_id === small.player_id) {
      return false;
    }

    // 检查合并冷却: 只有分裂体之间需要冷却
    const largeCool = this.mergeCooldowns.get(large.entity_id);
    const smallCool = this.mergeCooldowns.get(small.entity_id);

    // 如果两方都有冷却记录且属于同一分裂组,检查冷却是否已过
    if (largeCool && smallCool && largeCool.rootId === smallCool.rootId) {
      if (this.currentTick < largeCool.readyTick || this.currentTick < smallCool.readyTick) {
        return false;
      }
    }

    return true;
  }

  /**
   * 弹性碰撞
   */
  _elasticCollision(entityA, entityB, nx, ny, distance, minDistance, massA, massB) {
    const overlap = minDistance - distance;
    const totalMass = massA + massB;

    if (totalMass > 0) {
      const ratioA = massB / totalMass;
      const ratioB = massA / totalMass;

      entityA.x -= nx * overlap * ratioA;
      entityA.y -= ny * overlap * ratioA;
      entityB.x += nx * overlap * ratioB;
      entityB.y += ny * overlap * ratioB;
    }

    const dvx = entityA.vx - entityB.vx;
    const dvy = entityA.vy - entityB.vy;
    const dvn = dvx * nx + dvy * ny;

    if (dvn > 0) {
      const impulse = 2 * dvn / totalMass;
      entityA.vx -= impulse * massB * nx;
      entityA.vy -= impulse * massB * ny;
      entityB.vx += impulse * massA * nx;
      entityB.vy += impulse * massA * ny;
    }
  }

  /**
   * 获取实体质量 (如果实体有 mass 字段则直接使用,否则从半径计算)
   */
  _getEntityMass(entity) {
    if (entity.mass !== undefined && entity.mass !== null) {
      return entity.mass;
    }
    return PhysicsEngine.radiusToMass(entity.radius, this.config.massRadiusK);
  }

  // ========== 吞噬 ==========

  /**
   * 合并实体 - 大球吃小球 (REQ-1.AC2)
   * @returns {Object|null} 吞噬事件
   */
  _mergeEntities(large, small) {
    const massLarge = this._getEntityMass(large);
    const massSmall = this._getEntityMass(small);
    const newMass = massLarge + massSmall;

    // 更新质量
    large.mass = newMass;
    // 更新半径 (REQ-1.AC1: r = k * sqrt(mass / pi))
    large.radius = PhysicsEngine.massToRadius(newMass, this.config.massRadiusK);

    // 标记小球被吞噬
    small.status = 'eaten';
    small.radius = 0;
    small.vx = 0;
    small.vy = 0;

    // 动量传递
    const massRatio = massSmall / massLarge;
    if (massRatio > 0.1) {
      large.vx = (large.vx + small.vx * massRatio) / (1 + massRatio);
      large.vy = (large.vy + small.vy * massRatio) / (1 + massRatio);
    }

    // 清理吞噬者的合并冷却
    this.mergeCooldowns.delete(small.entity_id);

    return {
      type: 'swallow',
      data: {
        large_id: large.entity_id,
        small_id: small.entity_id,
        large_mass: newMass,
        small_mass: massSmall,
        large_pos: { x: large.x, y: large.y },
        small_pos: { x: small.x, y: small.y },
        tick: this.currentTick,
      },
    };
  }

  // ========== 分裂 (REQ-1.AC5) ==========

  /**
   * 分裂实体
   * @param {Object} entity - 要分裂的球
   * @param {number} splitAngle - 分裂方向角度(弧度)
   * @param {Object} options - 可选覆盖参数
   * @returns {Array} 新生成的子球
   */
  splitEntity(entity, splitAngle, options = {}) {
    const splitCount = options.splitCount || this.config.splitCount;
    const motherRatio = options.motherRatio || this.config.splitMotherRatio;
    const initialSpeed = options.initialSpeed || this.config.splitInitialSpeed;

    const currentMass = this._getEntityMass(entity);

    // 最小分裂质量限制 (REQ-1.AC4)
    if (currentMass < (options.minSplitMass || this.config.minSplitMass)) {
      return [];
    }

    const motherMass = currentMass * motherRatio;
    const childMass = (currentMass - motherMass) / splitCount;

    // 更新母体质量和半径
    entity.mass = motherMass;
    entity.radius = PhysicsEngine.massToRadius(motherMass, this.config.massRadiusK);

    // 设置合并冷却 (REQ-1.AC6)
    const rootId = entity.root_entity || entity.entity_id;
    const readyTick = this.currentTick + (options.mergeCooldownTicks || this.config.mergeCooldownTicks);
    this.mergeCooldowns.set(entity.entity_id, { rootId, readyTick });

    const newEntities = [];

    for (let i = 0; i < splitCount; i++) {
      const angle = splitAngle + (splitCount > 1 ? (i - (splitCount - 1) / 2) * 0.5 : 0);
      const childId = `${entity.entity_id}_split_${this.currentTick}_${i}`;

      const child = {
        entity_id: childId,
        type: entity.type,
        player_id: entity.player_id,
        teamId: entity.teamId,
        x: entity.x + Math.cos(angle) * (entity.radius + 10),
        y: entity.y + Math.sin(angle) * (entity.radius + 10),
        radius: PhysicsEngine.massToRadius(childMass, this.config.massRadiusK),
        mass: childMass,
        vx: entity.vx + Math.cos(angle) * initialSpeed,
        vy: entity.vy + Math.sin(angle) * initialSpeed,
        status: entity.status || 'normal',
        skin_id: entity.skin_id,
        name: entity.name,
        isChild: true,
        root_entity: rootId,
        birthTick: this.currentTick,
        isAgent: entity.isAgent || false,
        agentTier: entity.agentTier,
        powerup_effect: entity.powerup_effect ? { ...entity.powerup_effect } : null,
      };

      // 设置子球的合并冷却
      this.mergeCooldowns.set(childId, { rootId, readyTick });

      newEntities.push(child);
    }

    return newEntities;
  }

  /** 获取实体的分裂体计数(同分裂组) */
  getSplitCount(entity) {
    if (!entity.root_entity && !entity.birthTick) return 1; // 不是分裂体

    const rootId = entity.root_entity || entity.entity_id;
    // 这里需要外部传入所有实体来统计,但简化实现:使用 birthTick 判断
    return 1; // 由外部 GameLoop 维护
  }

  // ========== 吐孢子 (REQ-1.AC7) ==========

  /**
   * 吐孢子
   * @param {Object} entity - 吐孢子的球
   * @param {number} angle - 吐出方向(弧度)
   * @param {Object} options - 可选覆盖参数
   * @returns {Object|null} 生成的孢子实体,null 表示质量不足
   */
  ejectMass(entity, angle, options = {}) {
    const massUnit = options.ejectMassUnit || this.config.ejectMassUnit;
    const minMass = options.minEjectMass || this.config.minEjectMass;
    const ejectSpeed = options.ejectSpeed || this.config.ejectSpeed;

    const currentMass = this._getEntityMass(entity);

    if (currentMass < minMass + massUnit) {
      return null;
    }

    // 扣除母体质量
    entity.mass = currentMass - massUnit;
    entity.radius = PhysicsEngine.massToRadius(entity.mass, this.config.massRadiusK);

    // 生成孢子
    const sporeId = `${entity.entity_id}_eject_${this.currentTick}`;
    const spore = {
      entity_id: sporeId,
      type: 'ejected_mass',
      player_id: entity.player_id,
      teamId: entity.teamId,
      x: entity.x + Math.cos(angle) * (entity.radius + 5),
      y: entity.y + Math.sin(angle) * (entity.radius + 5),
      radius: PhysicsEngine.massToRadius(massUnit, this.config.massRadiusK),
      mass: massUnit,
      vx: Math.cos(angle) * ejectSpeed + entity.vx * 0.3,
      vy: Math.sin(angle) * ejectSpeed + entity.vy * 0.3,
      status: 'normal',
      foodValue: massUnit,
    };

    return spore;
  }

  // ========== 食物碰撞 (非球对球) ==========

  /**
   * 检查并执行实体吃食物
   * @param {Object} entity - 球实体
   * @param {Array} foods - 食物数组
   * @returns {Array} 被吃掉的食物 entity_id 列表
   */
  eatFoods(entity, foods) {
    const eatenIds = [];

    foods.forEach(food => {
      if (food.status === 'eaten') return;

      const dist = PhysicsEngine.distance(entity.x, entity.y, food.x, food.y);

      // 球中心覆盖食物中心即吞噬 (REQ-1.AC2 的同理应用)
      if (dist < entity.radius) {
        const foodMass = food.mass || (food.foodValue || 2);
        const currentMass = this._getEntityMass(entity);

        entity.mass = currentMass + foodMass;
        entity.radius = PhysicsEngine.massToRadius(entity.mass, this.config.massRadiusK);

        food.status = 'eaten';
        eatenIds.push(food.entity_id);
      }
    });

    return eatenIds;
  }

  // ========== 刺球 (Virus) ==========

  /**
   * 检查实体与刺球的碰撞 (REQ-1)
   * @param {Object} entity - 球实体
   * @param {Array} viruses - 刺球数组
   * @param {Object} options - 可选覆盖参数
   * @returns {Object|null} { entity, newChildren[] }
   */
  checkVirusCollision(entity, viruses, options = {}) {
    const triggerRatio = options.virusTriggerMassRatio || this.config.virusTriggerMassRatio;
    const splitCount = options.virusSplitCount || this.config.virusSplitCount;

    const entityMass = this._getEntityMass(entity);

    for (let i = viruses.length - 1; i >= 0; i--) {
      const virus = viruses[i];
      if (virus.status === 'eaten') continue;

      const virusMass = this._getEntityMass(virus);
      const dist = PhysicsEngine.distance(entity.x, entity.y, virus.x, virus.y);

      // 球中心覆盖刺球中心
      if (dist < entity.radius) {
        // 超质量阈值碰撞强制分裂
        if (entityMass > virusMass * triggerRatio) {
          // 随机分裂方向
          const randomAngle = Math.random() * Math.PI * 2;
          const newChildren = this.splitEntity(entity, randomAngle, {
            splitCount,
            minSplitMass: 0, // 刺球分裂不受最小质量限制
            motherRatio: 0.6,
            initialSpeed: 20,
          });

          return { entity, newChildren };
        }

        // 质量不足,弹开
        const dx = entity.x - virus.x;
        const dy = entity.y - virus.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        entity.vx += (dx / d) * 5;
        entity.vy += (dy / d) * 5;
      }
    }

    return null;
  }

  // ========== 合并冷却管理 ==========

  /** 检查两个实体是否可以合并 (同一分裂组 + 冷却已过) */
  canMerge(entityA, entityB) {
    const coolA = this.mergeCooldowns.get(entityA.entity_id);
    const coolB = this.mergeCooldowns.get(entityB.entity_id);

    if (!coolA || !coolB) return true; // 至少一方无冷却记录
    if (coolA.rootId !== coolB.rootId) return true; // 不属于同一分裂组

    return this.currentTick >= coolA.readyTick && this.currentTick >= coolB.readyTick;
  }

  /** 设置实体的合并冷却 */
  setMergeCooldown(entityId, rootId, readyTick) {
    this.mergeCooldowns.set(entityId, { rootId, readyTick });
  }

  /** 清理被删除实体的冷却记录 */
  cleanupCooldowns(validEntityIds) {
    const validSet = new Set(validEntityIds);
    for (const key of this.mergeCooldowns.keys()) {
      if (!validSet.has(key)) {
        this.mergeCooldowns.delete(key);
      }
    }
  }
}

module.exports = PhysicsEngine;
