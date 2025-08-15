/**
 * Game configuration constants.
 * Mirrors the values described in SPEC.md.
 * Adjust as needed for tuning.
 */

export const ROOM_MAX_PLAYERS = 8;

export const MAP_WIDTH = 15;
export const MAP_HEIGHT = 15;
export const TILE_SIZE = 1.0;
export const SPAWN_PERIMETER_ONLY = true;

// Timing and tick rates
export const TICK_RATE = 30; // server simulation ticks per second
export const STATE_SNAPSHOT_RATE = 10; // snapshots per second sent to clients
export const COUNTDOWN_SECONDS = 3;
export const TILE_FALL_DELAY_MS = 3000;
export const INTERP_BUFFER_MS = 100; // client interpolation buffer

// Player physics
export const PLAYER_MOVE_SPEED = 5.0; // units per second (target)
export const PLAYER_ACCEL = 30.0;
export const PLAYER_FRICTION = 10.0;
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.2;

// Dash tuning
export const DASH_IMPULSE = 10.0; // impulse applied when dashing
export const DASH_DURATION_MS = 180;
export const DASH_COOLDOWN_MS = 2000;
export const DASH_PUSHBACK_IMPULSE = 6.0;

// Visual tuning
export const TILE_SHAKE_AMPLITUDE = 0.05;
export const TILE_SHAKE_FREQUENCY_HZ = 10;
export const ARROW_MARKER_DURATION_MS = 1500;

/**
 * Export a single config object for convenience.
 */
export const CONFIG = {
  ROOM_MAX_PLAYERS,
  MAP_WIDTH,
  MAP_HEIGHT,
  TILE_SIZE,
  SPAWN_PERIMETER_ONLY,
  TICK_RATE,
  STATE_SNAPSHOT_RATE,
  COUNTDOWN_SECONDS,
  TILE_FALL_DELAY_MS,
  INTERP_BUFFER_MS,
  PLAYER_MOVE_SPEED,
  PLAYER_ACCEL,
  PLAYER_FRICTION,
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  DASH_IMPULSE,
  DASH_DURATION_MS,
  DASH_COOLDOWN_MS,
  DASH_PUSHBACK_IMPULSE,
  TILE_SHAKE_AMPLITUDE,
  TILE_SHAKE_FREQUENCY_HZ,
  ARROW_MARKER_DURATION_MS,
} as const;
