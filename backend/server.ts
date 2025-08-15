declare const Deno: any;
// Deno HTTP + WebSocket server for Don't Fall

import {
  CONSTANTS,
  COUNTDOWN_SECONDS,
  HTTP_PORT,
  INPUT_RATE_LIMIT_PER_SEC,
  MAP_HEIGHT,
  MAP_WIDTH,
  STATE_SNAPSHOT_RATE,
  TICK_RATE,
} from "./config.ts";
import { GameRoom } from "./game.ts";
import type { ClientMessage } from "./messages.ts";
import { parseClientMessage } from "./messages.ts";
import type { Player } from "./types.ts";
import { createTickLoop, nowMs } from "./utils/time.ts";

// --------- Static file serving ---------

const FRONTEND_DIR = "frontend";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};

function extname(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i) : "";
}

async function serveStatic(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const diskPath = `${FRONTEND_DIR}${rel}`;

  try {
    const file = await Deno.readFile(diskPath);
    const ext = extname(diskPath).toLowerCase();
    const ct = CONTENT_TYPES[ext] ?? "application/octet-stream";
    return new Response(file, { status: 200, headers: { "content-type": ct } });
  } catch {
    return null;
  }
}

// --------- Room manager ---------

type ClientId = string;

interface ClientConn {
  id: ClientId;
  ws: WebSocket;
  name?: string;
  color?: string;
  joined: boolean;
  inputWindowStart: number; // ms
  inputCount: number;
}

interface RoomContext {
  id: string;
  room: GameRoom;
  clients: Map<ClientId, ClientConn>;
  tickLoopStarted: boolean;
  stateLoopStarted: boolean;
  tickLoop: ReturnType<typeof createTickLoop>;
  stateLoop: ReturnType<typeof createTickLoop>;
  lastRoundState: "lobby" | "countdown" | "inRound" | "roundOver";
}

const rooms = new Map<string, RoomContext>();

function getOrCreateRoom(roomId: string): RoomContext {
  let ctx = rooms.get(roomId);
  if (ctx) return ctx;

  const room = new GameRoom(roomId);
  const ctxNew: RoomContext = {
    id: roomId,
    room,
    clients: new Map(),
    tickLoopStarted: false,
    stateLoopStarted: false,
    tickLoop: createTickLoop(TICK_RATE, ({ now, dt }) => {
      // dt is fixed ms per tick; pass through
      room.tick(now, dt);
      handleRoomTransitions(ctxNew, now);
    }),
    stateLoop: createTickLoop(STATE_SNAPSHOT_RATE, () => {
      broadcastSnapshot(ctxNew);
    }),
    lastRoundState: "lobby",
  };
  rooms.set(roomId, ctxNew);
  return ctxNew;
}

function startLoopsIfNeeded(ctx: RoomContext) {
  if (!ctx.tickLoopStarted) {
    ctx.tickLoop.start();
    ctx.tickLoopStarted = true;
  }
  if (!ctx.stateLoopStarted) {
    ctx.stateLoop.start();
    ctx.stateLoopStarted = true;
  }
}

function stopLoopsIfNeeded(ctx: RoomContext) {
  if (ctx.clients.size === 0) {
    if (ctx.tickLoopStarted) {
      ctx.tickLoop.stop();
      ctx.tickLoopStarted = false;
    }
    if (ctx.stateLoopStarted) {
      ctx.stateLoop.stop();
      ctx.stateLoopStarted = false;
    }
  }
}

function handleRoomTransitions(ctx: RoomContext, now: number) {
  const rs = ctx.room.state.roundState;
  if (ctx.lastRoundState !== rs) {
    // countdown -> inRound: send round_start
    if (ctx.lastRoundState === "countdown" && rs === "inRound") {
      const spawnAssignments = ctx.room.getLastSpawnAssignments();
      const msg = {
        type: "round_start",
        spawnAssignments,
        mapSeed: ctx.room.state.mapSeed,
      } as const;
      broadcast(ctx, msg);
    }

    // inRound -> roundOver: broadcast results + leaderboard, schedule reset to lobby
    if (ctx.lastRoundState === "inRound" && rs === "roundOver") {
      const { placements, winnerId } = ctx.room.computeRoundResults();
      const roundOver = { type: "round_over", placements, winnerId } as const;
      broadcast(ctx, roundOver);

      // Delay leaderboard popup so players can watch the fall animation
      const LEADERBOARD_DELAY_MS = 1500;
      setTimeout(() => {
        const leaderboard = ctx.room.leaderboardSnapshot();
        const lbMsg = { type: "leaderboard", entries: leaderboard } as const;
        broadcast(ctx, lbMsg);
      }, LEADERBOARD_DELAY_MS);

      // Return to lobby after short delay (~5.0s total)
      const RESET_DELAY_MS = 5000;
      setTimeout(() => {
        ctx.room.resetToLobby();
        broadcastLobby(ctx);

        // Auto-start next round if everyone is still ready (no need to re-ready)
        const players = ctx.room.lobbyView();
        const allReady = players.length >= 2 && players.every((p) => p.ready);
        if (allReady) {
          ctx.room.maybeStartCountdown(nowMs());
          broadcastCountdown(ctx);
        }
      }, RESET_DELAY_MS);
    }

    ctx.lastRoundState = rs;
  }
}

function broadcast(ctx: RoomContext, msg: unknown) {
  const data = JSON.stringify(msg);
  for (const c of ctx.clients.values()) {
    try {
      c.ws.send(data);
    } catch {
      // ignore broken connections; close handler will clean up
    }
  }
}

