// dontfall/backend/game.ts
//
// Core game simulation for the "Don't Fall" multiplayer arena.
// This module implements the server‑side tick loop, player
// movement, dash mechanics, tile shaking/falling, and
// round state transitions.
//
// The implementation follows the design
// described in SPEC.md and uses the
// configuration constants from `config.ts`.
//
// The module exports a `Game` class that can be
// instantiated per room and driven by
// `Game.tick()` from a timer.
//
// Types imported from `types.ts` are deliberately
// simple and JSON‑serializable so they can be
// sent directly to clients.

import {
  Player,
  PlayerId,
  Tile,
  TileState,
  RoomState,
  RoundState,
  InputMessage,
  ServerMessage,
} from "./types.ts";
import * as cfg from "./config.ts";
import { nowMs } from "./utils/time.ts";

/**
 * Helper to compute a linear index from tile coordinates.
 */
function tileIndex(x: number, y: number): number {
  return y * cfg.MAP_WIDTH + x;
}

/**
 * Helper to convert a linear index to coordinates.
 */
function indexToCoord(idx: number): { x: number; y: number } {
  const y = Math.floor(idx / cfg.MAP_WIDTH);
  const x = idx % cfg.MAP_WIDTH;
  return { x, y };
}

/**
 * Game class – one instance per room.
 */
export class Game {
  /** The mutable state of the room. */
  public state: RoomState;

  /** Timestamp (ms) of the last tick. */
  private lastTickTime: number = nowMs();

  /** Map of playerId -> pending input messages (ordered). */
  private inputQueue: Map<PlayerId, InputMessage[]> = new Map();

  /** Cached snapshot of the last state message sent to clients. */
  private lastStateMessage: ServerMessage | null = null;

  constructor(roomId: string) {
    this.state = {
      id: roomId,
      players: new Map(),
      tiles: [],
      roundState: "lobby",
      leaderboard: new Map(),
      tick: 0,
      mapSeed: Math.floor(Math.random() * 1_000_000),
    };
    this.initializeTiles();
  }

  /** Initialize the tile grid (all solid). */
  private initializeTiles() {
    const total = cfg.MAP_WIDTH * cfg.MAP_HEIGHT;
    this.state.tiles = Array.from({ length: total }, (_, idx) => ({
      idx,
      state: "solid" as TileState,
    }));
  }

  /** Add a new player (called when a client joins). */
  addPlayer(id: PlayerId, name: string, color: string) {
    const player: Player = {
      id,
      name,
      color,
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      alive: false,
      dashCooldownUntil: 0,
      dashUntil: 0,
      lastInputSeq: 0,
      ready: false,
    };
    this.state.players.set(id, player);
    this.inputQueue.set(id, []);
  }

  /** Remove a player (e.g., disconnect). */
  removePlayer(id: PlayerId) {
    this.state.players.delete(id);
    this.inputQueue.delete(id);
  }

  /** Queue an input message from a client. */
  enqueueInput(playerId: PlayerId, msg: InputMessage) {
    const queue = this.inputQueue.get(playerId);
    if (!queue) return; // unknown player
    // Ensure monotonic sequence numbers.
    if (msg.seq <= (this.state.players.get(playerId)?.lastInputSeq ?? -1)) {
      return;
    }
    queue.push(msg);
  }

  /** Main tick function – called at TICK_RATE. */
  tick() {
    const now = nowMs();
    const dt = (now - this.lastTickTime) / 1000; // seconds
    this.lastTickTime = now;
    this.state.tick++;

    // Process inputs first.
    this.processInputs();

    // Update simulation based on current round state.
    switch (this.state.roundState) {
      case "lobby":
        this.checkLobbyReady();
        break;
      case "countdown":
        this.updateCountdown(now);
        break;
      case "inRound":
        this.updateSimulation(dt, now);
        break;
      case "roundOver":
        // Wait a few seconds then reset to lobby.
        // For simplicity, transition immediately.
        this.resetToLobby();
        break;
    }

    // Build a state snapshot for clients.
    this.lastStateMessage = this.buildStateMessage(now);
  }

