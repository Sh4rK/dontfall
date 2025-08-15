// Client-side constants (mirrored and overridden by server "welcome")

export const DEFAULT_CONSTANTS = {
  ROOM_MAX_PLAYERS: 8,

  MAP_WIDTH: 15,
  MAP_HEIGHT: 15,
  TILE_SIZE: 1.0,
  SPAWN_PERIMETER_ONLY: true,

  TICK_RATE: 30,
  STATE_SNAPSHOT_RATE: 10,
  COUNTDOWN_SECONDS: 3,
  TILE_FALL_DELAY_MS: 3000,
  INTERP_BUFFER_MS: 100, // target interpolation delay for remote players

  PLAYER_MOVE_SPEED: 5.0,
  PLAYER_ACCEL: 30.0,
  PLAYER_FRICTION: 10.0,
  PLAYER_RADIUS: 0.35,
  PLAYER_HEIGHT: 1.2,

  DASH_IMPULSE: 10.0,
  DASH_DURATION_MS: 180,
  DASH_COOLDOWN_MS: 2000,
  DASH_PUSHBACK_IMPULSE: 6.0,

  TILE_SHAKE_AMPLITUDE: 0.05,
  TILE_SHAKE_FREQUENCY_HZ: 10,
  ARROW_MARKER_DURATION_MS: 1500,
};

export let C = { ...DEFAULT_CONSTANTS };

export function applyServerConstants(serverC) {
  // Server sends a subset; merge shallowly
  C = { ...C, ...serverC };
}

export const PASTEL_PALETTE = [
  "#A8D8FF", // Pastel Blue
  "#BFFCC6", // Pastel Green
  "#FFCCE5", // Pastel Pink
  "#FFF3B0", // Pastel Yellow
  "#D7C4F3", // Pastel Purple
  "#FFD4A8", // Pastel Orange
  "#B9FBC0", // Mint
  "#FFD1BA", // Peach
];

// Simple clamp helper
export const clamp01 = (v) => Math.max(0, Math.min(1, v));