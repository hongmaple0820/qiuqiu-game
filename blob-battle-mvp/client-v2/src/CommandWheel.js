/**
 * CommandWheel - 指令轮盘
 * 4 扇区长按触发, 滑动选择, 释放执行
 * 对应 REQ-M3 Agent 指令轮盘交互
 */
class CommandWheel {
  constructor(config = {}) {
    this.config = {
      radius: config.radius || 100,
      innerRadius: config.innerRadius || 40,
      sectors: config.sectors || [
        { action: 'attack', label: '进攻', color: '#e74c3c', angle: 0 },       // 上
        { action: 'merge_rally', label: '集合', color: '#9b59b6', angle: 90 }, // 右
        { action: 'retreat', label: '撤退', color: '#e67e22', angle: 180 },    // 下
        { action: 'free_roam', label: '自由', color: '#7f8c8d', angle: 270 },  // 左
      ],
      sectorGap: 5,    // 扇形间间隙(度)
      bgColor: 'rgba(0, 0, 0, 0.6)',
      highlightColor: 'rgba(255, 255, 255, 0.3)',
      ...config,
    };

    this.visible = false;
    this.x = 0;
    this.y = 0;
    this._activeSector = -1;
    this._onDispatch = null;
  }

  /**
   * 显示轮盘
   */
  show(screenX, screenY) {
    this.visible = true;
    this.x = screenX;
    this.y = screenY;
    this._activeSector = -1;
  }

  /**
   * 更新指向 (touchmove)
   */
  updateAngle(dragDx, dragDy) {
    if (!this.visible) return;

    const angle = (Math.atan2(dragDy, dragDx) * 180 / Math.PI + 360) % 360;
    this._activeSector = this._angleToSector(angle);
  }

  /**
   * 选择当前扇区 (touchend)
   * @returns {{ action: string, label: string } | null}
   */
  select() {
    if (!this.visible) return null;
    const result = this._activeSector >= 0 ? this.config.sectors[this._activeSector] : null;
    this.dismiss();
    return result;
  }

  /**
   * 关闭轮盘
   */
  dismiss() {
    this.visible = false;
    this._activeSector = -1;
  }

  /**
   * 获取当前选中指令
   */
  getSelectedAction() {
    if (this._activeSector < 0) return null;
    return this.config.sectors[this._activeSector];
  }

  /**
   * 渲染轮盘
   */
  render(ctx, canvasWidth, canvasHeight) {
    if (!this.visible) return;

    const { x, y, radius, innerRadius, sectors, sectorGap } = this.config;
    const gapRad = sectorGap * Math.PI / 180;
    const sectorAngle = (360 / sectors.length) * Math.PI / 180;

    ctx.save();

    // 半透明背景圆
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = this.config.bgColor;
    ctx.fill();

    // 绘制扇形
    sectors.forEach((sector, i) => {
      const startAngle = (sector.angle - (360 / sectors.length) / 2) * Math.PI / 180 + gapRad / 2;
      const endAngle = startAngle + sectorAngle - gapRad;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, radius, startAngle, endAngle);

      // 高亮
      if (i === this._activeSector) {
        ctx.fillStyle = this.config.highlightColor;
      } else {
        ctx.fillStyle = sector.color;
        ctx.globalAlpha = 0.6;
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      // 扇形边框
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // 内圈
    ctx.beginPath();
    ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 图标标签 (Unicode 符号)
    const icons = { attack: '\u2694', merge_rally: '\u2691', retreat: '\u26E8', free_roam: '\u2601' };
    sectors.forEach((sector, i) => {
      const midAngle = sector.angle * Math.PI / 180;
      const labelRadius = (radius + innerRadius) / 2;
      const lx = x + Math.cos(midAngle) * labelRadius;
      const ly = y + Math.sin(midAngle) * labelRadius;

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icons[sector.action] || sector.label[0], lx, ly);

      // 标签文字
      const textRadius = radius + 18;
      const tx = x + Math.cos(midAngle) * textRadius;
      const ty = y + Math.sin(midAngle) * textRadius;
      ctx.font = '12px Arial';
      ctx.fillText(sector.label, tx, ty);
    });

    ctx.restore();
  }

  /**
   * 注册指令派发回调
   */
  onDispatch(cb) {
    this._onDispatch = cb;
  }

  // ===== Private =====

  _angleToSector(angle) {
    const { sectors } = this.config;
    const sectorSize = 360 / sectors.length;

    for (let i = 0; i < sectors.length; i++) {
      const center = sectors[i].angle;
      const half = sectorSize / 2;

      // 处理跨越 0 度的情况
      let diff = ((angle - center + 180) % 360 + 360) % 360 - 180;

      if (Math.abs(diff) < half) {
        return i;
      }
    }
    return -1;
  }

  cleanup() {
    this.dismiss();
    this._onDispatch = null;
  }
}

window.CommandWheel = CommandWheel;
