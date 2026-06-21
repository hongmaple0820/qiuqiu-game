/**
 * Interest Manager - 兴趣管理 (空间分区 + 增量同步)
 * 每个连接只同步自身 viewport 内的实体,使用 uniform grid 空间分区加速查询
 * 对应 REQ-11
 */

const GameConfig = require('../config/GameConfig');

class InterestManager {
  constructor(config = {}) {
    this.config = {
      cellSize: config.cellSize || 400,          // 网格单元边长
      viewportBuffer: config.viewportBuffer || 1.5, // 视野扩展倍数 (包含缓冲区)
      syncThreshold: config.syncThreshold || 2.0,   // 实体变化阈值 (位置/质量变化多少才算显著)
      maxSyncPerFrame: config.maxSyncPerFrame || 64, // 每帧最大同步实体数
    };

    // roomId -> UniformGrid
    this.grids = new Map();

    // playerId -> { lastSyncedEntities: Map<entity_id, SyncState> }
    this.playerStates = new Map();
  }

  // ===== Uniform Grid =====

  /**
   * 将房间实体放入网格
   * @param {string} roomId
   * @param {Array} entities
   */
  updateGrid(roomId, entities) {
    const grid = this._getOrCreateGrid(roomId);

    // 清空所有单元格 (array length = 0)
    for (const cell of grid.cells.values()) {
      cell.length = 0;
    }

    // 填充实体到单元格
    for (const entity of entities) {
      if (entity.status === 'eaten') continue;
      const cellKey = this._cellKey(entity.x, entity.y, grid.cellSize);
      if (!grid.cells.has(cellKey)) {
        grid.cells.set(cellKey, []);
      }
      grid.cells.get(cellKey).push(entity);
    }
  }

