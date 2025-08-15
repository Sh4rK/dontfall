# Don't Fall — Product Specification

Version: 1.0
Target stack: Deno backend, HTML + ES Modules frontend (Three.js)
Multiplayer: 2–8 players per room

## Summary

Don’t Fall is a real-time, server-authoritative multiplayer arena game. Players move around a floating grid of tiles from an almost top-down 3D camera. Stepping on a tile causes it to shake and then fall after a delay. Use movement and a dash to jostle opponents so they fall. The last player alive wins. Rounds repeat with an in-memory leaderboard that counts wins and placements.

## Goals

- Smooth real-time multiplayer with minimal setup, no bundlers.
- Clear, readable code using ES modules and Three.js.
- Authoritative server with simple client prediction.
- Configuration via named constants: map size, physics, timings, etc.

## Non-goals

- Photorealistic visuals or complex physics.
- Cross-region matchmaking and sharding.
- Mobile touch support (deferred).
- Persistent storage (leaderboard is in-memory only).

## Platforms & Tech

- Backend: Deno (HTTP + WebSocket using Deno.serve and Deno.upgradeWebSocket), single-process, in-memory room.
- Frontend: Single HTML file + ES modules, no bundlers; Three.js for 3D rendering.
- Networking: WebSocket JSON messages; server-authoritative simulation with light client prediction and interpolation.

## Game Design

### Camera & Presentation
- Perspective camera at a fixed, almost top-down angle (~60° tilt) with slight offset. No player-controlled camera.
- Simple pastel palette with basic ambient + directional lighting.
- The local player’s capsule is marked with a red, downward-pointing 3D arrow in lobby and for the first ~1–2 seconds of each round.

### Map & Tiles
- A rectangular grid of tiles (initial default 15x15), floating in sky.
- All tiles are present at the start; no random holes or mixed tile types.
- Tile states: solid → shaking → fallen.
- When a tile is stepped on the first time, it becomes shaking and is scheduled to fall after TILE_FALL_DELAY_MS (default 3000 ms). This delay is a named constant.
- Shaking tiles visually jitter; falling tiles drop out of the scene over ~0.5–1.0s and then disappear.

### Players
- Up to 8 players per room.
- Each player is represented as a simple colored capsule (or capsule-like composite). Colors are selected from a pastel palette; duplicates allowed if necessary.
- Players start at unique spawn tiles on the outer perimeter of the grid, spaced evenly.

### Movement & Dash
- Arrow keys move the player on the plane; velocity integrates with acceleration and friction.
- Space triggers a dash if off cooldown:
  - Dash applies a forward impulse in the current/last movement direction for a short duration.
  - When dashing into other players, they receive a pushback impulse.
  - Dash has a cooldown; UI shows cooldown state.

### Death & Victory
- If a player has no supporting solid tile under their feet center (e.g., standing on a tile that just fell), they fall and die immediately.
- Last player alive wins the round. If simultaneous eliminations occur leaving no players, the round can end in a draw.

### Round Flow & States
- Lobby: Players connect, enter a name, pick a color (optional), and mark themselves Ready. Manual ready from all is required; countdown starts only when all connected players are ready and there are at least 2 players.
- Countdown: 3-second countdown visible to all; movement locked.
- InRound: Movement, collisions, dashes, tile shaking/falling; server simulates at fixed tick rate.
- RoundOver: Broadcast placements and winner; show leaderboard; after short delay, return to Lobby and reset ready state.

## Configuration (Named Constants)

All named constants are centralized to make the game easily tunable. Defaults shown here; adjust as needed.

- Room and map:
  - ROOM_MAX_PLAYERS = 8
  - MAP_WIDTH = 15
  - MAP_HEIGHT = 15
  - TILE_SIZE = 1.0
  - SPAWN_PERIMETER_ONLY = true
- Timing and tick rates:
  - TICK_RATE = 30 (server simulation ticks/sec)
  - STATE_SNAPSHOT_RATE = 10 (server sends state updates/sec)
  - COUNTDOWN_SECONDS = 3
  - TILE_FALL_DELAY_MS = 3000
  - INTERP_BUFFER_MS = 100 (client interpolation buffer)
- Player physics:
  - PLAYER_MOVE_SPEED = 5.0 (units/sec target)
  - PLAYER_ACCEL = 30.0
  - PLAYER_FRICTION = 10.0
  - PLAYER_RADIUS = 0.35
  - PLAYER_HEIGHT = 1.2
- Dash tuning:
  - DASH_IMPULSE = 10.0 (or DASH_SPEED = 12.0 peak)
  - DASH_DURATION_MS = 180
  - DASH_COOLDOWN_MS = 2000
  - DASH_PUSHBACK_IMPULSE = 6.0
- Visual tuning:
  - TILE_SHAKE_AMPLITUDE = 0.05
  - TILE_SHAKE_FREQUENCY_HZ = 10
  - ARROW_MARKER_DURATION_MS = 1500

