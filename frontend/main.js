// Bootstrap: networking, prediction + reconciliation, interpolation, rendering, and UI

import { C, applyServerConstants, PASTEL_PALETTE } from './constants.js';
import { net } from './net.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Renderer } from './render.js';
import { TouchControls } from './touch.js';

// ===== Helpers =====
const now = () => performance.now();

function length(v){ return Math.hypot(v.x, v.y); }
function normalize(v){ const m = Math.hypot(v.x, v.y); return m > 1e-6 ? { x: v.x / m, y: v.y / m } : { x: 0, y: 0 }; }
function add(a,b){ return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a,b){ return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a,s){ return { x: a.x * s, y: a.y * s }; }
function lerp(a,b,t){ return a + (b - a) * t; }
function vlerp(a,b,t){ return { x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t) }; }

// ===== Core State =====
const ui = new UI();
const container = document.getElementById('game');
const renderer = new Renderer(container);
const input = new Input();
// Initialize touch controls (auto-enabled on coarse pointers)
const touch = new TouchControls(input);

const urlParams = new URLSearchParams(location.search);
const roomId = urlParams.get('roomId')?.trim() || 'default';

let selfId = null;
let joined = false;

// Player colors (from lobby)
const playerColor = new Map(); // id -> color

// Interpolation buffers for remote players
// id -> [{ t: serverTime(ms), pos, vel, dashActive, alive }]
const interp = new Map();
const INTERP_BUF_LIMIT = 60; // keep ~6s at 10 Hz; trimmed anyway
// Track death times for fall-out visuals
const deathAt = new Map();

// Local prediction state
let seq = 0;
const pendingInputs = []; // [{seq, tsClient, move, dash}]
let local = {
  pos: { x: 0, y: 0 },
  vel: { x: 0, y: 0 },
  alive: false,
  dashUntil: 0,
  dashCooldownUntil: 0,
  lastMoveDir: { x: 0, y: 1 },
};

// Round UI
let countdownEndAt = null;      // serverTime ms
let arrowHideAt = 0;            // serverTime ms
let lastAckSeq = 0;
let lastWinnerId = null;

// Tiles visual model (for shake/fall)
let tiles = {
  width: 15, height: 15, count: 225,
  state: new Uint8Array(225),         // 0 solid, 1 shaking, 2 fallen
  shakeStart: new Float64Array(225),  // serverTime ms
  fallStart: new Float64Array(225),   // serverTime ms
};

// FPS
let fps = 0;
let _fpsAccum = 0, _fpsFrames = 0, _fpsLast = now();

// ===== Client Simulation (light) =====
function simStep(state, move, dash, tNow, dt) {
  // dash start
  if (dash && tNow >= state.dashCooldownUntil) {
    const dir = normalize(state.lastMoveDir);
    if (length(dir) > 0) {
      state.dashUntil = tNow + C.DASH_DURATION_MS;
      state.dashCooldownUntil = tNow + C.DASH_COOLDOWN_MS;
      state.vel = add(state.vel, mul(dir, C.DASH_IMPULSE));
    }
  }
  // update desired and lastMoveDir
  const norm = normalize(move);
  if (length(norm) > 0) state.lastMoveDir = norm;

  const desired = mul(norm, C.PLAYER_MOVE_SPEED);
  // accelerate towards desired
  const delta = sub(desired, state.vel);
  const deltaLen = length(delta);
  if (deltaLen > 0) {
    const step = Math.min(deltaLen, C.PLAYER_ACCEL * dt);
    state.vel = add(state.vel, mul(mul(delta, 1 / deltaLen), step));
  }
  // friction
  const friction = (tNow < state.dashUntil) ? (C.PLAYER_FRICTION * 0.35) : C.PLAYER_FRICTION;
  const sp = length(state.vel);
  if (sp > 0) {
    const reduce = Math.max(0, sp - friction * dt);
    state.vel = mul(normalize(state.vel), reduce);
  }
  // integrate
  state.pos = add(state.pos, mul(state.vel, dt));
}