function broadcastLobby(ctx: RoomContext) {
  const players = ctx.room.lobbyView();
  const allReady = players.length >= 2 && players.every((p) => p.ready);
  const msg = {
    type: "lobby_state",
    players,
    minPlayers: 2,
    maxPlayers: CONSTANTS.ROOM_MAX_PLAYERS,
    allReady,
  } as const;
  broadcast(ctx, msg);
}

function broadcastCountdown(ctx: RoomContext) {
  const msg = {
    type: "countdown",
    seconds: COUNTDOWN_SECONDS,
    serverTime: nowMs(),
  } as const;
  broadcast(ctx, msg);
}

function broadcastSnapshot(ctx: RoomContext) {
  const snap = ctx.room.buildSnapshotAndClear();
  const serverTime = nowMs();
  const tick = ctx.room.state.tick;

  // Send per-client to include lastAckSeq hint
  for (const c of ctx.clients.values()) {
    const p = ctx.room.state.players.get(c.id) as Player | undefined;
    const lastAckSeq = p?.lastInputSeq;
    const msg = {
      type: "state",
      tick,
      serverTime,
      players: snap.players,
      tiles: snap.tiles,
      events: snap.events,
      ...(lastAckSeq !== undefined ? { lastAckSeq } : {}),
    } as const;
    try {
      c.ws.send(JSON.stringify(msg));
    } catch {
      // ignore; cleanup on close
    }
  }
}

// --------- WebSocket handling ---------

function upgradeWebSocket(req: Request): Response {
  const { socket, response } = Deno.upgradeWebSocket(req);
  const url = new URL(req.url);
  const roomId = url.searchParams.get("roomId")?.trim() || "default";
  const ctx = getOrCreateRoom(roomId);

  const client: ClientConn = {
    id: crypto.randomUUID(),
    ws: socket,
    joined: false,
    inputWindowStart: nowMs(),
    inputCount: 0,
  };

  ctx.clients.set(client.id, client);

  socket.addEventListener("open", () => {
    // nothing; wait for join
  });

  socket.addEventListener("message", (ev: MessageEvent) => {
    try {
      const raw = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data));
      const msg = parseClientMessage(raw) as ClientMessage;
      handleClientMessage(ctx, client, msg);
    } catch {
      // Ignore invalid messages
    }
  });

  socket.addEventListener("close", () => {
    // If client had joined, remove from room; mid-round elim is handled by GameRoom.removePlayer
    if (client.joined) {
      ctx.room.removePlayer(client.id);
      broadcastLobby(ctx);
    }
    ctx.clients.delete(client.id);
    stopLoopsIfNeeded(ctx);
  });

  // Periodic ping (keep-alive and latency)
  const pingInterval = setInterval(() => {
    try {
      socket.send(JSON.stringify({ type: "ping", ts: nowMs() }));
    } catch {
      // ignore
    }
  }, 5000);

  socket.addEventListener("close", () => clearInterval(pingInterval));

  return response;
}

function handleClientMessage(ctx: RoomContext, client: ClientConn, msg: ClientMessage) {
  const now = nowMs();

  switch (msg.type) {
    case "join": {
      if (client.joined) break;
      client.joined = true;
      client.name = msg.name;
      client.color = msg.color;

      // Enforce capacity
      if (ctx.room.state.players.size >= CONSTANTS.ROOM_MAX_PLAYERS) {
        client.ws.close(1008, "Room full");
        return;
      }

      // Add player to room
      ctx.room.addPlayer(client.id, msg.name, msg.color);

      // Start loops once first player joins
      startLoopsIfNeeded(ctx);

      // Send welcome
      const welcome = {
        type: "welcome",
        playerId: client.id,
        roomId: ctx.id,
        constants: CONSTANTS,
        mapSeed: ctx.room.state.mapSeed,
        mapSize: { width: MAP_WIDTH, height: MAP_HEIGHT },
      } as const;
      client.ws.send(JSON.stringify(welcome));

      // Broadcast lobby
      broadcastLobby(ctx);
      break;
    }

    case "ready": {
      if (!client.joined) break;
      const { allReady } = ctx.room.setReady(client.id, msg.ready);
      broadcastLobby(ctx);
      if (allReady && ctx.room.state.roundState === "lobby") {
        ctx.room.maybeStartCountdown(now);
      }
      if (ctx.room.state.roundState === "countdown") {
        broadcastCountdown(ctx);
      }
      break;
    }

    case "input": {
      if (!client.joined) break;

      // Rate limiting: sliding 1s window
      if (now - client.inputWindowStart >= 1000) {
        client.inputWindowStart = now;
        client.inputCount = 0;
      }
      if (client.inputCount < INPUT_RATE_LIMIT_PER_SEC) {
        client.inputCount++;
        ctx.room.handleInput(client.id, msg.seq, msg.move, msg.dash, now);
      }
      break;
    }

    case "pong": {
      // Echo back to allow client RTT measurement using performance timer
      try {
        client.ws.send(JSON.stringify({ type: "ping", ts: msg.ts }));
      } catch {
        // ignore
      }
      break;
    }
  }
}

// --------- HTTP routes ---------

const serverStart = nowMs();

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    const uptime = nowMs() - serverStart;
    return new Response(JSON.stringify({ ok: true, uptimeMs: uptime }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  if (url.pathname === "/ws" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return upgradeWebSocket(req);
  }

  const staticResp = await serveStatic(req);
  return staticResp ?? new Response("Not Found", { status: 404 });
}

// --------- Start server ---------

Deno.serve({ port: HTTP_PORT }, handleRequest);