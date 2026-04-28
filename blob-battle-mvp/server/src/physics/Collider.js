/**
 * 球球大作战物理引擎核心模块
 * 负责：碰撞检测、吞噬逻辑、分裂机制、边界反弹
 */

class PhysicsEngine {
  constructor(config = {}) {
    this.config = {
      // 基础物理参数
      friction: config.friction || 0.98,        // 摩擦力/速度衰减
      bounceFactor: config.bounceFactor || 0.8, // 边界反弹系数
      mergeThreshold: config.mergeThreshold || 0.1, // 合并阈值（质量差小于此值则弹性碰撞）
      
      // 地图边界
      mapWidth: config.mapWidth || 2000,
      mapHeight: config.mapHeight || 2000,
      
      // 性能优化
      spatialGridSize: config.spatialGridSize || 100, // 空间网格大小
    };
    
    // 空间分区网格（用于优化碰撞检测）
    this.spatialGrid = new Map();
  }

  /**
   * 更新所有实体物理状态
   * @param {Array} entities - 实体数组
   * @param {number} deltaTime - 时间增量(ms)
   * @returns {Array} 更新后的实体数组
   */
  update(entities, deltaTime = 16) {
    // 1. 清空空间网格
    this.spatialGrid.clear();
    
    // 2. 将实体分配到空间网格
    this._updateSpatialGrid(entities);
    
    // 3. 应用速度和摩擦力
    entities.forEach(entity => {
      if (entity.status === 'normal' || entity.status === 'follow') {
        // 更新位置
        entity.x += entity.vx * (deltaTime / 16);
        entity.y += entity.vy * (deltaTime / 16);
        
        // 应用摩擦力
        entity.vx *= this.config.friction;
        entity.vy *= this.config.friction;
        
        // 速度低于阈值时停止
        if (Math.abs(entity.vx) < 0.01) entity.vx = 0;
        if (Math.abs(entity.vy) < 0.01) entity.vy = 0;
        
        // 边界检测和反弹
        this._handleBoundaryCollision(entity);
      }
    });
    
    // 4. 碰撞检测和解决
    this._resolveCollisions(entities);
    
    return entities;
  }

  /**
   * 更新空间网格
   */
  _updateSpatialGrid(entities) {
    entities.forEach((entity, index) => {
      const gridX = Math.floor(entity.x / this.config.spatialGridSize);
      const gridY = Math.floor(entity.y / this.config.spatialGridSize);
      const key = `${gridX},${gridY}`;
      
      if (!this.spatialGrid.has(key)) {
        this.spatialGrid.set(key, []);
      }
      this.spatialGrid.get(key).push(index);
    });
  }

  /**
   * 处理边界碰撞
   */
  _handleBoundaryCollision(entity) {
    const { mapWidth, mapHeight, bounceFactor } = this.config;
    const radius = entity.radius;
    
    // 左边界
    if (entity.x - radius < 0) {
      entity.x = radius;
      entity.vx = -entity.vx * bounceFactor;
    }
    // 右边界
    if (entity.x + radius > mapWidth) {
      entity.x = mapWidth - radius;
      entity.vx = -entity.vx * bounceFactor;
    }
    // 上边界
    if (entity.y - radius < 0) {
      entity.y = radius;
      entity.vy = -entity.vy * bounceFactor;
    }
    // 下边界
    if (entity.y + radius > mapHeight) {
      entity.y = mapHeight - radius;
      entity.vy = -entity.vy * bounceFactor;
    }
  }