// ===== Networking Handlers =====
net.setHandlers({
  welcome: (msg) => {
    selfId = msg.playerId;
    applyServerConstants(msg.constants || {});
    initTiles(msg.mapSize?.width ?? 15, msg.mapSize?.height ?? 15);

    // Setup renderer after constants known
    renderer.setup(C, msg.mapSize);
  },
  lobby_state: (msg) => {
    for (const p of msg.players) {
      if (p.color) playerColor.set(p.id, p.color);
    }
    ui.renderLobby(msg.players, selfId);
    // Sync Ready button with server state
    const me = msg.players.find((p) => p.id === selfId);
    if (me) ui.setReadyState(!!me.ready);
  },
  countdown: (msg) => {
    // Close leaderboard for everyone when countdown starts
    ui.hideLeaderboard();
    countdownEndAt = msg.serverTime + (msg.seconds * 1000);
    ui.setCountdownVisible(true);
  },
  round_start: (_msg) => {
    // Reset tiles visuals to solid
    clearTiles();
    // Arrow marker
    arrowHideAt = net.getServerNow() + (C.ARROW_MARKER_DURATION_MS || 1500);
    // Clear inputs to avoid dash spilling between rounds
    pendingInputs.length = 0;
    lastAckSeq = 0;
  },
  state: (msg) => {
    const tSrv = msg.serverTime;

    // Tile events -> record timestamps
    for (const ev of msg.events || []) {
      if (ev.kind === 'tile_shake') {
        tiles.state[ev.idx] = 1;
        tiles.shakeStart[ev.idx] = tSrv;
      } else if (ev.kind === 'tile_fall') {
        tiles.state[ev.idx] = 2;
        tiles.fallStart[ev.idx] = tSrv;
      } else if (ev.kind === 'death') {
        // record death time for fall-out visuals
        deathAt.set(ev.playerId, tSrv);
        // mark death; if it's us, trust server
        if (ev.playerId === selfId) {
          local.alive = false;
        }
      }
    }
    // Tile deltas -> ensure states match
    for (const td of msg.tiles || []) {
      tiles.state[td.idx] = td.state === 'shaking' ? 1 : 2;
      // if no event provided, stamp times roughly
      if (td.state === 'shaking' && tiles.shakeStart[td.idx] === 0) tiles.shakeStart[td.idx] = tSrv;
      if (td.state === 'fallen' && tiles.fallStart[td.idx] === 0) tiles.fallStart[td.idx] = tSrv;
    }

    // Players
    // lastAckSeq may be included (authoritative acks for local)
    if (typeof msg.lastAckSeq === 'number') {
      lastAckSeq = Math.max(lastAckSeq, msg.lastAckSeq);
      // drop acked
      while (pendingInputs.length && pendingInputs[0].seq <= lastAckSeq) pendingInputs.shift();
    }

    // snapshot per player
    for (const ps of msg.players) {
      if (ps.id === selfId) {
        // light reconciliation: nudge towards server pose
        // initialize if not alive before
        local.alive = ps.alive;
        const err = sub(ps.pos, local.pos);
        const d = length(err);
        if (d > 1.0) {
          // snap if too far
          local.pos = { ...ps.pos };
          local.vel = { ...ps.vel };
        } else {
          // nudge
          local.pos = add(local.pos, mul(err, 0.2));
          // lightly blend velocity
          local.vel = vlerp(local.vel, ps.vel, 0.2);
        }
      } else {
        // push into interpolation buffer
        let buf = interp.get(ps.id);
        if (!buf) { buf = []; interp.set(ps.id, buf); }
        buf.push({ t: tSrv, pos: { ...ps.pos }, vel: { ...ps.vel }, dashActive: !!ps.dashActive, alive: !!ps.alive });
        if (buf.length > INTERP_BUF_LIMIT) buf.splice(0, buf.length - INTERP_BUF_LIMIT);
      }
    }
  },
  round_over: (msg) => {
    // Countdown off; arrow hidden
    countdownEndAt = null;
    ui.setCountdownVisible(false);
    arrowHideAt = 0;
    lastWinnerId = msg.winnerId || null;
  },
  leaderboard: (msg) => {
    const won = !!selfId && lastWinnerId === selfId;
    ui.showLeaderboard(msg.entries || [], won);
  },
  close: () => {
    // simplistic: reload on disconnect
    // location.reload();
  },
});

// ===== Tiles helpers =====
function initTiles(w, h) {
  tiles.width = w; tiles.height = h; tiles.count = w * h;
  tiles.state = new Uint8Array(tiles.count);
  tiles.shakeStart = new Float64Array(tiles.count);
  tiles.fallStart = new Float64Array(tiles.count);
}
function clearTiles() {
  tiles.state.fill(0);
  tiles.shakeStart.fill(0);
  tiles.fallStart.fill(0);
}

