// surewhynot-site/social-studio/server/src/index.js

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import toolsRoutes from "./routes/tools.js";

/* ========================
   Paths
======================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use("/social-studio", toolsRoutes);


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

app.use(toolsRoutes);

app.use(express.static(PUBLIC_DIR));

const server = createServer(app);

// WS path matches your client
const wss = new WebSocketServer({ server, path: "/social-studio/ws" });

const PORT = process.env.PORT || 8787;

/* ========================
   In-memory state
======================== */

const PRESENCE_MS = 2 * 60 * 1000; // 2 minutes online window
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

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function safeRoom(room) {
  const r = String(room || "lobby").trim().slice(0, 32);
  return r || "lobby";
}

function safeName(name) {
  const n = String(name || "").trim().slice(0, 32);
  return n;
}

function ensureXpFields(u) {
  if (typeof u.xpTotal !== "number") u.xpTotal = 0;
  if (typeof u.dailyXp !== "number") u.dailyXp = 0;
  if (typeof u.lastLoginDay !== "string") u.lastLoginDay = null;
  if (typeof u.solvedDay !== "string") u.solvedDay = null;
  return u;
}

function applyDailyLoginBonus(u) {
  const today = dayKey();
  if (u.lastLoginDay !== today) {
    u.lastLoginDay = today;
    u.dailyXp = 0;
    u.xpTotal += 10;
    u.dailyXp += 10;
  }
  return u;
}

function getUser(uuid) {
  if (!users.has(uuid)) {
    users.set(uuid, {
      uuid,
      displayName: `guest-${uuid.slice(0, 6)}`,
      room: "lobby",
      lastSeenAt: 0,
      createdAt: Date.now(),
      xpTotal: 0,
      dailyXp: 0,
      lastLoginDay: null,
      solvedDay: null,
    });
    schedulePersist();
  }
  const u = users.get(uuid);
  ensureXpFields(u);
  return u;
}

function markSeen(uuid) {
  const u = getUser(uuid);
  u.lastSeenAt = Date.now();
  applyDailyLoginBonus(u);
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
    if ((u.lastSeenAt || 0) < cutoff) return false;
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
   Daily Puzzle (minimal)
======================== */

function pickDailyAnswer(k) {
  const words = ["ORBIT", "LASER", "CLOUD", "STACK", "TOKEN", "ROUTE", "CRYPT"];
  let h = 0;
  for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return words[h % words.length];
}

function scrambleWord(word, k) {
  let h = 0;
  for (const ch of k) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  const arr = word.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const j = h % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

function todayPuzzle() {
  const today = dayKey();
  const answer = pickDailyAnswer(today);
  return {
    day: today,
    type: "scramble",
    scramble: scrambleWord(answer, today),
    hint: `${answer.length} letters`,
  };
}

/* ========================
   Static client route
======================== */

// Your client file is at: public/social-studio/client/index.html
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

/* Auth bootstrap */
app.post("/social-studio/api/auth/anonymous", (req, res) => {
  const incoming = String(req.body?.uuid || "").trim();
  const uuid = incoming || randomUUID();
  const user = markSeen(uuid);

  const displayName = safeName(req.body?.displayName);
  if (displayName) user.displayName = displayName;

  if (req.body?.room) user.room = safeRoom(req.body.room);

  schedulePersist();
  res.json({ ok: true, user });
});

/* Presence heartbeat */
app.post("/social-studio/api/presence/heartbeat", (req, res) => {
  const user = authFromReq(req);
  if (req.body?.room) user.room = safeRoom(req.body.room);
  schedulePersist();
  res.json({
    ok: true,
    lastSeenAt: user.lastSeenAt,
    room: user.room,
    xpTotal: user.xpTotal,
    dailyXp: user.dailyXp,
    lastLoginDay: user.lastLoginDay,
  });
});

/* Set display name */
app.post("/social-studio/api/auth/display-name", (req, res) => {
  const user = authFromReq(req);
  const displayName = safeName(req.body?.displayName);
  if (!displayName) return res.status(400).json({ error: "displayName is required" });

  user.displayName = displayName;
  schedulePersist();
  res.json({
    ok: true,
    uuid: user.uuid,
    displayName: user.displayName,
    room: user.room,
    xpTotal: user.xpTotal,
    dailyXp: user.dailyXp,
    lastLoginDay: user.lastLoginDay,
  });
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

  user.room = safeRoom(req.body?.room || user.room);

  const text = String(req.body?.message || "").trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: "message is required" });

  user.xpTotal += 1;
  user.dailyXp += 1;

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
  broadcast("chat:new", msg, msg.room);

  res.json({ ok: true, message: msg, user });
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

  const online = onlineUsers(room).map((u) => {
    ensureXpFields(u);
    return {
      uuid: u.uuid,
      displayName: u.displayName,
      room: u.room,
      lastSeenAt: u.lastSeenAt,
      xpTotal: u.xpTotal,
      dailyXp: u.dailyXp,
    };
  });

  res.json({ room, onlineCount: online.length, users: online });
});

