// surewhynot-site/social-studio/server/src/index.js

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

/* ========================
   Paths
======================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serves: server/public/... (your client lives at public/social-studio/client/index.html)
const PUBLIC_DIR = path.join(__dirname, "../public");

// Optional: simple persistence (keeps chat/users after restart)
const STATE_FILE = path.join(__dirname, "../data/state.json");

/* ========================
   App / Server
======================== */

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(PUBLIC_DIR));

const server = createServer(app);

// IMPORTANT: WS path matches your client (/social-studio/ws)
const wss = new WebSocketServer({ server, path: "/social-studio/ws" });

const PORT = process.env.PORT || 8787;

/* ========================
   In-memory state
======================== */

const PRESENCE_MS = 10 * 60 * 1000; // 10 minutes "online window" (for /presence list)
const MESSAGE_HISTORY_LIMIT = 300;

const users = new Map(); // uuid -> user
const messages = []; // {id, uuid, displayName, message, room, createdAt}
const wsMeta = new Map(); // ws -> { uuid, room }
const wsByUuid = new Map(); // uuid -> ws

/* ========================
   Persistence (optional)
======================== */

function ensureStateDir() {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function serializeState() {
  return {
    users: [...users.values()],
    messages,
  };
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const state = JSON.parse(raw);

    for (const u of state.users || []) users.set(u.uuid, u);
    for (const m of state.messages || []) messages.push(m);
  } catch (err) {
    console.warn("Failed loading state:", err.message);
  }
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      ensureStateDir();
      fs.writeFileSync(STATE_FILE, JSON.stringify(serializeState(), null, 2));
    } catch (err) {
      console.warn("Failed writing state:", err.message);
    }
  }, 250);
}

/* ========================
   Helpers
======================== */

function safeRoom(room) {
  const r = String(room || "lobby").trim().slice(0, 32);
  return r || "lobby";
}

function safeName(name) {
  const n = String(name || "").trim().slice(0, 32);
  return n;
}

function getUser(uuid) {
  if (!users.has(uuid)) {
    users.set(uuid, {
      uuid,
      displayName: `guest-${uuid.slice(0, 6)}`,
      room: "lobby",
      lastSeenAt: 0,
      createdAt: Date.now(),
    });
    schedulePersist();
  }
  return users.get(uuid);
}

function markSeen(uuid) {
  const u = getUser(uuid);
  u.lastSeenAt = Date.now();
  schedulePersist();
  return u;
}

function authFromReq(req) {
  const headerUuid = req.header("x-user-id");
  const bodyUuid = req.body?.uuid;
  const uuid = String(headerUuid || bodyUuid || "").trim() || randomUUID();
  const user = markSeen(uuid);
  return user;
}

function onlineUsers(room = null) {
  const cutoff = Date.now() - PRESENCE_MS;
  return [...users.values()].filter((u) => {
    if (u.lastSeenAt < cutoff) return false;
    if (room && (u.room || "lobby") !== room) return false;
    return true;
  });
}

/* ROOM-AWARE broadcast */
function broadcast(type, payload, room = null) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });

  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;

    if (room) {
      const meta = wsMeta.get(ws);
      if (!meta || meta.room !== room) continue;
    }

    ws.send(msg);
  }
}

/* ========================
   Static client route
======================== */

// Your client file is at: public/social-studio/client/index.html
// This makes /social-studio/client/ load it reliably even if static indexing is weird.
app.get("/social-studio/client/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "social-studio/client/index.html"));
});

/* ========================
   API routes (prefixed)
======================== */

app.get("/social-studio/api/health", (_req, res) => {
  res.json({
    ok: true,
    users: users.size,
    messages: messages.length,
    online: onlineUsers().length,
  });
});

/* Presence heartbeat (client calls this every 5 minutes) */
app.post("/social-studio/api/presence/heartbeat", (req, res) => {
  const user = authFromReq(req);
  if (req.body?.room) user.room = safeRoom(req.body.room);
  schedulePersist();
  res.json({ ok: true, lastSeenAt: user.lastSeenAt, room: user.room });
});

