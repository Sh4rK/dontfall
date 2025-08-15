// In-memory leaderboard for Don't Fall

import type { LeaderboardStats, RoomState } from "./types.ts";

export interface Placement {
  id: string;
  place: number; // 1 = best
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  wins: number;
  games: number;
  totalPlace: number;
  avgPlace: number;
}

export class Leaderboard {
  private stats = new Map<string, LeaderboardStats>();

  recordPlacements(placements: Placement[]) {
    // Update games/places and wins for place=1
    for (const p of placements) {
      const s = this.stats.get(p.id) ?? { wins: 0, games: 0, totalPlace: 0 };
      s.games += 1;
      s.totalPlace += p.place;
      if (p.place === 1) s.wins += 1;
      this.stats.set(p.id, s);
    }
  }

  getStats(playerId: string): LeaderboardStats {
    return this.stats.get(playerId) ?? { wins: 0, games: 0, totalPlace: 0 };
  }

  snapshot(room: Pick<RoomState, "players">): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    for (const [id, stats] of this.stats) {
      const p = room.players.get(id);
      if (!p) continue; // remove disconnected players from leaderboard
      const avgPlace = stats.games > 0 ? stats.totalPlace / stats.games : 0;
      entries.push({
        id,
        name: p.name,
        wins: stats.wins,
        games: stats.games,
        totalPlace: stats.totalPlace,
        avgPlace,
      });
    }
    // Sort by: wins desc, then avgPlace asc, then games desc
    entries.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.avgPlace !== b.avgPlace) return a.avgPlace - b.avgPlace;
      return b.games - a.games;
    });
    return entries;
  }
}