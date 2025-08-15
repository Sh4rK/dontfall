// Core game simulation (server-authoritative)

import {
  COUNTDOWN_SECONDS,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  DASH_IMPULSE,
  DASH_PUSHBACK_IMPULSE,
  MAP_HEIGHT,
  MAP_WIDTH,
  PLAYER_ACCEL,
  PLAYER_FRICTION,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
  TILE_FALL_DELAY_MS,
  TILE_SIZE,
  FALL_GRACE_MS,
} from "./config.ts";
import type {
  GameEvent,
  Player,
  PlayerSnapshot,
  RoomState,
  Tile,
  TileDelta,
  Vec2,
} from "./types.ts";
import { Leaderboard } from "./leaderboard.ts";

// Snapshot data returned to server for broadcast (server will add tick/serverTime/lastAckSeq per-client)
export interface SnapshotData {
  players: PlayerSnapshot[];
  tiles: TileDelta[]; // deltas since last snapshot
  events: GameEvent[]; // events since last snapshot
}

function nowMs(): number {
  return Date.now();
}

// --- Grid helpers

const HALF_W_TILES = MAP_WIDTH / 2;
const HALF_H_TILES = MAP_HEIGHT / 2;

function tileIndex(tx: number, ty: number): number {
  return ty * MAP_WIDTH + tx;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}
function normalize(v: Vec2): Vec2 {
  const m = length(v);
  if (m <= 1e-6) return { x: 0, y: 0 };
  return { x: v.x / m, y: v.y / m };
}
function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}
function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
function mul(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

function posToTile(pos: Vec2): { tx: number; ty: number } | null {
  const fx = pos.x / TILE_SIZE + HALF_W_TILES;
  const fy = pos.y / TILE_SIZE + HALF_H_TILES;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  if (tx < 0 || tx >= MAP_WIDTH || ty < 0 || ty >= MAP_HEIGHT) return null;
  return { tx, ty };
}

function tileCenter(tx: number, ty: number): Vec2 {
  return {
    x: (tx + 0.5 - HALF_W_TILES) * TILE_SIZE,
    y: (ty + 0.5 - HALF_H_TILES) * TILE_SIZE,
  };
}

function *perimeterTiles(width: number, height: number): Generator<[number, number]> {
  // Top row (y=0), left->right
  for (let x = 0; x < width; x++) yield [x, 0];
  // Right column (x=width-1), top->bottom excluding corners
  for (let y = 1; y < height - 1; y++) yield [width - 1, y];
  // Bottom row (y=height-1), right->left
  if (height > 1) for (let x = width - 1; x >= 0; x--) yield [x, height - 1];
  // Left column (x=0), bottom->top excluding corners
  if (width > 1) for (let y = height - 2; y >= 1; y--) yield [0, y];
}

function evenlySpacedPerimeterPositions(n: number): Array<{ tx: number; ty: number }> {
  const perim: Array<{ tx: number; ty: number }> = Array.from(perimeterTiles(MAP_WIDTH, MAP_HEIGHT)).map(([tx, ty]) => ({ tx, ty }));
  const m = perim.length || 1;
  const out: Array<{ tx: number; ty: number }> = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i * m) / n) % m;
    out.push(perim[idx]);
  }
  return out;
}

// Inner-perimeter ring (one tile in from the edge)
function* innerPerimeterTiles(width: number, height: number): Generator<[number, number]> {
  if (width < 3 || height < 3) {
    // No inner ring possible
    return;
  }
  const minX = 1, maxX = width - 2;
  const minY = 1, maxY = height - 2;

  // Top inner row
  for (let x = minX; x <= maxX; x++) yield [x, minY];
  // Right inner column (excluding corners)
  for (let y = minY + 1; y <= maxY - 1; y++) yield [maxX, y];
  // Bottom inner row
  if (maxY > minY) for (let x = maxX; x >= minX; x--) yield [x, maxY];
  // Left inner column (excluding corners)
  if (maxX > minX) for (let y = maxY - 1; y >= minY + 1; y--) yield [minX, y];
}