  /**
   * 获取玩家视野内的实体 (viewport 范围内的所有 cell)
   * @param {string} roomId
   * @param {string} playerId
   * @param {{ x: number, y: number, mass: number }} position - 玩家/Agent 位置
   * @param {number} viewportRadius - 视野半径
   * @returns {Array} 视野内实体列表
   */
  getEntitiesInView(roomId, playerId, position, viewportRadius) {
    const grid = this.grids.get(roomId);
    if (!grid || !position) return [];

    const bufferRadius = viewportRadius * this.config.viewportBuffer;
    const { minCellX, maxCellX, minCellY, maxCellY } = this._cellRange(
      position.x, position.y, bufferRadius, grid.cellSize,
      grid.mapWidth, grid.mapHeight
    );

    const entities = [];
    const seen = new Set();

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const cellKey = `${cx},${cy}`;
        const cell = grid.cells.get(cellKey);
        if (!cell) continue;

        for (const entity of cell) {
          if (seen.has(entity.entity_id)) continue;
          seen.add(entity.entity_id);

          // 距离过滤
          const dx = entity.x - position.x;
          const dy = entity.y - position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= bufferRadius) {
            entities.push(entity);
          }
        }
      }
    }

    return entities;
  }

  // ===== Delta Sync =====

  /**
   * 计算增量同步数据包 (仅发送变化的实体)
   * @param {string} roomId
   * @param {string} playerId
   * @param {Array} currentView - 当前视野内实体
   * @returns {{ added: Array, updated: Array, removed: Array<string> }}
   */
  computeDelta(roomId, playerId, currentView) {
    let state = this.playerStates.get(playerId);
    if (!state) {
      state = { lastSyncedEntities: new Map() };
      this.playerStates.set(playerId, state);
    }

    const added = [];
    const updated = [];
    const removed = [];
    const currentIds = new Set();

    for (const entity of currentView) {
      currentIds.add(entity.entity_id);

      const prev = state.lastSyncedEntities.get(entity.entity_id);
      if (!prev) {
        // 新进入视野
        added.push(this._serializeEntity(entity));
      } else if (this._hasChanged(prev, entity)) {
        // 实体发生变化
        updated.push(this._serializeEntity(entity));
      }

      // 更新记录
      state.lastSyncedEntities.set(entity.entity_id, {
        x: entity.x, y: entity.y, radius: entity.radius, mass: entity.mass,
        status: entity.status, type: entity.type,
      });
    }

    // 找出离开视野的实体
    for (const [entityId, _] of state.lastSyncedEntities) {
      if (!currentIds.has(entityId)) {
        removed.push(entityId);
        state.lastSyncedEntities.delete(entityId);
      }
    }

    return { added, updated, removed };
  }

  /**
   * 构建完整的增量同步消息
   * @returns {{ fullSync: boolean, proto_id: number, data: Object }}
   */
  buildSyncMessage(roomId, playerId, currentView, tick) {
    const delta = this.computeDelta(roomId, playerId, currentView);

    // 如果变化实体太多,回退到全量同步
    const totalChanges = delta.added.length + delta.updated.length + delta.removed.length;
    const fullSync = totalChanges > this.config.maxSyncPerFrame;

    if (fullSync) {
      // 重置状态,全量同步
      const state = this.playerStates.get(playerId);
      if (state) {
        state.lastSyncedEntities.clear();
        for (const entity of currentView) {
          state.lastSyncedEntities.set(entity.entity_id, {
            x: entity.x, y: entity.y, radius: entity.radius, mass: entity.mass,
            status: entity.status, type: entity.type,
          });
        }
      }

      return {
        fullSync: true,
        proto_id: 1001,
        data: {
          tick,
          entities: currentView.map(e => this._serializeEntity(e)),
        },
      };
    }

    return {
      fullSync: false,
      proto_id: 1001,
      data: {
        tick,
        added: delta.added,
        updated: delta.updated,
        removed: delta.removed,
      },
    };
  }

  /**
   * 获取玩家视野半径 (基于质量)
   */
  calcViewportRadius(mass) {
    const baseRadius = GameConfig.MASS_RADIUS_K * Math.sqrt(mass / Math.PI);
    return baseRadius * 3; // viewport 是半径的 3 倍
  }

  /**
   * 清理玩家状态
   */
  removePlayer(playerId) {
    this.playerStates.delete(playerId);
  }

  /**
   * 清理房间网格
   */
  removeRoom(roomId) {
    this.grids.delete(roomId);
  }

  reset() {
    this.grids.clear();
    this.playerStates.clear();
  }

  // ===== Private =====

  _getOrCreateGrid(roomId) {
    if (!this.grids.has(roomId)) {
      this.grids.set(roomId, {
        cells: new Map(),
        cellSize: this.config.cellSize,
        mapWidth: GameConfig.MAP_WIDTH,
        mapHeight: GameConfig.MAP_HEIGHT,
      });
    }
    return this.grids.get(roomId);
  }

  _cellKey(x, y, cellSize) {
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    return `${cx},${cy}`;
  }

  _cellRange(x, y, radius, cellSize, mapW, mapH) {
    const minCellX = Math.max(0, Math.floor((x - radius) / cellSize));
    const maxCellX = Math.min(Math.floor(mapW / cellSize), Math.floor((x + radius) / cellSize));
    const minCellY = Math.max(0, Math.floor((y - radius) / cellSize));
    const maxCellY = Math.min(Math.floor(mapH / cellSize), Math.floor((y + radius) / cellSize));
    return { minCellX, maxCellX, minCellY, maxCellY };
  }

  _hasChanged(prev, curr) {
    const posDelta = Math.abs(prev.x - curr.x) + Math.abs(prev.y - curr.y);
    const massDelta = Math.abs(prev.mass - curr.mass);
    const radiusDelta = Math.abs(prev.radius - curr.radius);
    const statusChanged = prev.status !== curr.status;

    return posDelta > this.config.syncThreshold * 0.3
      || massDelta > 5
      || radiusDelta > 1
      || statusChanged;
  }

  _serializeEntity(entity) {
    return {
      entity_id: entity.entity_id,
      type: entity.type,
      player_id: entity.player_id || '',
      x: entity.x,
      y: entity.y,
      radius: entity.radius || 20,
      mass: entity.mass || 0,
      vx: entity.vx || 0,
      vy: entity.vy || 0,
      skin_id: entity.skin_id || '',
      name: entity.name || '',
      status: entity.status || 'alive',
      isAgent: entity.isAgent || false,
    };
  }
}

module.exports = InterestManager;
