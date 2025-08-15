// Don't Fall — Named constants per SPEC

// Room and map
export const ROOM_MAX_PLAYERS = 8 as const;
export const MAP_WIDTH = 15 as const;
export const MAP_HEIGHT = 15 as const;
export const TILE_SIZE = 1.0 as const;
export const SPAWN_PERIMETER_ONLY = true as const;

// Timing and tick rates
export const TICK_RATE = 30 as const; // server simulation ticks/sec
export const STATE_SNAPSHOT_RATE = 10 as const; // server sends state updates/sec
export const COUNTDOWN_SECONDS = 3 as const;
export const TILE_FALL_DELAY_MS = 3000 as const;
export const INTERP_BUFFER_MS = 100 as const;

// Player physics
export const PLAYER_MOVE_SPEED = 5.0 as const; // units/sec target
export const PLAYER_ACCEL = 30.0 as const;
export const PLAYER_FRICTION = 10.0 as const;
export const PLAYER_RADIUS = 0.35 as const;
export const PLAYER_HEIGHT = 1.2 as const;

// Dash tuning
export const DASH_IMPULSE = 10.0 as const;
export const DASH_DURATION_MS = 180 as const;
export const DASH_COOLDOWN_MS = 2000 as const;
export const DASH_PUSHBACK_IMPULSE = 6.0 as const;

// Visual tuning (mirrored client-side)
export const TILE_SHAKE_AMPLITUDE = 0.05 as const;
export const TILE_SHAKE_FREQUENCY_HZ = 10 as const;
export const ARROW_MARKER_DURATION_MS = 1500 as const;

// Server-only configuration
export const HTTP_PORT = 8000 as const;
export const INPUT_RATE_LIMIT_PER_SEC = 60 as const;

// Derived
export const MAP_TILE_COUNT = MAP_WIDTH * MAP_HEIGHT;

// Bundle of constants intended to be mirrored client-side (sent in "welcome")
export const CONSTANTS = {
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

export type ServerConstants = typeof CONSTANTS;