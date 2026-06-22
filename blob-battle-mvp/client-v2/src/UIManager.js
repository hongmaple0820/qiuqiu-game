/**
 * UIManager - 移动端 UI 布局管理器
 * 顶部状态栏 + 小地图 + Toast + 覆盖层 (landing/gameover/reconnecting)
 * 对应 REQ-M4 移动端 UI 布局, REQ-M5 快速开局, REQ-M7 游戏结算
 */
class UIManager {
  constructor(config = {}) {
    this.config = {
      topBarHeight: config.topBarHeight || '8vh',
      minimapSize: config.minimapSize || 15, // vw
      toastDuration: config.toastDuration || 3000,
      ...config,
    };

    this._toastTimer = null;
    this._toasts = [];
    this._callbackMap = {}; // overlay callbacks

    this._createElements();
  }

  /**
   * 注册回调
   */
  onClick(buttonId, cb) {
    this._callbackMap[buttonId] = cb;
    const el = document.getElementById(buttonId);
    if (el) {
      el.addEventListener('click', cb);
    }
  }

  /**
   * 更新顶部状态栏
   * @param {{ mass: number, rank: number, leaderName: string }} data
   */
  updateTopBar(data) {
    if (!this._topBar) return;
    const el = this._topBar;

    if (data.mass !== undefined) {
      el.querySelector('.mass-value').textContent = Math.floor(data.mass);
    }
    if (data.rank !== undefined) {
      el.querySelector('.rank-value').textContent = `#${data.rank}`;
    }
    if (data.leaderName !== undefined) {
      el.querySelector('.leader-name').textContent = data.leaderName || '-';
    }
  }

  /**
   * 更新小地图
   * @param {Array} entities
   * @param {{ x, y, radius }} master
   */
  updateMinimap(entities, master, mapWidth, mapHeight) {
    if (!this._minimap) return;
    const canvas = this._minimap;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = (this.config.minimapSize / 100) * window.innerWidth;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, size, size);

    const scaleX = size / (mapWidth || 8000);
    const scaleY = size / (mapHeight || 8000);

    // 实体点
    for (const e of entities || []) {
      const ex = e.x * scaleX;
      const ey = e.y * scaleY;
      const r = Math.max(2, e.radius * scaleX * 0.5);

      ctx.beginPath();
      ctx.arc(ex, ey, r, 0, Math.PI * 2);

      if (e.type === 'food') {
        ctx.fillStyle = '#ffe66d';
      } else if (e.isAgent || e.type === 'agent') {
        ctx.fillStyle = '#ff6b6b';
      } else if (e.type === 'master') {
        ctx.fillStyle = '#4ecdc4';
      } else {
        ctx.fillStyle = '#888888';
      }
      ctx.fill();
    }

