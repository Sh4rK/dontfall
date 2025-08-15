// Core domain types for the Don't Fall backend

export type RoundState = "lobby" | "countdown" | "inRound" | "roundOver";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  name: string;
  color?: string;
  pos: Vec2;
  vel: Vec2;
  alive: boolean;
  dashCooldownUntil: number; // ms epoch (performance-based monotonic wall-time acceptable)
  dashUntil: number;         // ms epoch
  lastInputSeq: number;
  ready: boolean;
}

export type TileState = "solid" | "shaking" | "fallen";

export interface Tile {
  idx: number;                // linear index (ty * width + tx)
  state: TileState;
  shakeStartMs?: number;
  fallAtMs?: number;
}

// Events emitted by the simulation and included in snapshots
export interface TileShakeEvent {
  kind: "tile_shake";
  idx: number;
}
export interface TileFallEvent {
  kind: "tile_fall";
  idx: number;
}
export interface DeathEvent {
  kind: "death";
  playerId: string;
}
export type GameEvent = TileShakeEvent | TileFallEvent | DeathEvent;

// Snapshot sub-structures used in server->client "state"
export interface PlayerSnapshot {
  id: string;
  pos: Vec2;
  vel: Vec2;
  dashActive: boolean;
  alive: boolean;
}

// Tiles are sent as deltas (only changed indices)
export interface TileDelta {
  idx: number;
  state: Exclude<TileState, "solid">; // "shaking" | "fallen"
}

// Leaderboard stats (in-memory)
export interface LeaderboardStats {
  wins: number;
  games: number;
  totalPlace: number; // sum of placements (1 = best)
}

export interface RoomState {
  id: string;
  players: Map<string, Player>;
  tiles: Tile[];
  roundState: RoundState;
  leaderboard: Map<string, LeaderboardStats>;
  tick: number;
  mapSeed: number;
  countdownEndAt?: number; // ms epoch
}

// Utility helpers for coordinates and indexing
export interface GridSize {
  width: number;
  height: number;
}