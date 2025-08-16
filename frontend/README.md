# Don't Fall — Frontend

Single-page client built with HTML + ES modules and Three.js. Handles input, lightweight prediction/reconciliation, interpolation, rendering, and UI. Connects to the Deno backend via WebSocket.

- Entry: [`frontend/index.html`](index.html)
- Bootstrap: [`frontend/main.js`](main.js)
- Networking: [`frontend/net.js`](net.js)
- Rendering: [`frontend/render.js`](render.js)
- Input: [`frontend/input.js`](input.js), Touch: [`frontend/touch.js`](touch.js)
- UI/HUD: [`frontend/ui.js`](ui.js)
- Client constants mirror: [`frontend/constants.js`](constants.js)

## Run

- Start the backend server (serves this frontend):
  ```sh
  deno run -A backend/server.ts
  ```
- Open http://localhost:8000/
- Optional room: http://localhost:8000/?roomId=custom

## Controls

- Keyboard: Arrow keys to move, Space to dash
- Touch (mobile/coarse pointer): On-screen joystick + dash button

## How it works (brief)

- WebSocket messages per [`SPEC.md`](../SPEC.md)
- Local player uses light prediction with input sequencing; server acks via lastAckSeq
- Remote players are interpolated with a small buffer for smoothness
- Tiles animate shake/fall from server events and deltas
- Three.js scene renders players (capsules), tiles (instanced), simple lighting, sky

## Development

- Edit files in place; refresh page (no build step)
- Constants mirrored from server live in [`frontend/constants.js`](constants.js); server remains authoritative