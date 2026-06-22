/**
 * NetworkSync - 移动端 WebSocket 网络同步客户端
 * 支持断线重连、心跳保活、全量/增量同步
 * 对应 REQ-M6 断线重连与网络容错
 */
class NetworkSync {
  constructor(config = {}) {
    this.config = {
      pingInterval: config.pingInterval || 15000,
      pingTimeout: config.pingTimeout || 30000,
      reconnectBackoff: config.reconnectBackoff || [1000, 2000, 4000, 8000, 15000],
      maxRetries: config.maxRetries || 5,
      ...config,
    };

    this.ws = null;
    this.playerId = null;
    this.connected = false;
    this.reconnecting = false;
    this._retryCount = 0;
    this._pingTimer = null;
    this._pongTimer = null;
    this._lastPong = 0;
    this._messageQueue = [];    // 断线期间缓存的消息
    this._callbacks = {};
  }

  /**
   * 建立连接
   */
  connect(serverUrl) {
    this._configUrl = serverUrl || `ws${location.protocol === 'https:' ? 's' : ''}://${location.host}`;
    this._doConnect();
  }

  /**
   * 注册回调
   * @param {string} protoId - proto_id (如 '1001', '9001')
   * @param {Function} cb
   */
  onProto(protoId, cb) {
    this._callbacks[protoId] = cb;
  }

  /**
   * 全局消息回调
   */
  onMessage(cb) {
    this._onMessage = cb;
  }

  /**
   * 连接状态变化回调
   */
  onConnectionChange(cb) {
    this._onConnectionChange = cb;
  }

  /**
   * 发送消息
   */
  send(data) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      // 断线期间缓存 (最多 50 条)
      if (this._messageQueue.length < 50) {
        this._messageQueue.push(msg);
      }
    }
  }

  /**
   * 发送设备信息 (proto 9002)
   */
  sendDeviceInfo() {
    this.send({
      proto_id: 9002,
      data: {
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio || 1,
        networkType: this._detectNetworkType(),
        isMobile: this._isMobile(),
      },
    });
  }

  /**
   * 发送快速匹配 (proto 9004)
   */
  sendQuickMatch(playerName) {
    this.send({
      proto_id: 9004,
      data: { playerName },
    });
  }

  /**
   * 发送加入房间请求 (proto 9001)
   */
  sendJoinRoom(playerName) {
    this.send({
      proto_id: 9001,
      data: { player_name: playerName },
    });
  }

  /**
   * 发送位置更新 (proto 1001)
   */
  sendPosition(vx, vy) {
    this.send({
      proto_id: 1001,
      data: { vx, vy },
    });
  }

  // ===== Private =====

  _doConnect() {
    try {
      this.ws = new WebSocket(this._configUrl);

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnecting = false;
        this._retryCount = 0;
        this._startHeartbeat();

        if (this._onConnectionChange) {
          this._onConnectionChange('connected');
        }

        // 发送缓存的消息
        while (this._messageQueue.length > 0) {
          const msg = this._messageQueue.shift();
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
          }
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const { proto_id } = msg;

          // 更新 pong 时间
          this._lastPong = Date.now();

          // 路由到特定 proto_id 回调
          if (proto_id && this._callbacks[proto_id]) {
            this._callbacks[proto_id](msg.data, msg);
          }

          // 全局回调
          if (this._onMessage) {
            this._onMessage(msg);
          }
        } catch (e) {
          console.error('[NetworkSync] Parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this._stopHeartbeat();

        if (this._onConnectionChange) {
          this._onConnectionChange('disconnected');
        }

        this._tryReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[NetworkSync] Socket error:', err);
      };
    } catch (e) {
      console.error('[NetworkSync] Connect error:', e);
    }
  }

  _tryReconnect() {
    if (this._retryCount >= this.config.maxRetries) {
      console.log('[NetworkSync] Max retries reached');
      if (this._onConnectionChange) {
        this._onConnectionChange('failed');
      }
      return;
    }

    this.reconnecting = true;
    const delay = this.config.reconnectBackoff[this._retryCount] || 15000;

    console.log(`[NetworkSync] Reconnecting in ${delay}ms (retry ${this._retryCount + 1}/${this.config.maxRetries})`);

    if (this._onConnectionChange) {
      this._onConnectionChange('reconnecting');
    }

    setTimeout(() => {
      this._retryCount++;
      this._doConnect();
    }, delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._lastPong = Date.now();

    // 每 pingInterval 检查是否超时
    this._pingTimer = setInterval(() => {
      if (!this.connected) return;

      const elapsed = Date.now() - this._lastPong;
      if (elapsed > this.config.pingTimeout) {
        console.log('[NetworkSync] Heartbeat timeout');
        this.ws.close();
      }
    }, this.config.pingInterval);
  }

  _stopHeartbeat() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  _detectNetworkType() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      return conn.effectiveType || conn.type || 'unknown';
    }
    return 'unknown';
  }

  _isMobile() {
    return /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent)
      || (window.innerWidth < 1024 && 'ontouchstart' in window);
  }

  cleanup() {
    this._stopHeartbeat();
    this.connected = false;
    this.reconnecting = false;
    if (this.ws) {
      this.ws.onclose = null; // 防止触发重连
      this.ws.close();
      this.ws = null;
    }
    this._callbacks = {};
    this._messageQueue = [];
  }
}

window.NetworkSync = NetworkSync;