These constants are mirrored client-side for prediction and visuals; the server remains authoritative.

## Networking & Synchronization

### Model
- Server authoritative. Clients send inputs; server simulates and periodically broadcasts state snapshots and event deltas (tile shakes/falls, deaths).
- Client predicts its own motion and reconciles upon server updates; remote players are interpolated.

### Message Types (JSON over WebSocket)

Client → Server
- join: { type: "join", name: string, color?: string }
- ready: { type: "ready", ready: boolean } (toggle in Lobby)
- input: { type: "input", seq: number, ts: number, move: { x: -1..1, y: -1..1 }, dash: boolean }
- pong: { type: "pong", ts: number }

Server → Client
- welcome: { type: "welcome", playerId, roomId, constants, mapSeed, mapSize }
- lobby_state: { type: "lobby_state", players: [{ id, name, color, ready }], minPlayers: number, maxPlayers: number, allReady: boolean }
- countdown: { type: "countdown", seconds: number, serverTime: number }
- round_start: { type: "round_start", spawnAssignments: [{ id, tx, ty }], mapSeed }
- state: { type: "state", tick: number, serverTime: number, players: [{ id, pos: {x,y}, vel: {x,y}, dashActive: boolean, alive: boolean }], tiles: [partial updates], events: [{ kind, ... }] }
  - events include: tile_shake { idx }, tile_fall { idx }, death { playerId }
- round_over: { type: "round_over", placements: [{ id, place }], winnerId?: string }
- leaderboard: { type: "leaderboard", entries: [{ id, name, wins, games, totalPlace, avgPlace }] }
- ping: { type: "ping", ts: number }

### Ticks and Rates
- Server simulates at TICK_RATE, processes inputs, updates physics and tile timers, and applies eliminations.
- Snapshots sent at STATE_SNAPSHOT_RATE. Tiles are sent as deltas (only changed indices).

### Latency Handling
- Client maintains a time offset from serverTime for countdowns and UI timers.
- Local prediction with input sequence numbers; upon receiving authoritative state with lastAckSeq, client rewinds/unwinds any unconfirmed inputs.
- Remote players interpolated with INTERP_BUFFER_MS delay.

### Disconnections & Rejoin Policy
- If a player disconnects mid-round, they are eliminated (placement recorded). Reconnection mid-round is not supported.
- Players can reconnect between rounds (in Lobby). Names can be reused; player identity is per connection.

## Backend (Deno) Design

### HTTP & WebSocket
- Deno.serve static files from frontend/.
- GET /ws upgrades to WebSocket for gameplay.
- Optional GET /health for basic uptime checks.

### Rooms
- Single default room with capacity ROOM_MAX_PLAYERS.
- Optional future support for roomId query parameter to create/join separate rooms.

### Game Loop
- Drift-compensated timer to achieve TICK_RATE.
- State includes: players map, tiles array, timers, round state, leaderboard, tick number, map seed, countdown deadlines.

### Leaderboard & Persistence
- Leaderboard stored in memory only (wins, games, totalPlace, avgPlace = totalPlace / games).
- Reset on server restart. Optional future: write JSON to disk.

### Security & Validation
- Reject client-provided positions; only accept inputs.
- Input rate limiting (e.g., 60 per second per client).
- Name validation: trim length (1–20), disallow control chars; optional profanity filter.

## Frontend (HTML + ES Modules + Three.js)

### Rendering
- Three.js scene with:
  - PerspectiveCamera (fixed tilt), OrbitControls not required.
  - AmbientLight + DirectionalLight.
  - Tiles rendered via InstancedMesh for performance.
  - Players as CapsuleGeometry or composite; MeshStandardMaterial with pastel colors.
  - Local player indicator: downward red ConeGeometry hovering above; fades after ARROW_MARKER_DURATION_MS.
  - Simple sky gradient background.

### Input & UX
- Name entry prompt or form on connect; store and send via join.
- Color selection: small palette (pastel) with fallback auto-assign.
- Keys:
  - Arrow keys: movement vector.
  - Space: dash on keydown; send dash: true once per press.
- HUD:
  - Countdown text during countdown.
  - Player list with alive/dead and ready status.
  - Dash cooldown bar at bottom-center.
  - Ping and FPS display.
  - Leaderboard modal after round with wins and placements.
  - Ready button in Lobby (toggles ready state; shows allReady status).

### Client State & Animation
- Maintain local cache of server state and apply snapshots.
- Predict local movement; reconcile using seq.
- Animate tile shake via sine jitter; tile fall via downward translation over short duration before hiding.

## Data Models (Server-side)

- Player: { id, name, color, pos: {x, y}, vel: {x, y}, alive: boolean, dashCooldownUntil: number, dashUntil: number, lastInputSeq: number, ready: boolean }
- Tile: { idx, state: "solid" | "shaking" | "fallen", shakeStartMs?: number, fallAtMs?: number }
- RoomState: {
  id, players: Map<playerId, Player>,
  tiles: Tile[], roundState: "lobby" | "countdown" | "inRound" | "roundOver",
  leaderboard: Map<playerId, { wins: number, games: number, totalPlace: number }>,
  tick: number, mapSeed: number, countdownEndAt?: number
}

