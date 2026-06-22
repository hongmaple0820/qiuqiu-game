/**
 * MobileRenderer - 响应式 Canvas 渲染器
 * 自适应 viewport + 相机跟踪 + 实体绘制
 * 对应 REQ-M1 自适应画布与渲染
 */
class MobileRenderer {
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = {
      mapWidth: config.mapWidth || 8000,
      mapHeight: config.mapHeight || 8000,
      viewportMultiplier: config.viewportMultiplier || 5,
      cameraLerp: config.cameraLerp || 0.15,
      minAcceptableFps: config.minAcceptableFps || 20,
      frameSkipFps: config.frameSkipFps || 15,
      bgColor: config.bgColor || '#16213e',
      gridColor: config.gridColor || '#1a1a2e',
      gridSize: config.gridSize || 40,
      ...config,
    };

    this.camera = { x: 0, y: 0, zoom: 1 };
    this.cameraTarget = { x: 0, y: 0 };
    this._lastFrameTime = 0;
    this._frameCount = 0;
    this._lowFpsCount = 0;
    this._qualityMode = 'high'; // high | low
    this._pixelRatio = 1;

    this._resize();
    this._bindResize();
  }

  /**
   * 设置相机跟踪目标
   */
  followTarget(target) {
    if (target) {
      this.cameraTarget.x = target.x;
      this.cameraTarget.y = target.y;
    }
  }

  /**
   * 主渲染循环
   * @param {Array} entities - 实体列表
   * @param {Object} playerState - 玩家状态 { master, agent }
   */
  render(entities, playerState) {
    const now = performance.now();
    const dt = now - this._lastFrameTime;
    this._lastFrameTime = now;

    // FPS 监控
    this._frameCount++;
    if (dt > 0) {
      const fps = 1000 / dt;
      if (fps < this.config.frameSkipFps) {
        this._lowFpsCount++;
        if (this._lowFpsCount >= 3) {
          this._qualityMode = 'low';
        }
      } else {
        this._lowFpsCount = Math.max(0, this._lowFpsCount - 1);
        if (this._lowFpsCount === 0) {
          this._qualityMode = 'high';
        }
      }
    }

    // 更新相机 (lerp 平滑)
    this._updateCamera();

    const ctx = this.ctx;

    // 清空
    ctx.fillStyle = this.config.bgColor;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    this._applyCamera(ctx);

    // 网格背景
    this._drawGrid(ctx);

    // 绘制实体
    for (const entity of entities) {
      this._drawEntity(ctx, entity, playerState);
    }

    ctx.restore();
  }

  /**
   * 获取 FPS 信息
   */
  getFpsStats() {
    return {
      qualityMode: this._qualityMode,
      pixelRatio: this._pixelRatio,
      cameraZoom: this.camera.zoom,
    };
  }

  // ===== Private =====

  _updateCamera() {
    // Lerp 平滑跟踪
    this.camera.x += (this.cameraTarget.x - this.camera.x) * this.config.cameraLerp;
    this.camera.y += (this.cameraTarget.y - this.camera.y) * this.config.cameraLerp;

    // 边界 clamp
    const halfW = this.canvas.width / (2 * this.camera.zoom);
    const halfH = this.canvas.height / (2 * this.camera.zoom);
    this.camera.x = Math.max(halfW, Math.min(this.config.mapWidth - halfW, this.camera.x));
    this.camera.y = Math.max(halfH, Math.min(this.config.mapHeight - halfH, this.camera.y));
  }

  _applyCamera(ctx) {
    const scale = this._pixelRatio * this.camera.zoom;
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-this.camera.x, -this.camera.y);
  }

  _drawGrid(ctx) {
    const { gridSize } = this.config;
    const r = Math.max(this.canvas.width, this.canvas.height) / (2 * this.camera.zoom) + 200;
    const left = this.camera.x - r;
    const top = this.camera.y - r;
    const right = this.camera.x + r;
    const bottom = this.camera.y + r;

    ctx.strokeStyle = this.config.gridColor;
    ctx.lineWidth = 1 / this._pixelRatio;

    const startX = Math.floor(left / gridSize) * gridSize;
    const startY = Math.floor(top / gridSize) * gridSize;

    for (let x = startX; x < right; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    for (let y = startY; y < bottom; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
  }

  _drawEntity(ctx, entity, playerState) {
    const { x, y, radius, type, name, isAgent, status } = entity;
    if (status === 'eaten' || status === 'eliminated') return;

    // 颜色映射
    const colors = {
      master: '#4ecdc4',
      agent: '#ff6b6b',
      food: '#ffe66d',
      virus: '#a64ac9',
      default: '#888888',
    };

    const color = colors[type] || colors.default;

    // 主体
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Agent 特殊视觉 (REQ-8)
    if (isAgent || type === 'agent') {
      // 外圈光晕 (低质量模式跳过)
      if (this._qualityMode === 'high') {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 107, 107, 0.4)';
        ctx.lineWidth = 3 / this._pixelRatio;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 内圈实线
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / this._pixelRatio;
      ctx.stroke();

      // AI 标识
      ctx.fillStyle = '#ffffff';
      const fontSize = Math.max(10, radius * 0.5) / this._pixelRatio;
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('AI', x, y + 4 / this._pixelRatio);
    } else {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / this._pixelRatio;
      ctx.stroke();
    }

    // 名字 (Agent 红色名字在上方)
    if (name) {
      ctx.fillStyle = (isAgent || type === 'agent') ? '#ff6b6b' : '#ffffff';
      const fontSize = Math.max(9, (isAgent || type === 'agent') ? 10 : 12) / this._pixelRatio;
      ctx.font = `${fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(name, x, y - radius - 5 / this._pixelRatio);
    }

    // Agent 连线到 Master
    if ((isAgent || type === 'agent') && playerState && playerState.master) {
      const m = playerState.master;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(m.x, m.y);
      ctx.strokeStyle = 'rgba(255, 107, 107, 0.3)';
      ctx.lineWidth = 2 / this._pixelRatio;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    this._pixelRatio = dpr;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    Object.assign(this.canvas.style, {
      width: '100vw',
      height: '100vh',
      position: 'absolute',
      top: '0',
      left: '0',
    });

    // 初始缩放: 让视口覆盖约 2000 单位宽
    this.camera.zoom = Math.min(this.canvas.width / (2000 * dpr), 1.5);
  }

  _bindResize() {
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this._resize(), 300);
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this._resize(), 100);
    });
  }

  cleanup() {
    window.removeEventListener('resize', this._bindResize);
    window.removeEventListener('orientationchange', this._bindResize);
  }
}

window.MobileRenderer = MobileRenderer;