// ===== UI wiring =====
ui.setReadyHandler((ready) => {
  if (!joined) return;
  net.sendReady(ready);
});
ui.onJoin(({ name, color }) => {
  joined = true;
  // remember our color early
  if (selfId) playerColor.set(selfId, color);
  net.sendJoin(name, color);
  ui.hideJoinModal();
});

// ===== Connect and show join =====
(async function boot() {
  await net.connect(roomId);
  ui.setStatus({ roomId });
  ui.showJoinModal(PASTEL_PALETTE);
})();

// ===== Input loop (60/s) =====
const SEND_RATE = 60;
const STEP_MS = 1000 / SEND_RATE;
let lastSend = now();

function inputLoop() {
  const t = now();
  const dtMs = t - lastSend;
  if (dtMs >= STEP_MS - 2) {
    lastSend = t;
    // gather input
    const move = input.getMoveVec();
    const dash = input.consumeDash();

    // enqueue and send
    const pkt = { seq: ++seq, ts: t, move, dash };
    pendingInputs.push(pkt);
    net.sendInput(pkt.seq, pkt.ts, pkt.move, pkt.dash);

    // simulate locally if alive
    if (local.alive) {
      const dt = STEP_MS / 1000;
      simStep(local, move, dash, t, dt);
    }
  }
  setTimeout(inputLoop, 1);
}
inputLoop();

// ===== Render / Interp RAF =====
function interpolateFor(id, targetT) {
  const buf = interp.get(id);
  if (!buf || buf.length === 0) return null;
  // find two frames around targetT
  let a = null, b = null;
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].t <= targetT) { a = buf[i]; b = buf[i+1] || buf[i]; break; }
  }
  if (!a) { a = buf[0]; b = buf[1] || buf[0]; }
  const dt = (b.t - a.t) || 1;
  const t = Math.max(0, Math.min(1, (targetT - a.t) / dt));
  return {
    pos: vlerp(a.pos, b.pos, t),
    vel: vlerp(a.vel, b.vel, t),
    dashActive: (t < 0.5 ? a.dashActive : b.dashActive),
    alive: (t < 0.5 ? a.alive : b.alive),
  };
}

function raf() {
  requestAnimationFrame(raf);

  // FPS
  const tNow = now();
  _fpsAccum += 1;
  if (tNow - _fpsLast >= 500) {
    fps = Math.round((_fpsAccum * 1000) / (tNow - _fpsLast));
    _fpsAccum = 0; _fpsLast = tNow;
  }

  // Countdown UI
  if (countdownEndAt != null) {
    const remaining = Math.max(0, countdownEndAt - net.getServerNow());
    const secLeft = Math.ceil(remaining / 1000);
    ui.setCountdownVisible(remaining > 0);
    if (remaining > 0) ui.setCountdownText(String(secLeft));
  }

  // Cooldown bar for local
  const cdMs = C.DASH_COOLDOWN_MS || 2000;
  const nowSrv = net.getServerNow();
  const remainingCd = Math.max(0, local.dashCooldownUntil - nowSrv);
  const frac = cdMs > 0 ? 1 - (remainingCd / cdMs) : 1;
  ui.setCooldownProgress(frac);

  // Compose display players
  const displayPlayers = new Map();

  // Local
  if (selfId) {
    displayPlayers.set(selfId, {
      pos: { ...local.pos },
      vel: { ...local.vel },
      dashActive: (nowSrv < local.dashUntil),
      alive: local.alive,
      deathAt: deathAt.get(selfId),
      color: playerColor.get(selfId) || '#cccccc',
    });
  }

  // Remotes
  const targetT = nowSrv - (C.INTERP_BUFFER_MS || 100);
  for (const [id, buf] of interp) {
    if (id === selfId) continue;
    const s = interpolateFor(id, targetT);
    if (!s) continue;
    displayPlayers.set(id, {
      pos: s.pos,
      vel: s.vel,
      dashActive: s.dashActive,
      alive: s.alive,
      deathAt: deathAt.get(id),
      color: playerColor.get(id) || '#cccccc',
    });
  }

  // Status HUD
  ui.setStatus({ roomId, ping: net.getPingMs(), fps });

  // Render
  const arrowVisible = (nowSrv < arrowHideAt) && !!selfId;
  renderer.frame(nowSrv, displayPlayers, tiles, arrowVisible, selfId, C);
}
raf();