  /** Process queued input messages for each player. */
  private processInputs() {
    for (const [id, queue] of this.inputQueue.entries()) {
      const player = this.state.players.get(id);
      if (!player) continue;
      while (queue.length) {
        const msg = queue.shift()!;
        // Update last input seq.
        player.lastInputSeq = msg.seq;

        // Apply movement direction (normalized).
        const moveX = Math.max(-1, Math.min(1, msg.move.x));
        const moveY = Math.max(-1, Math.min(1, msg.move.y));
        const moveVec = { x: moveX, y: moveY };

        // Simple acceleration model.
        const accel = cfg.PLAYER_ACCEL;
        const friction = cfg.PLAYER_FRICTION;
        const targetSpeed = cfg.PLAYER_MOVE_SPEED;

        // Apply acceleration toward target direction.
        const desiredVel = {
          x: moveVec.x * targetSpeed,
          y: moveVec.y * targetSpeed,
        };
        const dv = {
          x: desiredVel.x - player.vel.x,
          y: desiredVel.y - player.vel.y,
        };
        // Apply acceleration limited by PLAYER_ACCEL.
        const maxDelta = accel * (1 / cfg.TICK_RATE);
        const delta = {
          x: Math.max(-maxDelta, Math.min(maxDelta, dv.x)),
          y: Math.max(-maxDelta, Math.min(maxDelta, dv.y)),
        };
        player.vel.x += delta.x;
        player.vel.y += delta.y;

        // Apply friction.
        const speed = Math.hypot(player.vel.x, player.vel.y);
        if (speed > 0) {
          const frictionDelta = friction * (1 / cfg.TICK_RATE);
          const newSpeed = Math.max(0, speed - frictionDelta);
          const scale = newSpeed / speed;
          player.vel.x *= scale;
          player.vel.y *= scale;
        }

        // Dash handling.
        const nowMs = nowMs();
        if (msg.dash && nowMs >= player.dashCooldownUntil) {
          // Apply dash impulse in current movement direction.
          const dirLen = Math.hypot(moveVec.x, moveVec.y);
          const impulseDir = dirLen > 0 ? { x: moveVec.x / dirLen, y: moveVec.y / dirLen } : { x: 0, y: 0 };
          player.vel.x += impulseDir.x * cfg.DASH_IMPULSE;
          player.vel.y += impulseDir.y * CFG.DASH_IMPULSE;
          player.dashUntil = nowMs + cfg.DASH_DURATION_MS;
          player.dashCooldownUntil = nowMs + cfg.DASH_COOLDOWN_MS;
        }
      }
    }
  }

  /** Check if all players are ready and enough players to start. */
  private checkLobbyReady() {
    const players = Array.from(this.state.players.values());
    const readyCount = players.filter((p) => p.ready).length;
    const enough = players.length >= 2 && readyCount === players.length;
    if (enough) {
      // Transition to countdown.
      this.state.roundState = "countdown";
      const now = nowMs();
      this.state.countdownEndAt = now + cfg.COUNTDOWN_SECONDS * 1000;
      // Broadcast countdown start (handled elsewhere).
    }
  }

  /** Update countdown timer and start round when done. */
  private updateCountdown(now: number) {
    if (!this.state.countdownEndAt) return;
    if (now >= this.state.countdownEndAt) {
      this.startRound();
    }
  }

  /** Start a new round – assign spawns, reset players/tiles. */
  private startRound() {
    // Reset tiles.
    this.initializeTiles();

    // Assign spawn positions on perimeter.
    const perimeter = this.computePerimeterSpawns();
    let i = 0;
    for (const player of this.state.players.values()) {
      const { x, y } = perimeter[i % perimeter.length];
      player.pos = { x: x * cfg.TILE_SIZE + cfg.TILE_SIZE / 2, y: y * cfg.TILE_SIZE + cfg.TILE_SIZE / 2 };
      player.vel = { x: 0, y: 0 };
      player.alive = true;
      player.dashCooldownUntil = 0;
      player.dashUntil = 0;
      i++;
    }

    this.state.roundState = "inRound";
  }

  /** Compute perimeter tile coordinates for spawning. */
  private computePerimeterSpawns(): { x: number; y: number }[] {
    const positions: { x: number; y: number }[] = [];
    const w = cfg.MAP_WIDTH;
    const h = cfg.MAP_HEIGHT;
    // Top row
    for (let x = 0; x < w; x++) positions.push({ x, y: 0 });
    // Right column (excluding corners)
    for (let y = 1; y < h - 1; y++) positions.push({ x: w - 1, y });
    // Bottom row (reverse)
    for (let x = w - 1; x >= 0; x--) positions.push({ x, y: h - 1 });
    // Left column (excluding corners)
    for (let y = h - 2; y > 0; y--) positions.push({ x: 0, y });
    // If more players than perimeter tiles, we will reuse positions.
    return positions;
  }

