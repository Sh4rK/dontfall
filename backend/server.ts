// dontfall/backend/server.ts
//
// Entry point for the Deno backend. It serves static files from the
// `frontend/` directory, upgrades `/ws` requests to WebSocket, and runs
// the game simulation loop.
//
// The implementation follows the design described in SPEC.md and uses
// the `Game` class defined in `game.ts`.
//
// Note: This file assumes Deno v1.38+ (standard library APIs only).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { Game } from "./game.ts";
import { CONFIG } from "./config.ts";
import type {
  InputMessage,
  ServerMessage,
} from "./types.ts";

// -----------------------------------------------------------------------------
// Global state
// -----------------------------------------------------------------------------

// Single default room (the spec only requires one room).
const room = new Game("default");

// Map each active WebSocket to its player ID.
const socketToPlayer = new Map<WebSocket, string>();

// -----------------------------------------------------------------------------
// Helper utilities
// -----------------------------------------------------------------------------

/**
 * Determine a simple Content-Type header based on file extension.
 */
function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

/**
 * Broadcast a server message to all connected clients.
 */
function broadcast(msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const ws of socketToPlayer.keys()) {
    try {
      ws.send(payload);
    } catch {
      // ignore send errors – the socket will be cleaned up on close.
    }
  }
}

/**
 * Send a welcome packet to a newly connected client.
 */
function sendWelcome(ws: WebSocket, playerId: string) {
  const welcome: ServerMessage = {
    type: "welcome",
    playerId,
    roomId: room.state.id,
    constants: CONFIG,
    mapSeed: room.state.mapSeed,
    mapSize: { width: CONFIG.MAP_WIDTH, height: CONFIG.MAP_HEIGHT },
  };
  ws.send(JSON.stringify(welcome));
}

/**
 * Process a parsed JSON message coming from a client.
 */
function handleClientMessage(ws: WebSocket, data: unknown) {
  if (typeof data !== "object" || data === null) return;
  const msg = data as Record<string, unknown>;
  const type = msg.type as string | undefined;
  const playerId = socketToPlayer.get(ws);
  if (!playerId) return; // should never happen

  switch (type) {
    case "join": {
      const name = (msg.name as string) ?? "";
      const color = (msg.color as string) ?? "#ffffff";
      // Update stored player info.
      const player = room.state.players.get(playerId);
      if (player) {
        player.name = name;
        player.color = color;
      }
      break;
    }
    case "ready": {
      const ready = Boolean(msg.ready);
      const player = room.state.players.get(playerId);
      if (player) player.ready = ready;
      // Let the room know we may need to start the countdown.
      // The Game class checks lobby readiness on each tick.
      break;
    }
    case "input": {
      const input = msg as InputMessage;
      room.enqueueInput(playerId, input);
      break;
    }
    case "pong":
      // No action needed – could be used for latency measurement.
      break;
    default:
      // Unknown message type – ignore.
      break;
  }
}

/**
 * Clean up state when a client disconnects.
 */
function handleDisconnect(ws: WebSocket) {
  const playerId = socketToPlayer.get(ws);
  if (playerId) {
    room.removePlayer(playerId);
    socketToPlayer.delete(ws);
  }
}

// -----------------------------------------------------------------------------
// HTTP request handler
// -----------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  // WebSocket endpoint.
  if (pathname === "/ws") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.onopen = () => {
      // Create a new player for this connection.
      const playerId = crypto.randomUUID();
      socketToPlayer.set(socket, playerId);
      room.addPlayer(playerId, "", "#ffffff");
      sendWelcome(socket, playerId);
    };
    socket.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        handleClientMessage(socket, data);
      } catch (e) {
        console.error("Failed to parse client message:", e);
      }
    };
    socket.onclose = () => handleDisconnect(socket);
    socket.onerror = (e) => {
      console.error("WebSocket error:", e);
      handleDisconnect(socket);
    };
    return response;
  }

  // Serve static assets from ./frontend.
  // Default to index.html for the root path.
  let filePath = pathname === "/" ? "/index.html" : pathname;
  // Prevent directory traversal.
  if (filePath.includes("..")) {
    return new Response("Invalid path", { status: 400 });
  }

  const fullPath = `${Deno.cwd()}/frontend${filePath}`;
  try {
    const file = await Deno.readFile(fullPath);
    return new Response(file, {
      status: 200,
      headers: { "content-type": contentType(filePath) },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// -----------------------------------------------------------------------------
// Game loop
// -----------------------------------------------------------------------------

// Run the simulation at the configured tick rate.
const tickIntervalMs = 1000 / CONFIG.TICK_RATE;
setInterval(() => {
  room.tick();

  // Broadcast the latest state snapshot to all clients.
  const stateMsg = room.getLatestState();
  if (stateMsg) broadcast(stateMsg);
}, tickIntervalMs);

// -----------------------------------------------------------------------------
// Start the HTTP server
// -----------------------------------------------------------------------------

console.log(`Server listening on http://localhost:8000`);
await serve(handler, { port: 8000 });