    // 视野框 (当前可见区域)
    if (master) {
      const vpR = (master.radius || 20) * 5 * scaleX;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        master.x * scaleX - vpR,
        master.y * scaleY - vpR,
        vpR * 2, vpR * 2
      );
    }
  }

  /**
   * 显示 Toast 浮动提示
   */
  showToast(message, type = 'info') {
    if (!this._toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    this._toastContainer.appendChild(toast);

    // 入场动画
    requestAnimationFrame(() => {
      toast.classList.add('toast-show');
    });

    // 自动消失
    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 300);
    }, this.config.toastDuration);
  }

  /**
   * 显示覆盖层
   * @param {string} type - landing | gameover | reconnecting
   * @param {Object} data - 附加数据
   */
  showOverlay(type, data = {}) {
    this.hideOverlay();

    const overlay = document.getElementById('overlay-container');
    if (!overlay) return;

    let html = '';
    switch (type) {
      case 'landing':
        html = this._buildLandingOverlay();
        break;
      case 'gameover':
        html = this._buildGameOverOverlay(data);
        break;
      case 'reconnecting':
        html = this._buildReconnectingOverlay(data);
        break;
      default:
        return;
    }

    overlay.innerHTML = html;
    overlay.style.display = 'flex';

    // 绑定按钮事件
    this._bindOverlayButtons(type, data);
  }

  /**
   * 隐藏覆盖层
   */
  hideOverlay() {
    const overlay = document.getElementById('overlay-container');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
    }
  }

  /**
   * 更新重连计时器
   */
  updateReconnectTimer(elapsed, maxTime) {
    const el = document.getElementById('reconnect-timer');
    if (el) {
      const remaining = Math.max(0, Math.ceil((maxTime - elapsed) / 1000));
      el.textContent = `${remaining}s`;
    }
  }

  // ===== Private =====

  _createElements() {
    // 顶部状态栏
    const topBar = document.createElement('div');
    topBar.id = 'top-bar';
    topBar.innerHTML = `
      <div class="top-bar-mass">
        <span class="mass-icon"></span>
        <span class="mass-value">0</span>
      </div>
      <div class="top-bar-rank">
        <span class="rank-value">#0</span>
      </div>
      <div class="top-bar-leader">
        <span class="leader-label">Top:</span>
        <span class="leader-name">-</span>
      </div>
    `;
    this._topBar = topBar;

    // 小地图 Canvas (隐藏默认)
    const minimap = document.createElement('canvas');
    minimap.id = 'minimap';
    minimap.className = 'minimap';
    this._minimap = minimap;

    // Toast 容器
    const toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    this._toastContainer = toastContainer;

    // 覆盖层容器
    const overlay = document.createElement('div');
    overlay.id = 'overlay-container';
    overlay.style.display = 'none';
    this._overlay = overlay;

    document.body.appendChild(topBar);
    document.body.appendChild(minimap);
    document.body.appendChild(toastContainer);
    document.body.appendChild(overlay);
  }

  _buildLandingOverlay() {
    return `
      <div class="overlay-content landing-overlay">
        <h1 class="game-title">共生球域</h1>
        <p class="game-subtitle">Symbiotic Sphere</p>
        <button id="btn-quick-match" class="btn-primary">快速开局</button>
        <div class="room-code-section">
          <input id="input-room-code" type="text" maxlength="6" placeholder="输入房间码" autocomplete="off" />
          <button id="btn-join-room" class="btn-secondary">加入房间</button>
        </div>
        <button id="btn-settings" class="btn-icon">静音</button>
      </div>
    `;
  }

  _buildGameOverOverlay(data) {
    return `
      <div class="overlay-content gameover-overlay">
        <h2>游戏结束</h2>
        <div class="stat-card">
          <div class="stat-item">
            <span class="stat-label">最终排名</span>
            <span class="stat-value rank-number">#${data.rank || '?'}</span>
          </div>
          <div class="stat-row">
            <div class="stat-item">
              <span class="stat-label">存活时间</span>
              <span class="stat-value">${data.survivalTime || '0s'}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">峰值质量</span>
              <span class="stat-value">${Math.floor(data.peakMass || 0)}</span>
            </div>
          </div>
          <div class="stat-item">
            <span class="stat-label">击杀数</span>
            <span class="stat-value">${data.eliminations || 0}</span>
          </div>
        </div>
        <button id="btn-play-again" class="btn-primary">再来一局</button>
        <button id="btn-back-lobby" class="btn-secondary">返回大厅</button>
      </div>
    `;
  }

  _buildReconnectingOverlay(data) {
    return `
      <div class="overlay-content reconnect-overlay">
        <div class="reconnect-spinner"></div>
        <h3>重新连接中...</h3>
        <p id="reconnect-timer">${data.maxTime ? Math.ceil(data.maxTime / 1000) : 30}s</p>
        <p class="reconnect-hint">请不要关闭页面</p>
      </div>
    `;
  }

  _bindOverlayButtons(type, data) {
    if (type === 'landing') {
      document.getElementById('btn-quick-match')?.addEventListener('click', () => {
        if (this._callbackMap['quick-match']) this._callbackMap['quick-match']();
      });
      document.getElementById('btn-join-room')?.addEventListener('click', () => {
        const code = document.getElementById('input-room-code')?.value || '';
        if (this._callbackMap['join-room']) this._callbackMap['join-room'](code);
      });
      document.getElementById('btn-settings')?.addEventListener('click', () => {
        if (this._callbackMap['settings']) this._callbackMap['settings']();
      });
    } else if (type === 'gameover') {
      document.getElementById('btn-play-again')?.addEventListener('click', () => {
        if (this._callbackMap['play-again']) this._callbackMap['play-again']();
      });
      document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
        if (this._callbackMap['back-lobby']) this._callbackMap['back-lobby']();
      });
    }
  }

  cleanup() {
    if (this._toastTimer) clearTimeout(this._toastTimer);
    Object.values(['_topBar', '_minimap', '_toastContainer', '_overlay']).forEach(key => {
      const el = this[key];
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }
}

window.UIManager = UIManager;
