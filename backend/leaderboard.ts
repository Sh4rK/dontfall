// dontfall/backend/leaderboard.ts
//
// In‑memory leaderboard implementation for the "Don't Fall" game.
// The module tracks per‑player statistics for a single room.
// It is deliberately simple – no persistence, no external DB.
//
// The data structure mirrors the `leaderboard` field in
// `RoomState` (see `types.ts`).  It stores:
//
//   - wins: number of rounds the player won.
//   - games: total rounds the player participated in.
//   - totalPlace: sum of placement positions (1 = first place, 2 = second, …).
//     This allows us to compute an average placement.
//
// The exported API is intentionally small so the game loop
// can update it without pulling in any heavy dependencies.

import type { PlayerId } from "./types.ts";

/**
 * A single entry in the leaderboard.
 */
export interface LeaderboardEntry {
  /** Number of round wins. */
  wins: number;
  /** Number of rounds played (including wins). */
  games: number;
  /** Sum of placement positions (1‑based). */
  totalPlace: number;
}

/**
 * The in‑memory leaderboard map.
 *
 * The map key is the player's unique ID.  The value is a
 * `LeaderboardEntry` that is mutated in‑place.
 */
export type LeaderboardMap = Map<PlayerId, LeaderboardEntry>;

/**
 * Ensure an entry exists for the given player ID.
 *
 * If the player is not yet present in the map, a new entry
 * with zeroed counters is inserted.
 *
 * @param map The leaderboard map.
 * @param playerId The ID of the player.
 * @returns The entry for the player (existing or newly created).
 */
export function ensureEntry(
  map: LeaderboardMap,
  playerId: PlayerId,
): LeaderboardEntry {
  let entry = map.get(playerId);
  if (!entry) {
    entry = { wins: 0, games: 0, totalPlace: 0 };
    map.set(playerId, entry);
  }
  return entry;
}

/**
 * Record a completed round for a set of placements.
 *
 * `placements` is an array of objects where `place` is
 * the 1‑based placement (1 = winner, 2 = runner‑up, …).
 *
 * @param map The leaderboard map.
 * @param placements Array of placement objects for the round.
 */
export function recordRound(
  map: LeaderboardMap,
  placements: { id: PlayerId; place: number }[],
): void {
  for (const { id, place } of placements) {
    const entry = ensureEntry(map, id);
    entry.games += 1;
    entry.totalPlace += place;
    if (place === 1) {
      entry.wins += 1;
    }
  }
}

/**
 * Compute the average placement for a player.
 *
 * Returns `null` if the player has not played any games.
 *
 * @param entry The leaderboard entry.
 * @returns Average placement (lower is better) or null.
 */
export function averagePlace(entry: LeaderboardEntry): number | null {
  if (entry.games === 0) return null;
  return entry.totalPlace / games;
}

/**
 * Convert the leaderboard map into an array suitable for
 * sending to the client.  The array is sorted by
 * descending win count, then ascending average placement.
 *
 * @param map The leaderboard map.
 * @returns Sorted array of leaderboard entries.
 */
export function toArray(
  map: LeaderboardMap,
): {
  id: PlayerId;
  wins: number;
  games: number;
  totalPlace: number;
  avgPlace: number | null;
}[] {
  const arr: {
    id: PlayerId;
    wins: number;
    games: number;
    totalPlace: number;
    avgPlace: number | null;
  }[] = [];

  for (const [id, entry] of map.entries()) {
    const avg = averageEntry(entry);
    arr.push({
      id,
      wins: entry.wins,
      games: entry.games,
      totalPlace: entry.totalPlace,
      avgPlace: avg,
    });
  }

  // Sort: most wins first, then best average placement.
  arr.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aAvg = a.avgPlace ?? Infinity;
    const bAvg = b.avgPlace ?? Infinity;
    return aAvg - bAvg;
  });

  return arr;
}

/**
 * Helper to compute average placement for an entry.
 *
 * @param entry The leaderboard entry.
 * @returns Average placement or null.
 */
function averageEntry(entry: LeaderboardEntry): number | null {
  if (entry.games === 0) return null;
  return entry.totalPlace / entry.games;
}
