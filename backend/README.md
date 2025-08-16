# Don't Fall — Backend

Deno HTTP + WebSocket server providing the authoritative game simulation. Also serves the static frontend.

- Port: 8000 (see [`backend/config.ts`](config.ts))
- Static files: served from [`frontend/`](../frontend) with entry [`frontend/index.html`](../frontend/index.html)
- WebSocket: `GET /ws?roomId=<id>` (defaults to "default")
- Health: `GET /health`

## Run

Requirements: Deno (latest stable)

```sh
deno run -A backend/server.ts
```

Open http://localhost:8000/

## Endpoints

- `GET /` → static frontend
- `GET /health` → `{ ok: true, uptimeMs }`
- `GET /ws?roomId=<id>` with `Upgrade: websocket` → gameplay socket

## Protocol (summary)

Client → Server:
- `join`, `ready`, `input`, `pong`

Server → Client:
- `welcome`, `lobby_state`, `countdown`, `round_start`, `state`, `round_over`, `leaderboard`, `ping`

See the full message schemas in [`backend/messages.ts`](messages.ts) and the complete description in [`SPEC.md`](../SPEC.md).

## Simulation

- Authoritative fixed-tick loop at `TICK_RATE`; state snapshots at `STATE_SNAPSHOT_RATE`
- Lobby → Countdown → InRound → RoundOver → back to Lobby
- Random tile shaking plus shake→fall delays; dash with cooldown and pushback
- Named constants are centralized in [`backend/config.ts`](config.ts) and mirrored for the client in [`frontend/constants.js`](../frontend/constants.js)

## Rooms

- Default room id: `default`
- Multi-room is supported via `?roomId=` query parameter
- Capacity enforced per room

## Development

- Tests:
  ```sh
  deno test -A backend/game_test.ts
  ```
- Key modules:
  - [`backend/server.ts`](server.ts) — HTTP + WS, room manager, loops
  - [`backend/game.ts`](game.ts) — simulation (players, tiles, dashes, collisions, round flow)
  - [`backend/messages.ts`](messages.ts) — Zod schemas and validation
  - [`backend/types.ts`](types.ts) — core types
  - [`backend/leaderboard.ts`](leaderboard.ts) — in-memory leaderboard
  - [`backend/utils/time.ts`](utils/time.ts) — tick scheduler utilities
  - [`backend/config.ts`](config.ts) — named constants

## Reference

- Product and technical spec: [`SPEC.md`](../SPEC.md)