function randomInnerPerimeterPositions(n: number): Array<{ tx: number; ty: number }> {
  // Prefer inner ring; fall back to outer perimeter if not available
  let ring = Array.from(innerPerimeterTiles(MAP_WIDTH, MAP_HEIGHT)).map(([tx, ty]) => ({ tx, ty }));
  if (ring.length === 0) {
    ring = Array.from(perimeterTiles(MAP_WIDTH, MAP_HEIGHT)).map(([tx, ty]) => ({ tx, ty }));
  }
  // Shuffle
  for (let i = ring.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = ring[i]; ring[i] = ring[j]; ring[j] = tmp;
  }
  return ring.slice(0, Math.max(0, Math.min(n, ring.length)));
}

// --- Internal per-connection input state

interface InputState {
  move: Vec2;              // latest movement vector (-1..1)
  dashRequest: boolean;    // edge-triggered request
  lastSeq: number;         // latest seq number seen
  lastMoveDir: Vec2;       // last non-zero move dir (for dash direction)
}

// --- GameRoom

export class GameRoom {
  readonly id: string;

  private room: RoomState;
  private leaderboard = new Leaderboard();

  private inputs = new Map<string, InputState>();
  private events: GameEvent[] = [];
  private tileDeltaIdx = new Set<number>();
  private deathAt = new Map<string, number>();
  private unsupportedSince = new Map<string, number>();
  private lastSpawns: Array<{ id: string; tx: number; ty: number }> = [];
  private nextRandomShakeAt: number = 0;

  constructor(id: string) {
    this.id = id;
    this.room = {
      id,
      players: new Map<string, Player>(),
      tiles: this.createFreshTiles(),
      roundState: "lobby",
      leaderboard: new Map(), // informational; authoritative data maintained in Leaderboard class
      tick: 0,
      mapSeed: (Math.random() * 1e9) | 0,
      countdownEndAt: undefined,
    };
  }

  get state(): Readonly<RoomState> {
    return this.room;
  }

  // --- Player lifecycle

  addPlayer(id: string, name: string, color?: string): Player {
    const p: Player = {
      id, name, color,
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      alive: false,
      dashCooldownUntil: 0,
      dashUntil: 0,
      lastInputSeq: 0,
      ready: false,
    };
    this.room.players.set(id, p);
    this.inputs.set(id, { move: { x: 0, y: 0 }, dashRequest: false, lastSeq: 0, lastMoveDir: { x: 0, y: 1 } });
    return p;
  }

  removePlayer(id: string) {
    const p = this.room.players.get(id);
    if (!p) return;
    if (this.room.roundState === "inRound" && p.alive) {
      // Eliminate on disconnect mid-round
      this.markDead(p, nowMs());
    }
    this.room.players.delete(id);
    this.inputs.delete(id);
    this.deathAt.delete(id);
    this.unsupportedSince.delete(id);
  }

  setReady(id: string, ready: boolean): { allReady: boolean; count: number } {
    const p = this.room.players.get(id);
    if (!p) return { allReady: false, count: this.room.players.size };
    p.ready = ready;
    const players = Array.from(this.room.players.values());
    const count = players.length;
    const allReady = count >= 2 && players.every((pp) => pp.ready);
    return { allReady, count };
  }

  // --- Input ingestion

  handleInput(
    playerId: string,
    seq: number,
    move: Vec2,
    dash: boolean,
    recvTimeMs: number,
  ) {
    const p = this.room.players.get(playerId);
    if (!p) return;
    const input = this.inputs.get(playerId)!;

    // Ensure monotonic seq
    if (seq < input.lastSeq) return;
    input.lastSeq = seq;

    // Clamp move
    input.move = {
      x: clamp(move.x, -1, 1),
      y: clamp(move.y, -1, 1),
    };
    const norm = normalize(input.move);
    if (length(norm) > 0) {
      input.lastMoveDir = norm;
    }

    // Edge-trigger dash request; processed on next tick if possible
    if (dash) input.dashRequest = true;

    // Record on Player for reconciliation
    p.lastInputSeq = seq;
    // recvTimeMs currently unused; could be used for input rate monitoring or latency metrics
  }

  // --- Round control