/* Leaderboards */
app.get("/social-studio/api/leaderboard/daily", (_req, res) => {
  const rows = [...users.values()]
    .map((u) => ensureXpFields(u))
    .sort((a, b) => (b.dailyXp || 0) - (a.dailyXp || 0))
    .slice(0, 50)
    .map((u) => ({ uuid: u.uuid, displayName: u.displayName, dailyXp: u.dailyXp || 0 }));

  res.json({ ok: true, day: dayKey(), rows });
});

app.get("/social-studio/api/leaderboard/global", (_req, res) => {
  const rows = [...users.values()]
    .map((u) => ensureXpFields(u))
    .sort((a, b) => (b.xpTotal || 0) - (a.xpTotal || 0))
    .slice(0, 50)
    .map((u) => ({ uuid: u.uuid, displayName: u.displayName, xpTotal: u.xpTotal || 0 }));

  res.json({ ok: true, rows });
});

/* Puzzle */
app.get("/social-studio/api/puzzle/today", (_req, res) => {
  res.json({ ok: true, puzzle: todayPuzzle() });
});

app.get("/social-studio/api/puzzle/state", (req, res) => {
  const user = authFromReq(req);
  const today = dayKey();
  res.json({ ok: true, day: today, solved: user.solvedDay === today });
});

app.post("/social-studio/api/puzzle/submit", (req, res) => {
  const user = authFromReq(req);
  const today = dayKey();

  if (user.solvedDay === today) {
    return res.json({ ok: true, solved: true, already: true, awardXp: 0, user });
  }

  const guess = String(req.body?.guess || "").trim().toUpperCase();
  const answer = pickDailyAnswer(today);

  if (guess === answer) {
    user.solvedDay = today;
    user.xpTotal += 5;
    user.dailyXp += 5;
    schedulePersist();
    return res.json({ ok: true, solved: true, already: false, awardXp: 5, user });
  }

  res.json({ ok: true, solved: false, user });
});

/* Stubs (stop 404s) */
app.get("/social-studio/api/music/current", (_req, res) => {
  res.json({ ok: true, track: null });
});

app.get("/social-studio/api/subscription/stripe-placeholder", (_req, res) => {
  res.json({ ok: true, status: "placeholder" });
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

    if (data?.type === "heartbeat") {
      markSeen(uuid);
      return;
    }

    if (data?.type === "chat:join") {
      const nextRoom = safeRoom(data.room);
      user.room = nextRoom;
      wsMeta.set(ws, { uuid, room: nextRoom });
      markSeen(uuid);
      schedulePersist();
      ws.send(JSON.stringify({ type: "chat:joined", payload: { room: nextRoom }, ts: Date.now() }));
      return;
    }

    if (data?.type === "chat:send") {
      const text = String(data.message || "").trim().slice(0, 1000);
      if (!text) return;

      const room = safeRoom(data.room || user.room);

      markSeen(uuid);
      user.xpTotal += 1;
      user.dailyXp += 1;

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