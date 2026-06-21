/**
 * Noise Config Schema - 拟人化噪声配置
 * 注入到 Reflex 层输出,使 Agent 行为避免过于机械完美
 * 对应 REQ-4
 */

const DifficultyLevel = Object.freeze({
  EASY: 'easy',           // 陪练模式 - 噪声最低,Agent 更强的表现
  NORMAL: 'normal',       // 默认
  HARD: 'hard',           // 较高噪声
  COMPETITIVE: 'competitive', // 排位模式 - 强制对齐人类水平
});

class NoiseConfig {
  /**
   * @param {Object} data
   * @param {{min:number,max:number}} data.decisionDelayMs - 决策延迟范围 (ms)
   * @param {{mean:number,stddev:number}} data.pathNoiseDegrees - 路径角度噪声
   * @param {number} data.apmLimitPerSecond - APM 上限
   * @param {string} data.difficultyLevel - easy|normal|hard|competitive
   */
  constructor(data = {}) {
    this.decisionDelayMs = data.decisionDelayMs || { min: 50, max: 150 };
    this.pathNoiseDegrees = data.pathNoiseDegrees || { mean: 0, stddev: 10 };
    this.apmLimitPerSecond = data.apmLimitPerSecond || 5;
    this.difficultyLevel = data.difficultyLevel || DifficultyLevel.NORMAL;
  }

  /** 获取随机决策延迟 */
  getRandomDelay() {
    const { min, max } = this.decisionDelayMs;
    return min + Math.random() * (max - min);
  }

  /** 获取随机路径角度噪声 (度) */
  getRandomPathNoise() {
    // Box-Muller 变换生成高斯分布
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const gauss = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    const noise = gauss * this.pathNoiseDegrees.stddev + this.pathNoiseDegrees.mean;
    // 钳制在 ±15° 内
    return Math.max(-15, Math.min(15, noise));
  }

  /** 获取排位模式强制配置(噪声最高) */
  static competitive() {
    return new NoiseConfig({
      decisionDelayMs: { min: 80, max: 150 },
      pathNoiseDegrees: { mean: 0, stddev: 12 },
      apmLimitPerSecond: 4,
      difficultyLevel: DifficultyLevel.COMPETITIVE,
    });
  }

  /** 获取陪练模式配置(噪声较低) */
  static easy() {
    return new NoiseConfig({
      decisionDelayMs: { min: 20, max: 60 },
      pathNoiseDegrees: { mean: 0, stddev: 4 },
      apmLimitPerSecond: 8,
      difficultyLevel: DifficultyLevel.EASY,
    });
  }

  /** 获取默认配置 */
  static normal() {
    return new NoiseConfig();
  }
}

module.exports = { NoiseConfig, DifficultyLevel };
