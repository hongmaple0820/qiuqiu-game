/**
 * LLM Service - Claude API 调用管理
 * 分层模型选择、Prompt 构造、缓存、降级
 * 对应 REQ-12, design.md ILLMService
 *
 * TODO: 配置 CLAUDE_API_KEY 环境变量后启用
 */

const Intent = require('../schema/Intent');
const SemanticCache = require('./SemanticCache');
const GameConfig = require('../config/GameConfig');

class LLMService {
  constructor(config = {}) {
    this.config = {
      apiKey: config.apiKey || process.env.CLAUDE_API_KEY || null,
      strategicModel: config.strategicModel || 'claude-sonnet-4-20250514',
      tacticalModel: config.tacticalModel || 'claude-haiku-4-20250514',
      apiEndpoint: config.apiEndpoint || 'https://api.anthropic.com/v1/messages',
      maxTokens: config.maxTokens || 256,
      temperature: config.temperature || 0.7,
      timeoutMs: config.timeoutMs || GameConfig.STRATEGIC_CALL_TIMEOUT_MS,
      systemPrompt: config.systemPrompt || this._defaultSystemPrompt(),
    };

    this.cache = config.cache || new SemanticCache();
    this._enabled = !!this.config.apiKey;

    if (!this._enabled) {
      console.warn('[LLMService] CLAUDE_API_KEY not set. Strategic LLM calls disabled.');
    }
  }

  /**
   * 调用 Strategic LLM (Claude Sonnet)
   * 返回 Promise<Intent>, 超时/失败时返回 null
   */
  async callStrategic(agentId, context) {
    if (!this._enabled) return null;

    // 检查缓存
    const promptHash = this._buildPromptHash(agentId, context);
    const cached = this.cache.getCachedResult(promptHash);
    if (cached) {
      console.log(`[LLM] Cache hit for ${agentId}`);
      return Intent.fromJSON(cached);
    }

    try {
      const prompt = this._buildStrategicPrompt(agentId, context);
      const response = await this._callClaude(prompt, this.config.strategicModel);

      const intent = this._parseIntent(response, agentId, context.tick || 0);

      // 缓存结果
      if (intent) {
        this.cache.cacheResult(promptHash, intent.toJSON());
      }

      return intent;
    } catch (err) {
      console.error(`[LLM] Strategic call error for ${agentId}:`, err.message);
      return null;
    }
  }

  /**
   * 批量 Strategic 调用 (同房间合并)
   */
  async batchCallStrategic(roomId, agentContexts) {
    if (!this._enabled || agentContexts.length === 0) return [];

    try {
      const prompts = agentContexts.map(ctx =>
        this._buildStrategicPrompt(ctx.agentId, ctx)
      );

      // TODO: batch API not yet available for Claude, sequential calls for now
      const results = [];
      for (let i = 0; i < prompts.length; i++) {
        const intent = await this.callStrategic(agentContexts[i].agentId, agentContexts[i]);
        results.push(intent);
      }

      return results;
    } catch (err) {
      console.error(`[LLM] Batch call error:`, err.message);
      return [];
    }
  }

  /**
   * 检查 API 是否可用
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * 定期清理过期缓存
   */
  cleanupCache() {
    this.cache.cleanup();
  }

  // ===== Private =====

  /**
   * 构建 Strategic Prompt
   */
  _buildStrategicPrompt(agentId, context) {
    const { perception, memory, tick } = context;

    const threatDesc = perception
      ? `threat level: ${perception.threatAssessment?.dangerLevel || 0}`
      : 'no perception data';

    const userMessage = `
Current game state (tick ${tick || 0}):
- Agent: ${agentId}
- ${threatDesc}
- Nearby enemies: ${perception?.visibleEntities?.filter(e => e.type === 'enemy').length || 0}
- Nearby food: ${perception?.visibleFoods?.length || 0}
- Current mass: ${context.agentMass || 'unknown'}
- Pending intent: ${context.pendingIntent?.action || 'none'}

Based on the current situation, what should the agent do?
Respond with a valid Intent action (attack, retreat, guard, merge_rally, feed, bait, move_to, free_roam).`;

    return {
      system: this.config.systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
    };
  }

  /**
   * 调用 Claude API
   */
  async _callClaude(prompt, model) {
    const response = await fetch(this.config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, ...prompt }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Claude API ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * 解析 Claude 响应为 Intent
   */
  _parseIntent(response, agentId, tick) {
    try {
      const text = response?.content?.[0]?.text || '';
      const action = this._extractAction(text);

      if (!action) return null;

      return new Intent({
        intent_id: `strategic_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        issuer: 'strategic_layer',
        target_agent: agentId,
        action,
        params: { priority: 'normal' },
        expires_at_tick: tick + 300,
        natural_language_echo: text.trim().substring(0, 200),
      });
    } catch (err) {
      console.error('[LLM] Parse error:', err.message);
      return null;
    }
  }

  _extractAction(text) {
    const lower = text.toLowerCase();
    const actions = ['attack', 'retreat', 'guard', 'merge_rally', 'feed', 'bait', 'move_to', 'free_roam', 'hold_position'];
    for (const action of actions) {
      if (lower.includes(action)) return action;
    }
    return null;
  }

  _defaultSystemPrompt() {
    return `You are an AI agent in a multiplayer agar.io-like game. Your goal is to help your human master survive and grow.
Rules:
- You see entities within your viewport only.
- Respond with a single action: attack, retreat, guard, merge_rally, feed, bait, move_to, free_roam.
- Prioritize survival: if a larger enemy approaches, retreat.
- Help your master when they request it.
- Be concise. Output only the action word.`;
  }

  _buildPromptHash(agentId, context) {
    const key = `${agentId}:${context.tick || 0}:${context.pendingIntent?.action || 'none'}:${context.threatLevel || 0}`;
    return key;
  }
}

module.exports = LLMService;
