# Don't Fall — Backend

Deno HTTP + WebSocket backend implementing the authoritative game server per SPEC.

- Port: 8000
- Static files served from ./frontend (index.html expected)
- WebSocket endpoint: /ws?roomId=<id> (defaults to "default")
- Health: GET /health

## Run

Requirements: Deno (latest stable).

Start server:
```sh
deno run -A backend/server.ts
```

Open http://localhost:8000/

## Protocol (JSON over WebSocket)

Client → Server:
- join: { type: "join", name: string, color?: string }
- ready: { type: "ready", ready: boolean }
- input: { type: "input", seq: number, ts: number, move: { x: -1..1, y: -1..1 }, dash: boolean }
- pong: { type: "pong", ts: number }

Server → Client:
- welcome: { type: "welcome", playerId, roomId, constants, mapSeed, mapSize }
- lobby_state: { type: "lobby_state", players: [{ id, name, color, ready }], minPlayers, maxPlayers, allReady }
- countdown: { type: "countdown", seconds, serverTime }
- round_start: { type: "round_start", spawnAssignments: [{ id, tx, ty }], mapSeed }
- state: { type: "state", tick, serverTime, players, tiles, events, lastAckSeq? }
- round_over: { type: "round_over", placements, winnerId? }
- leaderboard: { type: "leaderboard", entries }
- ping: { type: "ping", ts }

Messages are validated with Zod (URL import). VS Code TS may show transient type hints until Deno fetches modules at runtime.

## Game loop

- TICK_RATE = 30 Hz authoritative simulation
- STATE_SNAPSHOT_RATE = 10 Hz broadcasts (tiles as deltas, events stream)
- Lobby → Countdown (3s) → InRound → RoundOver → back to Lobby (auto)

Input rate limiting: 60/s per client.

## Dev

Run tests:
```sh
deno test -A backend/game_test.ts
```

Key modules:
- backend/config.ts — named constants
- backend/types.ts — core types
- backend/messages.ts — Zod schemas
- backend/utils/time.ts — fixed-rate scheduler
- backend/leaderboard.ts — in-memory leaderboard
- backend/game.ts — simulation (players, tiles, dashes, collisions, round flow)
- backend/server.ts — HTTP + WS, multi-room, loops, broadcasts

Notes:
- Static frontend is optional for backend testing; place files under ./frontend or hit /health to verify uptime.
- Multi-room supported via roomId query param. Capacity enforced per room.