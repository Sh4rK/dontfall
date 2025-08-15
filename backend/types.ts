/**
 * Types for the Don't Fall backend.
 *
 * This file defines the core data structures used by the server
 * simulation and the WebSocket messaging protocol.
 *
 * All types are deliberately simple and serializable to JSON,
 * matching the specifications in SPEC.md.
 */

export type PlayerId = string;
export type RoomId = string;

/**
 * Position / velocity on the X‑Z plane (Y is up in Three.js).
 * The server uses a 2‑D plane for movement; the Y coordinate
 * is derived from PLAYER_HEIGHT when needed.
 */
export interface Vec2 {
  /** X coordinate (horizontal) */
  x: number;
  /** Y coordinate (forward) */
  y: number;
}

/**
 * Player state stored on the server.
 */
export interface Player {
  /** Unique identifier for the player (connection ID) */
  id: PlayerId;

  /** Display name chosen by the player */
  name: string;

  /** Hex color string (e.g. "#ff99aa") */
  color: string;

  /** Current position (center of capsule) */
  pos: Vec2;

  /** Current velocity */
  vel: Vec2;

  /** Whether the player is alive in the current round */
  alive: boolean;

  /** Timestamp (ms) when dash cooldown ends (0 if ready) */
  dashCooldownUntil: number;

  /** Timestamp (ms) when dash ends (0 if not dashing) */
  dashUntil: number;

  /** Last input sequence number processed */
  lastInputSeq: number;

  /** Ready status in lobby */
  ready: boolean;
}

/**
 * Tile state.
 *
 * - "solid": tile is present and can be stepped on.
 * - "shaking": tile has been stepped on and will fall after a delay.
 * - "fallen": tile has been removed from the scene.
 */
export type TileState = "solid" | "shaking" | "fallen";

/**
 * Tile data stored on the server.
 */
export interface Tile {
  /** Tile index in row‑major order (0..MAP_WIDTH*MAP_HEIGHT-1) */
  idx: number;

  /** Current state of the tile */
  state: TileState;

  /** Timestamp (ms) when shaking started (undefined if not shaking) */
  shakeStartMs?: number;

  /** Timestamp (ms) when the tile should fall (undefined if not scheduled) */
  fallAtMs?: number;
}

/**
 * Round state machine.
 */
export type RoundState = "lobby" | "countdown" | "inRound" | "roundOver";

/**
 * Game room state.
 */
export interface RoomState {
  /** Unique identifier for the room */
  id: RoomId;

  /** Map of playerId -> Player */
  players: Map<PlayerId, Player>;

  /** Array of tiles for the map */
  tiles: Tile[];

  /** Current round state */
  roundState: RoundState;

  /** In‑memory leaderboard */
  leaderboard: Map<
    PlayerId,
    {
      wins: number;
      games: number;
      totalPlace: number;
    }
  >;

  /** Server tick counter */
  tick: number;

  /** Random seed used for map generation */
  mapSeed: number;

  /** Timestamp (ms) when the countdown ends (if in countdown) */
  countdownEndAt?: number;
}

/**
 * Input message from client to server.
 */
export interface InputMessage {
  type: "input";
  seq: number; // monotonically increasing per client
  ts: number; // client timestamp (ms)
  move: {
    /** -1..1 movement direction on X axis */
    x: number;
    /** -1..1 movement direction on Y axis */
    y: number;
  };
  dash: boolean;
}

/**
 * Server‑to‑client message types.
 */
export type ServerMessage =
  | {
      type: "welcome";
      playerId: PlayerId;
      roomId: RoomId;
      constants: Record<string, unknown>;
      mapSeed: number;
      mapSize: { width: number; height: number };
    }
  | {
      type: "lobby_state";
      players: {
        id: PlayerId;
        name: string;
        color: string;
        ready: boolean;
      }[];
      minPlayers: number;
      maxPlayers: number;
      allReady: boolean;
    }
  | {
      type: "countdown";
      seconds: number;
      serverTime: number;
    }
  | {
      type: "round_start";
      spawnAssignments: { id: PlayerId; tx: number; ty: number }[];
      mapSeed: number;
    }
  | {
      type: "state";
      tick: number;
      serverTime: number;
      players: {
        id: PlayerId;
        pos: Vec2;
        vel: Vec2;
        dashActive: boolean;
        alive: boolean;
      }[];
      tiles: Partial<Tile>[];
      events: {
        kind: "tile_shake" | "tile_fall" | "death";
        playerId?: PlayerId;
        idx?: number;
      }[];
    }
  | {
      type: "round_over";
      placements: { id: PlayerId; place: number }[];
      winnerId?: PlayerId;
    }
  | {
      type: "leaderboard";
      entries: {
        id: PlayerId;
        name: string;
        wins: number;
        games: number;
        totalPlace: number;
        avgPlace: number;
      }[];
    }
  | {
      type: "ping";
      ts: number;
    };