  /** Main simulation for the in‑round state. */
  private updateSimulation(dt: number, now: number) {
    // Update player positions.
    for (const player of this.state.players.values()) {
      if (!player.alive) continue;
        // Apply dash expiration.
        if (player.dashUntil && now >= player.dashUntil) {
          // End dash – no extra logic needed.
          player.dashUntil = 0;
        }

        // Update position based on velocity.
        player.pos.x += player.vel.x * dt;
        player.pos.y += player.vel.y * dt;

        // Clamp to map bounds.
        const maxX = cfg.MAP_WIDTH * cfg.TILE_SIZE;
        const maxY = cfg.MAP_HEIGHT * cfg.TILE_SIZE;
        if (player.pos.x < 0) player.pos.x = 0;
        if (player.pos.y < 0) player.pos.y = 0;
        if (player.pos.x > maxX) player.pos.x = maxX;
        if (player.pos.y > maxY) player.pos.y = maxY;

        // Determine tile under player.
        const tx = Math.floor(player.pos.x / cfg.TILE_SIZE);
        const ty = Math.floor(player.pos.y / cfg.TILE_SIZE);
        const idx = tileIndex(tx, ty);
        const tile = this.state.tiles[idx];
        if (!tile) continue;

        // Tile stepping logic.
        if (tile.state === "solid") {
          // First step on tile – start shaking.
          tile.state = "shaking";
          tile.shakeStartMs = now;
          tile.fallAtMs = now + cfg.TILE_FALL_DELAY_MS;
        }
      }

    // Process tile shaking/falling.
    for (const tile of this.state.tiles) {
      if (tile.state === "shaking" && tile.fallAtMs && now >= tile.fallAtMs) {
        // Tile falls.
        tile.state = "fallen";
        // Check players standing on this tile.
        for (const player of this.state.players.values()) {
          if (!player.alive) continue;
          const tx = Math.floor(player.pos.x / cfg.TILE_SIZE);
          const ty = Math.floor(player.pos.y / cfg.TILE_SIZE);
          const idx = tileIndex(tx, ty);
          if (idx === tile.idx) {
            // Player's tile fell – player dies.
            player.alive = false;
          }
        }
      }
    }

    // Check for round end.
    const alivePlayers = Array.from(this.state.players.values()).filter(
      (p) => p.alive,
    );
    if (alivePlayers.length <= 1) {
      this.endRound(alivePlayers);
    }
  }

  /** End the round and compute placements. */
  private endRound(alivePlayers: Player[]) {
    // Determine placements.
    const placements: { id: PlayerId; place: number }[] = [];
    const sorted = Array.from(this.state.players.values()).sort(
      (a, b) => {
        // Alive first, then by name for deterministic order.
        if (a.alive && !b.alive) return -1;
        if (!a.alive && b.alive) return 1;
        return a.name.localeCompare(b.name);
      },
    );
    let place = 1;
    for (const p of sorted) {
      placements.push({ id: p.id, place });
      place++;
    }

    // Record placements in leaderboard.
    for (const { id, place } of placements) {
      const entry = this.state.leaderboard.get(id) ?? {
        wins: 0,
        games: 0,
        totalPlace: 0,
      };
      entry.games += 1;
      entry.totalPlace += place;
      if (place === 1) entry.wins += 1;
      this.state.leaderboard.set(id, entry);
    }

    // Broadcast round_over (handled elsewhere).
    this.state.roundState = "roundOver";
  }

  /** Reset the game to lobby state after a round. */
  private resetToLobby() {
    // Reset ready flags.
    for (const player of this.state.players.values()) {
      player.ready = false;
      player.alive = false;
    }
    this.state.roundState = "lobby";
  }

  /** Build a snapshot state message for clients. */
  private buildStateMessage(now: number): ServerMessage {
    const players = Array.from(this.state.players.values()).map(
      (p) => ({
        id: p.id,
        pos: p.pos,
        vel: p.vel,
        dashActive: now < p.dashUntil,
        alive: p.alive,
      }),
    );

    // For simplicity, send all tiles (could be optimized to deltas).
    const tiles = this.state.tiles.map((t) => ({
      idx: t.idx,
      state: t.state,
    }));

    const msg: ServerMessage = {
      type: "state",
      tick: this.state.tick,
      serverTime: now,
      players,
      tiles,
      events: [], // No events emitted in this simplified version.
    };
    return msg;
  }

  /** Get the latest state message (for sending). */
  getLatestState(): ServerMessage | null {
    return this.lastStateMessage;
  }
}
