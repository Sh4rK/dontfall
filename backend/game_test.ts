// Deno tests for core game logic

import {
  COUNTDOWN_SECONDS,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  MAP_HEIGHT,
  MAP_WIDTH,
  TILE_SIZE,
} from "./config.ts";
import { GameRoom } from "./game.ts";
import type { Vec2 } from "./types.ts";
import {
  assert,
  assertEquals,
  assertFalse,
  assertGreaterOrEqual,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

function posToTile(pos: Vec2) {
  const HALF_W_TILES = MAP_WIDTH / 2;
  const HALF_H_TILES = MAP_HEIGHT / 2;
  const fx = pos.x / TILE_SIZE + HALF_W_TILES;
  const fy = pos.y / TILE_SIZE + HALF_H_TILES;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  if (tx < 0 || tx >= MAP_WIDTH || ty < 0 || ty >= MAP_HEIGHT) return null;
  return { tx, ty };
}

function tileIndex(tx: number, ty: number) {
  return ty * MAP_WIDTH + tx;
}

Deno.test("Tile falls triggers death if player stands on it", () => {
  const room = new GameRoom("test");
  const t0 = 1000;

  // Add two players and ready up (min 2 to start)
  const p1 = crypto.randomUUID();
  const p2 = crypto.randomUUID();
  room.addPlayer(p1, "A");
  room.addPlayer(p2, "B");
  room.setReady(p1, true);
  room.setReady(p2, true);

  // Start countdown and then start round
  room.maybeStartCountdown(t0);
  assertEquals(room.state.roundState, "countdown");
  room.tick(t0, 33);
  const tStart = t0 + COUNTDOWN_SECONDS * 1000;
  room.tick(tStart, 33);
  assertEquals(room.state.roundState, "inRound");

  // Get P1 tile
  const p1State = room.state.players.get(p1)!;
  const tt = posToTile(p1State.pos);
  assert(tt, "p1 must be on a valid tile");
  const idx = tileIndex(tt!.tx, tt!.ty);

  // Arm tile to fall very soon
  const tiles = room.state.tiles;
  tiles[idx].state = "shaking";
  tiles[idx].fallAtMs = tStart + 10;

  // Advance time past fallAtMs to trigger fall and elimination
  room.tick(tStart + 15, 33);

  // The tile should be fallen and p1 should be dead
  assertEquals(tiles[idx].state, "fallen");
  const p1After = room.state.players.get(p1)!;
  assertFalse(p1After.alive);
});

Deno.test("Dash respects cooldown and duration", () => {
  const room = new GameRoom("test2");
  const t0 = 5000;

  // Two players
  const p1 = crypto.randomUUID();
  const p2 = crypto.randomUUID();
  room.addPlayer(p1, "A");
  room.addPlayer(p2, "B");
  room.setReady(p1, true);
  room.setReady(p2, true);

  // Start round
  room.maybeStartCountdown(t0);
  room.tick(t0, 33);
  const tStart = t0 + COUNTDOWN_SECONDS * 1000;
  room.tick(tStart, 33);
  assertEquals(room.state.roundState, "inRound");

  // First dash attempt
  room.handleInput(p1, 1, { x: 1, y: 0 }, true, tStart);
  room.tick(tStart, 33);
  const p1a = room.state.players.get(p1)!;
  const firstDashUntil = p1a.dashUntil;
  assertGreaterOrEqual(firstDashUntil, tStart + DASH_DURATION_MS);

  // Immediate second dash should be blocked by cooldown
  const tShort = tStart + 10;
  room.handleInput(p1, 2, { x: 1, y: 0 }, true, tShort);
  room.tick(tShort, 33);
  const p1b = room.state.players.get(p1)!;
  // dashUntil should not increase
  assert(p1b.dashUntil <= firstDashUntil);

  // After cooldown, dash allowed again
  const tAfterCd = firstDashUntil + DASH_COOLDOWN_MS + 1;
  room.handleInput(p1, 3, { x: 1, y: 0 }, true, tAfterCd);
  room.tick(tAfterCd, 33);
  const p1c = room.state.players.get(p1)!;
  assertGreaterOrEqual(p1c.dashUntil, tAfterCd + DASH_DURATION_MS);
});