  maybeStartCountdown(now: number) {
    if (this.room.roundState !== "lobby") return;
    const players = Array.from(this.room.players.values());
    if (players.length >= 2 && players.every((p) => p.ready)) {
      this.room.roundState = "countdown";
      this.room.countdownEndAt = now + COUNTDOWN_SECONDS * 1000;
      // No explicit event; server will broadcast countdown message
    }
  }

  // Called each simulation tick by server
  tick(now: number, dtMs: number) {
    switch (this.room.roundState) {
      case "countdown":
        if ((this.room.countdownEndAt ?? 0) <= now) {
          this.startRound(now);
        }
        break;
      case "inRound":
        this.stepSimulation(now, dtMs);
        this.maybeRandomShake(now);
        this.processTileFalls(now);
        this.checkEliminations(now);
        this.maybeEndRound(now);
        break;
      case "roundOver":
      case "lobby":
      default:
        // no-op in fixed tick; transitions managed externally or via maybeStartCountdown
        break;
    }
    this.room.tick++;
  }

  private startRound(now: number) {
    // Reset tiles
    this.room.tiles = this.createFreshTiles();
    this.tileDeltaIdx.clear();
    this.events.length = 0;
    this.deathAt.clear();

    // Assign spawns on inner perimeter (randomized each round)
    const playerIds = Array.from(this.room.players.keys());
    const spawns = randomInnerPerimeterPositions(playerIds.length);
    this.lastSpawns = [];

    for (let i = 0; i < playerIds.length; i++) {
      const id = playerIds[i];
      const p = this.room.players.get(id)!;
      const s = spawns[i];
      const c = tileCenter(s.tx, s.ty);
      p.pos = { x: c.x, y: c.y };
      p.vel = { x: 0, y: 0 };
      p.alive = true;
      p.dashUntil = 0;
      p.dashCooldownUntil = 0;
      p.lastInputSeq = 0;

      const inp = this.inputs.get(id)!;
      inp.move = { x: 0, y: 0 };
      inp.dashRequest = false;
      inp.lastMoveDir = { x: 0, y: 1 };

      // record spawn assignment
      this.lastSpawns.push({ id, tx: s.tx, ty: s.ty });
    }

    // schedule first random tile shake in 1s
    this.nextRandomShakeAt = now + 1000;

    this.room.countdownEndAt = undefined;
    this.room.roundState = "inRound";
  }

  private endRound(now: number): { placements: Array<{ id: string; place: number }>; winnerId?: string } {
    const players = Array.from(this.room.players.values());
    const alive = players.filter((p) => p.alive);
    const dead = players.filter((p) => !p.alive);

    // Order: alive (winners) first (any order; typically 0..1), then dead by death time descending (later death = better place)
    const deadSorted = dead.sort((a, b) => (this.deathAt.get(b.id)! - this.deathAt.get(a.id)!));
    const ordered: Player[] = [...alive, ...deadSorted];

    const placements: Array<{ id: string; place: number }> = [];
    for (let i = 0; i < ordered.length; i++) {
      placements.push({ id: ordered[i].id, place: i + 1 });
    }
    const winnerId = placements.length > 0 ? placements[0].id : undefined;

    // Update leaderboard internal store
    this.leaderboard.recordPlacements(placements);

    // Mirror into room.leaderboard (informational)
    this.room.leaderboard = new Map(
      players.map((p) => [p.id, this.leaderboard.getStats(p.id)]),
    );

    this.room.roundState = "roundOver";
    return { placements, winnerId };
  }

  // --- Simulation core