/* Set display name */
app.post("/social-studio/api/auth/display-name", (req, res) => {
  const user = authFromReq(req);
  const displayName = safeName(req.body?.displayName);
  if (!displayName) return res.status(400).json({ error: "displayName is required" });

  user.displayName = displayName;
  schedulePersist();
  res.json({ ok: true, uuid: user.uuid, displayName: user.displayName, room: user.room });
});

/* Set room */
app.post("/social-studio/api/chat/room", (req, res) => {
  const user = authFromReq(req);
  user.room = safeRoom(req.body?.room);
  schedulePersist();
  res.json({ ok: true, room: user.room });
});

/* Send message (ROOM ISOLATED) */
app.post("/social-studio/api/chat/send", (req, res) => {
  const user = authFromReq(req);

  // room can come from body OR user.room
  user.room = safeRoom(req.body?.room || user.room);

  const text = String(req.body?.message || "").trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: "message is required" });

  const msg = {
    id: randomUUID(),
    uuid: user.uuid,
    displayName: user.displayName,
    message: text,
    room: user.room,
    createdAt: Date.now(),
  };

  messages.push(msg);
  if (messages.length > MESSAGE_HISTORY_LIMIT) messages.shift();

  schedulePersist();

  // ✅ broadcast ONLY to that room
  broadcast("chat:new", msg, msg.room);

  res.json({ ok: true, message: msg });
});

/* History (ROOM FILTERED) */
app.get("/social-studio/api/chat/history", (req, res) => {
  const user = authFromReq(req);
  const room = safeRoom(req.query.room || user.room || "lobby");

  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const roomMessages = messages.filter((m) => m.room === room).slice(-limit);

  res.json({ room, messages: roomMessages });
});

/* Presence list (ROOM FILTERED) */
app.get("/social-studio/api/chat/presence", (req, res) => {
  const user = authFromReq(req);
  const room = safeRoom(req.query.room || user.room || "lobby");
  const online = onlineUsers(room).map((u) => ({
    uuid: u.uuid,
    displayName: u.displayName,
    room: u.room,
    lastSeenAt: u.lastSeenAt,
  }));

  res.json({ room, onlineCount: online.length, users: online });
});

/* ========================
   WebSocket (ROOM ISOLATED)
======================== */

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const uuid = String(url.searchParams.get("uuid") || "").trim() || randomUUID();
  const requestedRoom = safeRoom(url.searchParams.get("room") || "lobby");

  const user = getUser(uuid);
  user.room = requestedRoom;
  markSeen(uuid);

  // ✅ store uuid AND room so broadcast filtering works
  wsMeta.set(ws, { uuid, room: user.room });
  wsByUuid.set(uuid, ws);

  ws.send(JSON.stringify({ type: "hello", payload: user, ts: Date.now() }));

  ws.on("message", (raw) => {
    let data = null;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }

    // optional heartbeat message from ws client
    if (data?.type === "heartbeat") {
      markSeen(uuid);
      return;
    }

    // allow room switches over WS
    if (data?.type === "chat:join") {
      const nextRoom = safeRoom(data.room);
      user.room = nextRoom;
      wsMeta.set(ws, { uuid, room: nextRoom });
      schedulePersist();
      ws.send(JSON.stringify({ type: "chat:joined", payload: { room: nextRoom }, ts: Date.now() }));
      return;
    }

    // send message over WS (ROOM ISOLATED)
    if (data?.type === "chat:send") {
      const text = String(data.message || "").trim().slice(0, 1000);
      if (!text) return;

      const room = safeRoom(data.room || user.room);

      const msg = {
        id: randomUUID(),
        uuid: user.uuid,
        displayName: user.displayName,
        message: text,
        room,
        createdAt: Date.now(),
      };

      messages.push(msg);
      if (messages.length > MESSAGE_HISTORY_LIMIT) messages.shift();

      schedulePersist();

      // ✅ broadcast ONLY to that room
      broadcast("chat:new", msg, room);
    }
  });

  ws.on("close", () => {
    wsMeta.delete(ws);
    wsByUuid.delete(uuid);
  });
});

/* ========================
   Boot
======================== */

loadState();

server.listen(PORT, () => {
  console.log(`Social Studio server listening on http://localhost:${PORT}`);
});
