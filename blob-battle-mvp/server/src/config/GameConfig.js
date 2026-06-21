/**
 * GameConfig - 核心数值常量
 * 对应 REQ-1 基础规则 + 全局配置
 */

const GameConfig = {
  // ===== 地图 =====
  /** 地图边长(正方形) 单位 */
  MAP_WIDTH: 14000,
  MAP_HEIGHT: 14000,

  // ===== 质量-半径 =====
  /** r = k * sqrt(mass / pi), k 为美术可调常数 */
  MASS_RADIUS_K: 1.0,
  /** 默认初始半径 */
  DEFAULT_RADIUS: 20,
  /** 默认初始质量 */
  DEFAULT_MASS: 1256.6, // pi * 20^2

  // ===== 移动速度 =====
  /** v = v_max * (mass_min / mass)^a */
  SPEED_V_MAX: 10,
  SPEED_MASS_MIN: 100,
  SPEED_A: 0.45,

  // ===== 吞噬阈值 =====
  /** 吞噬比例: mass_A >= mass_B * SWALLOW_RATIO */
  SWALLOW_RATIO: 1.25,

  // ===== 分裂规则 =====
  /** 单玩家分裂体上限 */
  MAX_SPLIT: 16,
  /** 最小可分裂质量阈值 */
  MIN_SPLIT_MASS: 2500, // 约 pi * 28.2^2
  /** 分裂份数 */
  SPLIT_COUNT: 2,
  /** 分裂时母体保留比例 */
  SPLIT_MOTHER_RATIO: 0.5,

  // ===== 合并冷却 =====
  /** 合并冷却时间(秒),可调 */
  MERGE_COOLDOWN_SEC: 20,
  /** 合并冷却 tick 数(按 30Hz 算) */
  MERGE_COOLDOWN_TICKS: 600,

  // ===== 吐孢子 =====
  /** 孢子释放的固定质量 */
  EJECT_MASS_UNIT: 30,
  /** 最小吐孢子质量阈值 */
  MIN_EJECT_MASS: 500,
  /** 孢子初始速度 */
  EJECT_SPEED: 8,

  // ===== 刺球 (virus) =====
  /** 刺球地图密度(每 10000 平方单位多少个) */
  VIRUS_DENSITY: 0.00015,
  /** 碰撞刺球后强制执行的分裂份数 */
  VIRUS_SPLIT_COUNT: 4,
  /** 碰撞刺球的最小质量阈值 */
  VIRUS_TRIGGER_MASS_RATIO: 1.5,

  // ===== Tick 调度 =====
  /** 物理 tick 频率 (Hz) */
  TICK_RATE: 30,
  /** 状态同步频率 (Hz) */
  SEND_RATE: 15,

  // ===== 房间 =====
  /** 单房间总实体上限 */
  MAX_ENTITIES_PER_ROOM: 64,
  /** MVP 阶段每位玩家 Agent 数量上限 */
  MAX_AGENTS_PER_PLAYER: 1,
  /** 断连保留实体时间 (秒) */
  DISCONNECT_KEEP_ALIVE_SEC: 30,

  // ===== 食物 =====
  /** 食物数(经典量级) */
  FOOD_COUNT: 500,
  /** 食物每 tick 生成概率 */
  FOOD_SPAWN_CHANCE: 0.1,

  // ===== LLM 调用 =====
  /** Strategic 层心跳间隔 (秒) */
  STRATEGIC_HEARTBEAT_SEC: 15,
  /** Tactical 层心跳间隔 (秒) */
  TACTICAL_HEARTBEAT_SEC: 0.5,
  /** 每个 Agent 每分钟 Strategic 调用预算 */
  LLM_BUDGET_PER_AGENT_PER_MIN: 4,
  /** 每个房间每分钟 LLM 调用总预算 */
  LLM_BUDGET_PER_ROOM_PER_MIN: 20,
  /** Strategic 层调用超时 (ms) */
  STRATEGIC_CALL_TIMEOUT_MS: 5000,
};

module.exports = GameConfig;
