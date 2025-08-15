// Lightweight WS client with message dispatch, time offset, and ping tracking

import { applyServerConstants } from './constants.js';

function now() { return performance.now(); }

class Net {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.handlers = {};
    this.timeOffset = 0; // serverTime - now()
    this.pingMs = null;
    this.roomId = 'default';
  }

  setHandlers(h) {
    this.handlers = { ...this.handlers, ...h };
  }

  getServerNow() {
    return now() + this.timeOffset;
  }

  getPingMs() {
    return this.pingMs;
  }

  async connect(roomId = 'default') {
    this.roomId = roomId;
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${loc.host}/ws?roomId=${encodeURIComponent(roomId)}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        resolve();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          this._handleMessage(msg);
        } catch (_e) {
          // ignore
        }
      };

      ws.onclose = () => {
        this.connected = false;
        if (this.handlers.close) this.handlers.close();
      };

      ws.onerror = (e) => {
        if (!this.connected) reject(e);
      };
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }

  // --- Outgoing ---

  sendJoin(name, color) {
    this._send({ type: 'join', name, color });
  }

  sendReady(ready) {
    this._send({ type: 'ready', ready: !!ready });
  }

  sendInput(seq, ts, move, dash) {
    this._send({ type: 'input', seq, ts, move, dash: !!dash });
  }

  // --- Internals ---

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify(obj)); } catch {}
  }

  _updateTimeOffset(serverTime) {
    if (typeof serverTime !== 'number' || !isFinite(serverTime)) return;
    const offset = serverTime - now();
    // light smoothing
    this.timeOffset = this.timeOffset === 0 ? offset : (this.timeOffset * 0.9 + offset * 0.1);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'welcome': {
        // constants are mirrored here
        if (msg.constants) applyServerConstants(msg.constants);
        if (this.handlers.welcome) this.handlers.welcome(msg);
        break;
      }

      case 'lobby_state': {
        if (this.handlers.lobby_state) this.handlers.lobby_state(msg);
        break;
      }

      case 'countdown': {
        this._updateTimeOffset(msg.serverTime);
        if (this.handlers.countdown) this.handlers.countdown(msg);
        break;
      }

      case 'round_start': {
        if (this.handlers.round_start) this.handlers.round_start(msg);
        break;
      }

      case 'state': {
        this._updateTimeOffset(msg.serverTime);
        if (this.handlers.state) this.handlers.state(msg);
        break;
      }

      case 'round_over': {
        if (this.handlers.round_over) this.handlers.round_over(msg);
        break;
      }

      case 'leaderboard': {
        if (this.handlers.leaderboard) this.handlers.leaderboard(msg);
        break;
      }

      case 'ping': {
        // compute RTT and respond with pong
        if (typeof msg.ts === 'number') {
          const rtt = now() - msg.ts;
          this.pingMs = Math.round(rtt);
          this._send({ type: 'pong', ts: msg.ts });
        }
        if (this.handlers.ping) this.handlers.ping(msg);
        break;
      }

      default: {
        // ignore
        break;
      }
    }
  }
}

export const net = new Net();