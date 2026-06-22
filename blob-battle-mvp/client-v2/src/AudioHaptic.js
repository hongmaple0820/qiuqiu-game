/**
 * AudioHaptic - 音效与触觉反馈
 * Web Audio API 程序化音效 + Vibration API 震动
 * 对应 REQ-M8 音效与触觉反馈
 */
class AudioHaptic {
  constructor() {
    this.enabled = true;
    this.muted = false;
    this._ctx = null;
    this._initialized = false;
  }

  /**
   * Lazy init AudioContext (需要用户手势后才能创建)
   */
  _init() {
    if (this._initialized) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._initialized = true;
    } catch (e) {
      console.warn('[AudioHaptic] AudioContext not available');
    }
  }

  /**
   * 吞噬音效 (快速下降音调)
   */
  playEat() {
    if (this.muted) return;
    this._init();
    if (!this._ctx) return;

    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this._ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this._ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.3, this._ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this._ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this._ctx.destination);
    osc.start();
    osc.stop(this._ctx.currentTime + 0.08);
  }

  /**
   * 死亡音效 (噪声爆发, 渐弱)
   */
  playDeath() {
    if (this.muted) return;
    this._init();
    if (!this._ctx) return;

    const bufferSize = this._ctx.sampleRate * 0.3;
    const buffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const source = this._ctx.createBufferSource();
    const gain = this._ctx.createGain();

    source.buffer = buffer;
    gain.gain.setValueAtTime(0.5, this._ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this._ctx.currentTime + 0.3);

    source.connect(gain);
    gain.connect(this._ctx.destination);
    source.start();
  }

  /**
   * 指令确认音效 (三角波短音)
   */
  playCommandAck() {
    if (this.muted) return;
    this._init();
    if (!this._ctx) return;

    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, this._ctx.currentTime);

    gain.gain.setValueAtTime(0.2, this._ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this._ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this._ctx.destination);
    osc.start();
    osc.stop(this._ctx.currentTime + 0.1);

    // 震动
    this.vibrate([30]);
  }

  /**
   * 触觉震动
   * @param {number[]} pattern - 震动模式 [100, 50, 100] = 100ms/停50ms/100ms
   */
  vibrate(pattern) {
    if (!this.enabled || this.muted) return;
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // 静默失败
      }
    }
  }

  /**
   * 短震动
   */
  vibrateShort() {
    this.vibrate([15]);
  }

  /**
   * 静音开关
   */
  setMute(muted) {
    this.muted = muted;
  }

  /**
   * 切换静音
   */
  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  cleanup() {
    if (this._ctx) {
      this._ctx.close();
      this._ctx = null;
    }
    this._initialized = false;
  }
}

window.AudioHaptic = AudioHaptic;
