/**
 * MobileGameConfig - 移动端游戏配置
 * 继承 GameConfig 基础值，覆盖移动端特定参数
 * 对应 REQ-M9 服务端移动端适配
 */

const GameConfig = require('./GameConfig');

const MobileGameConfig = {
  ...GameConfig,

  // ===== 移动端地图 (缩小至适合触屏节奏) =====
  MAP_WIDTH: 8000,
  MAP_HEIGHT: 8000,

  // ===== 移动端同步 (降低频率以节约带宽) =====
  /** 移动端状态同步频率 (Hz) */
  MOBILE_SEND_RATE: 10,
  /** 移动端全量同步最低间隔 (秒) */
  MOBILE_FULL_SYNC_MIN_INTERVAL: 5,
  /** 移动端食物更新节流 (tick 间隔) */
  MOBILE_FOOD_THROTTLE_TICKS: 3,

  // ===== 房间 (移动端匹配) =====
  /** 单房间最大玩家数 */
  MAX_PLAYERS_PER_ROOM: 8,
  /** 房间最少玩家数 (不足时机器人填充) */
  BOT_FILL_TARGET: 8,
  /** 匹配超时 (ms) */
  MATCHMAKING_TIMEOUT: 3000,
  /** 超时后最低填充人数 */
  BOT_FILL_MIN: 4,

  // ===== 食物 (地图缩小,食物密度保持) =====
  /** 初始食物数量 */
  INITIAL_FOOD_COUNT: 120,

  // ===== 移动端渲染 =====
  /** 移动端视野倍率 (viewport = radius * this) */
  MOBILE_VIEWPORT_MULTIPLIER: 5,
  /** 移动端 camera lerp 因子 */
  CAMERA_LERP_FACTOR: 0.15,

  // ===== 摇杆 =====
  /** 虚拟摇杆外圈半径 (px) */
  JOYSTICK_RADIUS: 60,
  /** 摇杆死区半径 (px) */
  JOYSTICK_DEAD_ZONE: 5,
  /** 摇杆最大拖拽距离 (px) */
  JOYSTICK_MAX_DRAG: 80,

  // ===== 指令轮盘 =====
  /** 轮盘外圈半径 (px) */
  WHEEL_RADIUS: 100,
  /** 轮盘内圈半径 (px) */
  WHEEL_INNER_RADIUS: 40,
  /** 长按触发时间 (ms) */
  WHEEL_LONGPRESS_MS: 200,
  /** 扇形间隙 (度) */
  WHEEL_SECTOR_GAP: 5,

  // ===== 网络容错 =====
  /** 重连窗口 (秒) */
  RECONNECT_WINDOW_SEC: 30,
  /** 重连重试延迟序列 (ms) */
  RECONNECT_BACKOFF: [1000, 2000, 4000, 8000, 15000],
  /** 最大重试次数 */
  RECONNECT_MAX_RETRIES: 5,
  /** 心跳间隔 (秒) */
  PING_INTERVAL_SEC: 15,
  /** 心跳超时 (秒) */
  PING_TIMEOUT_SEC: 30,

  // ===== 触控分区 =====
  /** 左半屏比例 (摇杆区域) */
  TOUCH_LEFT_RATIO: 0.45,
  /** 右半屏比例 (指令区域) */
  TOUCH_RIGHT_RATIO: 0.55,

  // ===== 性能阈值 =====
  /** 最低可接受 FPS */
  MIN_ACCEPTABLE_FPS: 20,
  /** 触发跳帧的 FPS 阈值 */
  FRAME_SKIP_FPS_THRESHOLD: 15,
  /** 连续低帧触发跳帧的帧数 */
  FRAME_SKIP_TRIGGER_COUNT: 3,
};

module.exports = MobileGameConfig;
