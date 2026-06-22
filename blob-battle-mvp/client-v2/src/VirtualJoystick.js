/**
 * VirtualJoystick - 虚拟摇杆
 * 跟随式: 触摸点=摇杆中心, 拖拽=方向输入
 * 对应 REQ-M2 虚拟摇杆触屏操控
 */
class VirtualJoystick {
  constructor(config = {}) {
    this.config = {
      radius: config.radius || 60,
      deadZone: config.deadZone || 5,
      maxDrag: config.maxDrag || 80,
      color: config.color || 'rgba(255, 255, 255, 0.3)',
      activeColor: config.activeColor || 'rgba(255, 255, 255, 0.5)',
      knobColor: config.knobColor || 'rgba(255, 255, 255, 0.8)',
      ...config,
    };

    this.active = false;
    this.baseX = 0;
    this.baseY = 0;
    this.dx = 0;
    this.dy = 0;
    this._animX = 0;
    this._animY = 0;
    this._releaseAnim = false;
    this._releaseStart = 0;
  }

  /**
   * 激活摇杆 (touchstart)
   */
  activate(screenX, screenY) {
    this.active = true;
    this.baseX = screenX;
    this.baseY = screenY;
    this.dx = 0;
    this.dy = 0;
    this._animX = 0;
    this._animY = 0;
    this._releaseAnim = false;
  }

  /**
   * 更新拖拽 (touchmove)
   */
  update(dragDx, dragDy) {
    if (!this.active) return;

    // Clamp 到最大拖拽距离
    const dist = Math.sqrt(dragDx * dragDx + dragDy * dragDy);
    if (dist > this.config.maxDrag) {
      dragDx = (dragDx / dist) * this.config.maxDrag;
      dragDy = (dragDy / dist) * this.config.maxDrag;
    }

    this.dx = dragDx;
    this.dy = dragDy;
    this._animX = dragDx;
    this._animY = dragDy;
  }

  /**
   * 释放 (touchend)
   */
  release() {
    this.active = false;
    this._releaseAnim = true;
    this._releaseStart = performance.now();
  }

  /**
   * 获取方向向量
   * @returns {{ vx: number, vy: number, magnitude: number }}
   */
  getDirection() {
    if (!this.active && !this._releaseAnim) {
      return { vx: 0, vy: 0, magnitude: 0 };
    }

    let x = this._animX;
    let y = this._animY;

    if (this._releaseAnim) {
      // 回弹动画 (150ms)
      const elapsed = performance.now() - this._releaseStart;
      if (elapsed > 150) {
        this._releaseAnim = false;
        return { vx: 0, vy: 0, magnitude: 0 };
      }
      const t = 1 - elapsed / 150; // 0->1 到 0
      x *= t;
      y *= t;
    }

    const magnitude = Math.sqrt(x * x + y * y) / this.config.maxDrag;
    if (magnitude < this.config.deadZone / this.config.maxDrag) {
      return { vx: 0, vy: 0, magnitude: 0 };
    }

    return {
      vx: x / this.config.maxDrag,
      vy: y / this.config.maxDrag,
      magnitude: Math.min(1, magnitude),
    };
  }

  /**
   * 渲染摇杆 (叠加在 Canvas 上)
   */
  render(ctx, canvasWidth, canvasHeight) {
    if (!this.active && !this._releaseAnim) return;

    const cx = this.baseX;
    const cy = this.baseY;
    const { radius } = this.config;

    // 外圈
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = this.config.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 拖拽球
    const knobX = cx + this._animX;
    const knobY = cy + this._animY;
    const knobRadius = radius * 0.45;

    ctx.beginPath();
    ctx.arc(knobX, knobY, knobRadius, 0, Math.PI * 2);
    ctx.fillStyle = this.config.knobColor;
    ctx.fill();

    // 连线
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(knobX, knobY);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * 是否激活
   */
  isActive() {
    return this.active;
  }

  cleanup() {
    this.active = false;
    this._releaseAnim = false;
  }
}

window.VirtualJoystick = VirtualJoystick;
