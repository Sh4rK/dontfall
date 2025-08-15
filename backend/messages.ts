// Message schemas and helpers (Zod) for Don't Fall networking

import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import type { ServerConstants } from "./config.ts";
import type { Vec2, PlayerSnapshot, TileDelta, GameEvent } from "./types.ts";

// ============ Client -> Server ============

const MoveVec = z.object({
  x: z.number().finite().refine((v) => v >= -1 && v <= 1, "x in [-1,1]"),
  y: z.number().finite().refine((v) => v >= -1 && v <= 1, "y in [-1,1]"),
});

export const JoinMsg = z.object({
  type: z.literal("join"),
  name: z.string().trim().min(1).max(20),
  color: z.string().trim().min(1).max(20).optional(),
});

export type JoinMsg = z.infer<typeof JoinMsg>;

export const ReadyMsg = z.object({
  type: z.literal("ready"),
  ready: z.boolean(),
});

export type ReadyMsg = z.infer<typeof ReadyMsg>;

export const InputMsg = z.object({
  type: z.literal("input"),
  seq: z.number().int().nonnegative(),
  ts: z.number().finite(), // client ms timestamp (epoch)
  move: MoveVec,
  dash: z.boolean(),
});

export type InputMsg = z.infer<typeof InputMsg>;

export const PongMsg = z.object({
  type: z.literal("pong"),
  ts: z.number().finite(),
});

export type PongMsg = z.infer<typeof PongMsg>;

export const ClientMessage = z.discriminatedUnion("type", [
  JoinMsg,
  ReadyMsg,
  InputMsg,
  PongMsg,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

// ============ Server -> Client ============

const LobbyPlayer = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
  ready: z.boolean(),
});

export type LobbyPlayer = z.infer<typeof LobbyPlayer>;

const SpawnAssignment = z.object({
  id: z.string(),
  tx: z.number().int().nonnegative(),
  ty: z.number().int().nonnegative(),
});

export type SpawnAssignment = z.infer<typeof SpawnAssignment>;

const PlayerSnap = z.object({
  id: z.string(),
  pos: z.object({ x: z.number(), y: z.number() }) as z.ZodType<Vec2>,
  vel: z.object({ x: z.number(), y: z.number() }) as z.ZodType<Vec2>,
  dashActive: z.boolean(),
  alive: z.boolean(),
}) as z.ZodType<PlayerSnapshot>;

const TileDeltaSchema = z.object({
  idx: z.number().int().nonnegative(),
  state: z.union([z.literal("shaking"), z.literal("fallen")]),
}) as z.ZodType<TileDelta>;

const GameEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tile_shake"), idx: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("tile_fall"), idx: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("death"), playerId: z.string() }),
]) as z.ZodType<GameEvent>;

export const WelcomeMsg = z.object({
  type: z.literal("welcome"),
  playerId: z.string(),
  roomId: z.string(),
  constants: z.any() as unknown as z.ZodType<ServerConstants>,
  mapSeed: z.number().int(),
  mapSize: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
});

export type WelcomeMsg = z.infer<typeof WelcomeMsg>;

export const LobbyStateMsg = z.object({
  type: z.literal("lobby_state"),
  players: z.array(LobbyPlayer),
  minPlayers: z.number().int().positive(),
  maxPlayers: z.number().int().positive(),
  allReady: z.boolean(),
});

export type LobbyStateMsg = z.infer<typeof LobbyStateMsg>;

export const CountdownMsg = z.object({
  type: z.literal("countdown"),
  seconds: z.number().int().nonnegative(),
  serverTime: z.number().finite(),
});

export type CountdownMsg = z.infer<typeof CountdownMsg>;

export const RoundStartMsg = z.object({
  type: z.literal("round_start"),
  spawnAssignments: z.array(SpawnAssignment),
  mapSeed: z.number().int(),
});

export type RoundStartMsg = z.infer<typeof RoundStartMsg>;

export const StateMsg = z.object({
  type: z.literal("state"),
  tick: z.number().int().nonnegative(),
  serverTime: z.number().finite(),
  players: z.array(PlayerSnap),
  tiles: z.array(TileDeltaSchema), // deltas only
  events: z.array(GameEventSchema),
  lastAckSeq: z.number().int().nonnegative().optional(), // optional reconciliation aid
});

export type StateMsg = z.infer<typeof StateMsg>;

export const RoundOverMsg = z.object({
  type: z.literal("round_over"),
  placements: z.array(z.object({ id: z.string(), place: z.number().int().positive() })),
  winnerId: z.string().optional(),
});

export type RoundOverMsg = z.infer<typeof RoundOverMsg>;

export const LeaderboardMsg = z.object({
  type: z.literal("leaderboard"),
  entries: z.array(z.object({
    id: z.string(),
    name: z.string(),
    wins: z.number().int().nonnegative(),
    games: z.number().int().nonnegative(),
    totalPlace: z.number().int().nonnegative(),
    avgPlace: z.number().finite(),
  })),
});

export type LeaderboardMsg = z.infer<typeof LeaderboardMsg>;

export const PingMsg = z.object({
  type: z.literal("ping"),
  ts: z.number().finite(),
});

export type PingMsg = z.infer<typeof PingMsg>;

export const ServerMessage = z.discriminatedUnion("type", [
  WelcomeMsg,
  LobbyStateMsg,
  CountdownMsg,
  RoundStartMsg,
  StateMsg,
  RoundOverMsg,
  LeaderboardMsg,
  PingMsg,
]);

export type ServerMessage = z.infer<typeof ServerMessage>;

// ============ Helpers ============

/**
 * Safely parse an incoming raw JSON (unknown) into a validated ClientMessage.
 * Throws ZodError if invalid.
 */
export function parseClientMessage(raw: unknown): ClientMessage {
  return ClientMessage.parse(raw);
}

/**
 * Type guard for server messages (for internal correctness checks).
 */
export function isServerMessage(msg: unknown): msg is ServerMessage {
  const res = ServerMessage.safeParse(msg);
  return res.success;
}