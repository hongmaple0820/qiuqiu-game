/**
 * Semantic Cache - 语义缓存
 * 相似战场局面/相似指令的 LLM 解析结果可缓存复用
 * 对应 REQ-12.AC6, design.md ILLMService
 */

const crypto = require('crypto');

class SemanticCache {
  constructor(config = {}) {
    this.config = {
      maxEntries: config.maxEntries || 1000,
      ttlMs: config.ttlMs || 30000,        // 缓存 30 秒过期
      similarityThreshold: config.similarityThreshold || 0.85, // 相似度阈值
    };

    // promptHash -> { result, createdAt, accessCount }
    this.cache = new Map();

    this._hits = 0;
    this._misses = 0;
  }

  /**
   * 基于 prompt 内容哈希查找缓存
   * @param {string|Object} prompt - LLM 调用 prompt
   * @returns {Object|null} 缓存的 Intent 结果
   */
  getCachedResult(prompt) {
    const hash = this._hash(prompt);
    const entry = this.cache.get(hash);

    if (!entry) {
      this._misses++;
      return null;
    }

    // 检查过期
    if (Date.now() - entry.createdAt > this.config.ttlMs) {
      this.cache.delete(hash);
      this._misses++;
      return null;
    }

    entry.accessCount++;
    this._hits++;
    return entry.result;
  }

  /**
   * 缓存 LLM 调用结果
   * @param {string|Object} prompt - LLM 调用 prompt
   * @param {Object} result - Intent 结果
   */
  cacheResult(prompt, result) {
    const hash = this._hash(prompt);

    // 若已存在且过期,覆盖
    const existing = this.cache.get(hash);
    if (existing && Date.now() - existing.createdAt < this.config.ttlMs) {
      return; // 未过期,不覆盖
    }

    // 缓存驱逐: 如果超过上限,删除最旧的条目
    if (this.cache.size >= this.config.maxEntries) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.createdAt < oldestTime) {
          oldestTime = entry.createdAt;
          oldestKey = key;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(hash, {
      result,
      createdAt: Date.now(),
      accessCount: 0,
    });
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      hits: this._hits,
      misses: this._misses,
      hitRate: this._hits + this._misses > 0
        ? (this._hits / (this._hits + this._misses)).toFixed(2)
        : 0,
    };
  }

  /**
   * 清除过期条目
   */
  cleanup() {
    const now = Date.now();
    for (const [hash, entry] of this.cache) {
      if (now - entry.createdAt > this.config.ttlMs) {
        this.cache.delete(hash);
      }
    }
  }

  reset() {
    this.cache.clear();
    this._hits = 0;
    this._misses = 0;
  }

  // ===== Private =====

  /**
   * 计算 prompt Hash
   * 对自然语言 prompt 做规范化后取 SHA256
   */
  _hash(prompt) {
    const normalized = typeof prompt === 'string'
      ? prompt.trim().toLowerCase()
      : JSON.stringify(prompt);
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  }
}

module.exports = SemanticCache;
