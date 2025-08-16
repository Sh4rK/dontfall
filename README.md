# Don't Fall

Real-time, server-authoritative multiplayer arena game. Move across a floating grid of tiles that shake then fall; dash to bump opponents off the map. Last player alive wins. Backend is Deno; frontend is HTML + ES Modules with Three.js. 2–8 players per room, no bundlers required.

## Quickstart

Requirements: Deno (latest stable).

Start the server:

```sh
deno run -A backend/server.ts
```

Then open http://localhost:8000/ in a browser. Optionally pass a room with ?roomId=custom. Health check at /health. WebSocket endpoint at /ws?roomId=.

Controls: Arrow keys to move, Space to dash.

## Backend (brief)

Single-process, server-authoritative simulation that also serves the static frontend.
- HTTP: serves files from [`frontend/`](frontend) with entry at [`frontend/index.html`](frontend/index.html)
- WebSocket: upgrade at GET /ws?roomId= for gameplay
- Health: GET /health
- Loops: fixed tick TICK_RATE for simulation and STATE_SNAPSHOT_RATE for snapshots

Key files:
- [`backend/server.ts`](backend/server.ts)
- [`backend/game.ts`](backend/game.ts)
- [`backend/messages.ts`](backend/messages.ts)
- [`backend/types.ts`](backend/types.ts)
- [`backend/config.ts`](backend/config.ts)
- [`backend/leaderboard.ts`](backend/leaderboard.ts)
- [`backend/utils/time.ts`](backend/utils/time.ts)

See details in [`backend/README.md`](backend/README.md).

## Frontend (brief)

Single-page client using Three.js, ES modules, and light prediction/reconciliation. Connects via WebSocket to the backend.

Key files:
- [`frontend/index.html`](frontend/index.html)
- [`frontend/main.js`](frontend/main.js)
- [`frontend/net.js`](frontend/net.js)
- [`frontend/render.js`](frontend/render.js)
- [`frontend/input.js`](frontend/input.js)
- [`frontend/ui.js`](frontend/ui.js)
- [`frontend/touch.js`](frontend/touch.js)
- [`frontend/constants.js`](frontend/constants.js)

See details in [`frontend/README.md`](frontend/README.md).

## Project structure

- [`backend/`](backend) — HTTP + WebSocket server, simulation, validation, leaderboard
- [`frontend/`](frontend) — HTML + ES modules client
- [`SPEC.md`](SPEC.md) — product and technical specification
- [`README.md`](README.md) — this document

## Development

- Run tests:

```sh
deno test -A backend/game_test.ts
```

- Server constants live in [`backend/config.ts`](backend/config.ts) and are mirrored client-side in [`frontend/constants.js`](frontend/constants.js). The server remains authoritative.
- Edit frontend files and refresh the page; no build step needed.
