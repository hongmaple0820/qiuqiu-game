/**
 * TouchInput - 移动端触摸手势识别
 * 支持 tap / longpress / pan / doubletap
 * 多点触控分区识别 (左半屏=摇杆, 右半屏=指令)
 * 对应 REQ-M2, REQ-M3
 */
class TouchInput {
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.config = {
      leftRatio: config.leftRatio || 0.45,
      rightRatio: config.rightRatio || 0.55,
      longpressMs: config.longpressMs || 200,
      doubletapMs: config.doubletapMs || 300,
      tapMaxDist: config.tapMaxDist || 10,
      ...config,
    };

    this._touches = {};          // identifier -> TouchState
    this._lastTapTime = 0;
    this._lastTapPos = null;
    this._enabled = true;

    this._callbacks = {
      joystickStart: null,
      joystickMove: null,
      joystickEnd: null,
      tap: null,
      longpress: null,
      doubletap: null,
      wheelShow: null,
      wheelMove: null,
      wheelSelect: null,
    };

    this._bindEvents();
  }

  /**
   * 注册回调
   * @param {string} event - joystickStart|joystickMove|joystickEnd|tap|longpress|doubletap|wheelShow|wheelMove|wheelSelect
   * @param {Function} cb
   */
  on(event, cb) {
    if (this._callbacks.hasOwnProperty(event)) {
      this._callbacks[event] = cb;
    }
  }

  enable() { this._enabled = true; }
  disable() { this._enabled = false; }

  // ===== Private =====

  _bindEvents() {
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!this._enabled) return;
      for (const touch of e.changedTouches) {
        this._onTouchStart(touch);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!this._enabled) return;
      for (const touch of e.changedTouches) {
        this._onTouchMove(touch);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (!this._enabled) return;
      for (const touch of e.changedTouches) {
        this._onTouchEnd(touch);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchcancel', (e) => {
      for (const touch of e.changedTouches) {
        this._onTouchEnd(touch);
      }
    });
  }

  _getZone(x) {
    const w = this.canvas.clientWidth;
    const ratio = x / w;
    if (ratio < this.config.leftRatio) return 'left';
    if (ratio > this.config.rightRatio) return 'right';
    return 'middle'; // 缓冲区
  }

  _onTouchStart(touch) {
    const zone = this._getZone(touch.clientX);
    const state = {
      id: touch.identifier,
      zone,
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      startTime: Date.now(),
      longpressTimer: null,
      isPan: false,
    };

    this._touches[touch.identifier] = state;

    if (zone === 'left') {
      // 左半屏 = 摇杆
      this._callbacks.joystickStart && this._callbacks.joystickStart(state.startX, state.startY);
    } else if (zone === 'right') {
      // 右半屏 = 指令区, 启动长按计时器
      state.longpressTimer = setTimeout(() => {
        if (this._touches[touch.identifier]) {
          this._callbacks.wheelShow && this._callbacks.wheelShow(state.startX, state.startY);
          this._touches[touch.identifier]._wheelActive = true;
        }
      }, this.config.longpressMs);
    }
  }

  _onTouchMove(touch) {
    const state = this._touches[touch.identifier];
    if (!state) return;

    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;

    state.currentX = touch.clientX;
    state.currentY = touch.clientY;

    // Pan 检测 (移动超过阈值)
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      state.isPan = true;
      if (state.longpressTimer) {
        clearTimeout(state.longpressTimer);
        state.longpressTimer = null;
      }
    }

    if (state.zone === 'left') {
      // 摇杆移动
      this._callbacks.joystickMove && this._callbacks.joystickMove(dx, dy);
    } else if (state.zone === 'right' && state._wheelActive) {
      // 轮盘扇形切换
      this._callbacks.wheelMove && this._callbacks.wheelMove(dx, dy);
    }
  }

  _onTouchEnd(touch) {
    const state = this._touches[touch.identifier];
    if (!state) return;

    // 清理长按计时器
    if (state.longpressTimer) {
      clearTimeout(state.longpressTimer);
    }

    const dt = Date.now() - state.startTime;

    if (state.zone === 'left') {
      // 摇杆释放
      this._callbacks.joystickEnd && this._callbacks.joystickEnd();
    } else if (state.zone === 'right') {
      if (state._wheelActive) {
        // 轮盘释放 = 选择指令
        this._callbacks.wheelSelect && this._callbacks.wheelSelect();
      } else if (dt < this.config.longpressMs && !state.isPan) {
        // 快速点击 (< 200ms, 无移动)
        const now = Date.now();
        const pos = { x: state.startX, y: state.startY };

        if (this._lastTapTime && (now - this._lastTapTime) < this.config.doubletapMs) {
          // 双击
          this._callbacks.doubletap && this._callbacks.doubletap(pos);
          this._lastTapTime = 0;
        } else {
          // 单击
          this._lastTapTime = now;
          this._lastTapPos = pos;
          // 延迟触发 tap (等 doubletap 判定)
          setTimeout(() => {
            if (this._lastTapTime === now) {
              this._callbacks.tap && this._callbacks.tap(pos);
            }
          }, this.config.doubletapMs);
        }
      }
    }

    delete this._touches[touch.identifier];
  }

  /**
   * 获取触控分区
   */
  getZone(x) {
    return this._getZone(x);
  }

  cleanup() {
    this._touches = {};
    this._callbacks = {};
    this._enabled = false;
  }
}

window.TouchInput = TouchInput;
