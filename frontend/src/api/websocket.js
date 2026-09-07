// ── URL resolution ────────────────────────────────────────────────────────

const getWsUrl = () => {
  if (import.meta.env.DEV) {
    // Vite proxy handles /ws → ws://192.168.1.137:8000
    return `ws://${window.location.host}/ws/system/ws`;
  }
  const base = window.REEF_CONFIG?.wsUrl ?? "ws://192.168.1.137:8000";
  return `${base}/system/ws`;
};

// ── Reconnection config ───────────────────────────────────────────────────

const RECONNECT_BASE_MS  = 1000;
const RECONNECT_MAX_MS   = 30000;
const RECONNECT_FACTOR   = 2;
const PING_INTERVAL_MS   = 25000;  // keep-alive ping every 25s

// ── WebSocket manager ─────────────────────────────────────────────────────

class ReefWebSocket {
  constructor() {
    this._ws            = null;
    this._listeners     = new Set();
    this._statusCbs     = new Set();
    this._reconnectMs   = RECONNECT_BASE_MS;
    this._reconnectTimer = null;
    this._pingTimer     = null;
    this._intentionalClose = false;
    this._connected     = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  connect() {
    this._intentionalClose = false;
    this._openSocket();
  }

  disconnect() {
    this._intentionalClose = true;
    this._clearTimers();
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._setConnected(false);
  }

  /** Subscribe to inbound messages. Returns an unsubscribe function. */
  onMessage(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Subscribe to connection status changes (true = connected). */
  onStatus(fn) {
    this._statusCbs.add(fn);
    // Immediately call with current state
    fn(this._connected);
    return () => this._statusCbs.delete(fn);
  }

  get connected() {
    return this._connected;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  _openSocket() {
    if (this._ws) {
      this._ws.onclose = null;  // prevent reconnect loop from old socket
      this._ws.close();
    }

    const url = getWsUrl();
    this._ws = new WebSocket(url);

    this._ws.onopen = () => {
      console.log("[ws] Connected");
      this._reconnectMs = RECONNECT_BASE_MS;
      this._setConnected(true);
      this._startPing();
    };

    this._ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Ignore pong — it's only for keeping the connection alive
        if (msg.type === "pong") return;
        this._listeners.forEach((fn) => fn(msg));
      } catch {
        console.warn("[ws] Non-JSON message received:", event.data);
      }
    };

    this._ws.onerror = (err) => {
      console.warn("[ws] Error:", err);
    };

    this._ws.onclose = () => {
      console.warn("[ws] Disconnected");
      this._clearTimers();
      this._setConnected(false);
      if (!this._intentionalClose) {
        this._scheduleReconnect();
      }
    };
  }

  _scheduleReconnect() {
    const delay = this._reconnectMs;
    console.log(`[ws] Reconnecting in ${delay}ms`);
    this._reconnectTimer = setTimeout(() => {
      this._openSocket();
    }, delay);
    // Exponential backoff capped at max
    this._reconnectMs = Math.min(
      this._reconnectMs * RECONNECT_FACTOR,
      RECONNECT_MAX_MS
    );
  }

  _startPing() {
    this._pingTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
  }

  _clearTimers() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  _setConnected(val) {
    this._connected = val;
    this._statusCbs.forEach((fn) => fn(val));
  }
}

// Singleton — one WebSocket connection for the entire app
export const reefWs = new ReefWebSocket();
