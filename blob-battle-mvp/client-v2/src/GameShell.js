/**
 * GameShell - 移动端游戏状态机
 * 管理 landing -> matchmaking -> playing -> gameover -> reconnecting 全生命周期
 * 对应 REQ-M1, REQ-M5, REQ-M6, REQ-M7
 */
class GameShell {
  constructor() {
    this.state = 'landing';
    this.modules = {};
    this._handlers = {};
  }

  /**
   * 注册模块
   * @param {string} name
   * @param {Object} instance
   */
  register(name, instance) {
    this.modules[name] = instance;
  }

  /**
   * 获取模块
   */
  get(name) {
    return this.modules[name];
  }

  /**
   * 监听状态变化
   * @param {string} state
   * @param {Function} onEnter - 进入状态时调用
   * @param {Function} onExit - 离开状态时调用
   */
  onState(state, onEnter, onExit) {
    if (!this._handlers[state]) {
      this._handlers[state] = [];
    }
    this._handlers[state].push({ onEnter, onExit });
  }

  /**
   * 切换状态
   * @param {string} newState
   * @param {Object} data - 传递给新状态的数据
   */
  switchState(newState, data = {}) {
    const validTransitions = {
      landing: ['matchmaking', 'playing'],
      matchmaking: ['playing', 'landing'],
      playing: ['gameover', 'reconnecting', 'landing'],
      gameover: ['matchmaking', 'landing'],
      reconnecting: ['playing', 'gameover'],
    };

    // 校验状态转换
    if (this.state !== newState) {
      const allowed = validTransitions[this.state] || [];
      if (!allowed.includes(newState)) {
        console.warn(`[GameShell] Invalid transition: ${this.state} -> ${newState}`);
        return;
      }
    }

    const prevState = this.state;

    // 退出旧状态
    const prevHandlers = this._handlers[prevState] || [];
    prevHandlers.forEach(h => h.onExit && h.onExit(data));

    this.state = newState;
    console.log(`[GameShell] State: ${prevState} -> ${newState}`);

    // 进入新状态
    const newHandlers = this._handlers[newState] || [];
    newHandlers.forEach(h => h.onEnter && h.onEnter(data));

    // 触发全局事件
    if (this._onStateChange) {
      this._onStateChange(newState, prevState, data);
    }
  }

  /**
   * 获取当前状态
   */
  getState() {
    return this.state;
  }

  /**
   * 销毁所有模块
   */
  cleanup() {
    Object.keys(this.modules).forEach(name => {
      const mod = this.modules[name];
      if (mod && typeof mod.cleanup === 'function') {
        mod.cleanup();
      }
    });
    this.modules = {};
    this._handlers = {};
  }
}

// 导出到全局 (Vanilla JS)
window.GameShell = GameShell;