  private stepSimulation(now: number, dtMs: number) {
    const dt = dtMs / 1000;

    // Integrate movement per player
    for (const p of this.room.players.values()) {
      if (!p.alive) continue;
      const input = this.inputs.get(p.id)!;

      // Handle dash start
      if (input.dashRequest && now >= p.dashCooldownUntil) {
        input.dashRequest = false;
        const dir = normalize(input.lastMoveDir);
        if (length(dir) > 0) {
          p.dashUntil = now + DASH_DURATION_MS;
          p.dashCooldownUntil = now + DASH_COOLDOWN_MS;
          p.vel = add(p.vel, mul(dir, DASH_IMPULSE));
        }
      }

      // Target velocity based on move input
      const desired = mul(normalize(input.move), PLAYER_MOVE_SPEED);
      // Accelerate towards desired
      const accel = PLAYER_ACCEL;
      const delta = sub(desired, p.vel);
      const deltaLen = length(delta);
      if (deltaLen > 0) {
        const step = Math.min(deltaLen, accel * dt);
        p.vel = add(p.vel, mul(mul(delta, 1 / (deltaLen || 1)), step));
      }

      // Friction (less when dashing)
      const friction = now < p.dashUntil ? PLAYER_FRICTION * 0.35 : PLAYER_FRICTION;
      const speed = length(p.vel);
      if (speed > 0) {
        const reduce = Math.max(0, speed - friction * dt);
        p.vel = mul(normalize(p.vel), reduce);
      }

      // Integrate position
      p.pos = add(p.pos, mul(p.vel, dt));

      // Tile stepping: trigger shake on first step onto SOLID
      const tile = posToTile(p.pos);
      if (tile) {
        const idx = tileIndex(tile.tx, tile.ty);
        const t = this.room.tiles[idx];
        if (t.state === "solid") {
          t.state = "shaking";
          t.shakeStartMs = now;
          t.fallAtMs = now + TILE_FALL_DELAY_MS;
          this.events.push({ kind: "tile_shake", idx });
          this.tileDeltaIdx.add(idx);
        }
      }
    }

    // Player-player collisions and dash pushback
    const players = Array.from(this.room.players.values()).filter((p) => p.alive);
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        const d = sub(b.pos, a.pos);
        const dist = length(d);
        const minDist = 2 * PLAYER_RADIUS;
        if (dist > 0 && dist < minDist) {
          const n = mul(d, 1 / dist);
          const overlap = minDist - dist;
          // Separate equally
          a.pos = add(a.pos, mul(n, -overlap / 2));
          b.pos = add(b.pos, mul(n, overlap / 2));

          // Dash pushback (stronger and also when both dashing)
          const aDash = now < a.dashUntil;
          const bDash = now < b.dashUntil;
          if (aDash && bDash) {
            a.vel = add(a.vel, mul(n, -(overlap + DASH_PUSHBACK_IMPULSE * 0.5)));
            b.vel = add(b.vel, mul(n, (overlap + DASH_PUSHBACK_IMPULSE * 0.5)));
          } else if (aDash && !bDash) {
            b.vel = add(b.vel, mul(n, overlap + DASH_PUSHBACK_IMPULSE));
          } else if (bDash && !aDash) {
            a.vel = add(a.vel, mul(n, -(overlap + DASH_PUSHBACK_IMPULSE)));
          }
        }
      }
    }
  }

  private processTileFalls(now: number) {
    for (let idx = 0; idx < this.room.tiles.length; idx++) {
      const t = this.room.tiles[idx];
      if (t.state === "shaking" && (t.fallAtMs ?? Infinity) <= now) {
        t.state = "fallen";
        // remove shakeStartMs to indicate final state
        t.shakeStartMs = t.shakeStartMs;
        this.events.push({ kind: "tile_fall", idx });
        this.tileDeltaIdx.add(idx);
      }
    }
  }

  // Randomly pick a SOLID tile once per second, start shaking, fall after normal delay
  private maybeRandomShake(now: number) {
    if (now < this.nextRandomShakeAt) return;
    this.nextRandomShakeAt = now + 1000;

    const solids: number[] = [];
    for (let i = 0; i < this.room.tiles.length; i++) {
      if (this.room.tiles[i].state === "solid") solids.push(i);
    }
    if (solids.length === 0) return;

    const idx = solids[(Math.random() * solids.length) | 0];
    const t = this.room.tiles[idx];
    t.state = "shaking";
    t.shakeStartMs = now;
    t.fallAtMs = now + TILE_FALL_DELAY_MS;
    this.events.push({ kind: "tile_shake", idx });
    this.tileDeltaIdx.add(idx);
  }

  private checkEliminations(now: number) {
    for (const p of this.room.players.values()) {
      if (!p.alive) continue;
      const tt = posToTile(p.pos);
      if (!tt) {
        // Off-grid: immediate death per spec
        this.markDead(p, now);
        this.unsupportedSince.delete(p.id);
        continue;
      }
      const idx = tileIndex(tt.tx, tt.ty);
      const t = this.room.tiles[idx];
      if (t.state === "fallen") {
        // Allow brief grace; allow dashing across gaps
        const start = this.unsupportedSince.get(p.id) ?? now;
        this.unsupportedSince.set(p.id, start);
        const dashing = now < p.dashUntil;
        if (!dashing && (now - start) >= FALL_GRACE_MS) {
          this.markDead(p, now);
          this.unsupportedSince.delete(p.id);
        }
      } else {
        // Supported again, clear grace timer
        this.unsupportedSince.delete(p.id);
      }
    }
  }

  private maybeEndRound(now: number) {
    const aliveCount = Array.from(this.room.players.values()).filter((p) => p.alive).length;
    if (aliveCount <= 1) {
      // Compute placements and update leaderboard; server will broadcast "round_over"
      this.endRound(now);
    }
  }

  private markDead(p: Player, at: number) {
    p.alive = false;
    this.deathAt.set(p.id, at);
    this.events.push({ kind: "death", playerId: p.id });
  }

  private createFreshTiles(): Tile[] {
    const tiles: Tile[] = new Array(MAP_WIDTH * MAP_HEIGHT);
    for (let i = 0; i < tiles.length; i++) {
      tiles[i] = { idx: i, state: "solid" };
    }
    return tiles;
    }

  // --- Snapshots and events

  buildSnapshotAndClear(): SnapshotData {
    const players: PlayerSnapshot[] = [];
    for (const p of this.room.players.values()) {
      players.push({
        id: p.id,
        pos: { ...p.pos },
        vel: { ...p.vel },
        dashActive: nowMs() < p.dashUntil,
        alive: p.alive,
      });
    }

    const tiles: TileDelta[] = [];
    for (const idx of this.tileDeltaIdx) {
      const t = this.room.tiles[idx];
      if (t.state !== "solid") {
        tiles.push({ idx, state: t.state });
      }
    }
    this.tileDeltaIdx.clear();

    const events = this.events.splice(0, this.events.length);

    return { players, tiles, events };
  }

  // Server uses this after state.roundOver detected to get placements and winner
  computeRoundResults(): { placements: Array<{ id: string; place: number }>; winnerId?: string } {
    // We didn't store the last computed results; recompute using endRound logic without side effects.
    // Duplicate logic to produce consistent results:
    const players = Array.from(this.room.players.values());
    const alive = players.filter((p) => p.alive);
    const dead = players.filter((p) => !p.alive);
    const deadSorted = dead.sort((a, b) => (this.deathAt.get(b.id)! - this.deathAt.get(a.id)!));
    const ordered: Player[] = [...alive, ...deadSorted];
    const placements: Array<{ id: string; place: number }> = [];
    for (let i = 0; i < ordered.length; i++) placements.push({ id: ordered[i].id, place: i + 1 });
    const winnerId = placements.length > 0 ? placements[0].id : undefined;
    return { placements, winnerId };
  }

  // --- Lobby helpers used by server

  lobbyView(): Array<{ id: string; name: string; color?: string; ready: boolean }> {
    return Array.from(this.room.players.values()).map((p) => ({
      id: p.id, name: p.name, color: p.color, ready: p.ready,
    }));
  }
getLastSpawnAssignments(): Array<{ id: string; tx: number; ty: number }> {
    return this.lastSpawns.slice();
  }

  resetToLobby() {
    // Reset players and room to Lobby state
    for (const p of this.room.players.values()) {
      // keep ready state across rounds
      p.alive = false;
      p.vel = { x: 0, y: 0 };
    }
    this.room.tiles = this.createFreshTiles();
    this.tileDeltaIdx.clear();
    this.events.length = 0;
    this.deathAt.clear();
    this.unsupportedSince.clear();
    this.lastSpawns = [];
    this.nextRandomShakeAt = 0;
    this.room.countdownEndAt = undefined;
    this.room.roundState = "lobby";
  }

  leaderboardSnapshot(): ReturnType<Leaderboard["snapshot"]> {
    return this.leaderboard.snapshot(this.room);
  }
}