  /**
   * 解决所有碰撞
   */
  _resolveCollisions(entities) {
    const checkedPairs = new Set();
    
    entities.forEach((entityA, indexA) => {
      const gridX = Math.floor(entityA.x / this.config.spatialGridSize);
      const gridY = Math.floor(entityA.y / this.config.spatialGridSize);
      
      // 只检查相邻网格中的实体（优化性能）
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKey = `${gridX + dx},${gridY + dy}`;
          const neighbors = this.spatialGrid.get(neighborKey) || [];
          
          neighbors.forEach(indexB => {
            if (indexA >= indexB) return; // 避免重复检查
            
            const pairKey = `${Math.min(indexA, indexB)}-${Math.max(indexA, indexB)}`;
            if (checkedPairs.has(pairKey)) return;
            checkedPairs.add(pairKey);
            
            const entityB = entities[indexB];
            this._resolveSingleCollision(entityA, entityB);
          });
        }
      }
    });
  }

  /**
   * 解决单个碰撞对
   */
  _resolveSingleCollision(entityA, entityB) {
    const dx = entityB.x - entityA.x;
    const dy = entityB.y - entityA.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = entityA.radius + entityB.radius;
    
    // 未碰撞
    if (distance >= minDistance || distance === 0) return;
    
    // 计算碰撞法向量
    const nx = dx / distance;
    const ny = dy / distance;
    
    // 判断是否可以吞噬（质量差超过阈值）
    const massA = Math.PI * entityA.radius * entityA.radius;
    const massB = Math.PI * entityB.radius * entityB.radius;
    const massRatio = Math.max(massA, massB) / Math.min(massA, massB);
    
    if (massRatio > 1.2 && !entityA.isAgent && !entityB.isAgent) {
      // 吞噬逻辑：大球吃小球
      if (massA > massB) {
        this._mergeEntities(entityA, entityB);
      } else {
        this._mergeEntities(entityB, entityA);
      }
      return;
    }
    
    // 弹性碰撞（包括 Agent 与主人、Agent 与 Agent）
    // 分离重叠部分
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
    
    // 交换速度在法向量方向的分量（简化弹性碰撞）
    const dvx = entityA.vx - entityB.vx;
    const dvy = entityA.vy - entityB.vy;
    const dvn = dvx * nx + dvy * ny;
    
    // 只在接近时处理
    if (dvn > 0) {
      const impulse = 2 * dvn / (massA + massB);
      
      entityA.vx -= impulse * massB * nx;
      entityA.vy -= impulse * massB * ny;
      entityB.vx += impulse * massA * nx;
      entityB.vy += impulse * massA * ny;
    }
  }

  /**
   * 合并实体（大球吃小球）
   */
  _mergeEntities(large, small) {
    // 面积相加
    const areaLarge = Math.PI * large.radius * large.radius;
    const areaSmall = Math.PI * small.radius * small.radius;
    const newArea = areaLarge + areaSmall;
    
    // 计算新半径
    large.radius = Math.sqrt(newArea / Math.PI);
    
    // 标记小球为被吞噬
    small.status = 'eaten';
    small.radius = 0;
    small.vx = 0;
    small.vy = 0;
    
    // 可选：给大球增加一点速度动量
    const massRatio = areaSmall / areaLarge;
    if (massRatio > 0.1) {
      large.vx = (large.vx + small.vx * massRatio) / (1 + massRatio);
      large.vy = (large.vy + small.vy * massRatio) / (1 + massRatio);
    }
  }

  /**
   * 分裂逻辑
   * @param {Object} entity - 要分裂的实体
   * @param {number} splitAngle - 分裂角度（弧度）
   * @param {number} splitCount - 分裂数量
   * @returns {Array} 新生成的实体数组
   */
  splitEntity(entity, splitAngle, splitCount = 1) {
    const newEntities = [];
    const currentArea = Math.PI * entity.radius * entity.radius;
    
    // 最小分裂体积限制
    if (currentArea < Math.PI * 20 * 20) {
      return newEntities; // 太小不能分裂
    }
    
    // 计算分裂后的体积分配（母体保留一半，其余平分）
    const motherArea = currentArea * 0.5;
    const childArea = (currentArea - motherArea) / splitCount;
    
    // 更新母体半径
    entity.radius = Math.sqrt(motherArea / Math.PI);
    
    // 创建子球
    for (let i = 0; i < splitCount; i++) {
      const angle = splitAngle + (i * Math.PI * 2 / splitCount);
      const speed = 15; // 分裂初速度
      
      const child = {
        ...entity,
        entity_id: `${entity.entity_id}_split_${Date.now()}_${i}`,
        x: entity.x + Math.cos(angle) * (entity.radius + 5),
        y: entity.y + Math.sin(angle) * (entity.radius + 5),
        radius: Math.sqrt(childArea / Math.PI),
        vx: entity.vx + Math.cos(angle) * speed,
        vy: entity.vy + Math.sin(angle) * speed,
        status: entity.status,
        isChild: true,
        birthTime: Date.now(),
      };
      
      newEntities.push(child);
    }
    
    return newEntities;
  }

  /**
   * 计算两点距离
   */
  static distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 检查点是否在圆内
   */
  static pointInCircle(px, py, cx, cy, radius) {
    return PhysicsEngine.distance(px, py, cx, cy) <= radius;
  }
}

module.exports = PhysicsEngine;