## Spawn, Tile, and Collision Logic

- Spawns:
  - Compute list of perimeter tiles; choose N distinct positions spaced evenly.
  - Reset players to spawn positions at round start with zero velocity; alive = true.
- Tile stepping:
  - On each tick, map player position to tile index (tx, ty) = floor((pos + halfSize) / TILE_SIZE).
  - If tile state is solid and it is the first time stepped on, set shaking and schedule fallAtMs = now + TILE_FALL_DELAY_MS.
- Tile falling:
  - When time ≥ fallAtMs, mark tile fallen and enqueue tile_fall event.
  - Immediately check all players: if feet center is within the fallen tile bounds and no other solid tile supports them, set alive = false and emit death event.
- Player–player:
  - Resolve overlaps minimally as circle-circle separation.
  - During dash, apply DASH_PUSHBACK_IMPULSE to other players on overlap; reduce dasher friction.

## File & Directory Structure (no bundlers)

- backend/
  - server.ts (HTTP static host, WS endpoint, room lifecycle)
  - game.ts (simulation: players, tiles, collisions, round flow)
  - messages.ts (schemas and validation helpers)
  - leaderboard.ts (in-memory aggregation)
  - utils/time.ts (tick scheduler, time math)
  - config.ts (all named constants)
  - types.ts (shared TS types for server)
- frontend/
  - index.html (canvas + minimal UI)
  - main.js (bootstrap, connect WS, orchestrate modules)
  - net.js (WebSocket client, prediction/reconciliation glue)
  - render.js (Three.js scene setup and animation)
  - input.js (keyboard handling)
  - ui.js (HUD, modals, ready/leaderboard)
  - constants.js (client mirror of select constants)
  - three.module.js (or CDN import)
- data/
  - (empty; no persistence required)
- README.md
- SPEC.md (this document)

## State Transitions

- Lobby → Countdown:
  - Preconditions: playersInRoom ≥ 2 and all players ready.
  - Action: broadcast countdown with serverTime sync; lock inputs (or ignore movement).
- Countdown → InRound:
  - After COUNTDOWN_SECONDS, assign spawns, reset players/tiles, begin simulation.
- InRound → RoundOver:
  - When alive count ≤ 1. Compute placements; update leaderboard.
- RoundOver → Lobby:
  - After short delay (e.g., 3–5 seconds), return to Lobby; clear ready flags; wait for allReady again.

## Leaderboard

- Tracks per-player: wins, games played, totalPlace, avgPlace (derived).
- Updates at round end. Display in post-round modal and a compact lobby view.
- In-memory only; resets on server restart.

## Performance Targets

- Graphics: Up to 8 players and 15x15 tiles should run smoothly on mid-tier laptops using InstancedMesh.
- Network: Keep typical snapshot payloads under 2–5 KB at STATE_SNAPSHOT_RATE = 10 with deltas.
- CPU: O(n^2) player collision is fine for n ≤ 8; tile checks O(1) via index mapping.

## Testing Plan

- Unit tests (server):
  - Tile shake/fall timing; death on fall; boundary off-grid death.
  - Dash cooldown and pushback effects.
- Integration:
  - Two clients with simulated latency/jitter; validate reconciliation, countdown sync.
- Load:
  - Simulate 8 clients with scripted inputs.

## Risks & Mitigations

- Latency jitter: Use interpolation buffers and server time sync.
- Cheating: Ignore client positions; rate-limit inputs.
- Timer drift: Use monotonic server time; drift-compensated tick loop.

## Visual Style

- Basic ambient + directional lighting.
- Selectable pastel color palette for player capsules (example palette names only; exact hex values to be curated):
  - Pastel Blue, Pastel Green, Pastel Pink, Pastel Yellow, Pastel Purple, Pastel Orange, Mint, Peach.
- Avoid harsh contrasts; keep materials matte.

## User Flow

1. Open game URL; index.html loads and prompts for player name and (optional) color from pastel palette.
2. Client connects to /ws and sends join with name/color.
3. Lobby screen shows connected players and a Ready toggle.
4. When all connected players are Ready (and ≥ 2 players), server starts 3-second countdown.
5. Round starts; local player shows red arrow briefly; movement and dash enabled.
6. Tiles shake and fall on first steps; players pushed by dash; eliminations occur.
7. Round ends when ≤ 1 alive; show leaderboard with wins and placements.
8. Transition back to Lobby; players Ready up for next round.

## Future Enhancements (Optional)

- Spectator mode for eliminated players.
- WASD controls and gamepad support.
- Simple SFX for shake, fall, dash, death, win.
- Cosmetic customization and name/color validation improvements.
- Multi-room support with room browsing/creation.
