import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = process.env.PORT || 8787;
const PRESENCE_MS = 2 * 60 * 1000;
const MESSAGE_HISTORY_LIMIT = 300;
const STATE_FILE = path.join(__dirname, "../data/state.json");
const FREE_LIMITS = {
  fileSizeBytes: 5 * 1024 * 1024,
  expiryHours: 24,
  dailyUsage: 10,
  privateRooms: false,
  themes: ["midnight"],
};
const PREMIUM_LIMITS = {
  fileSizeBytes: 100 * 1024 * 1024,
  expiryHours: 168,
  dailyUsage: 200,
  privateRooms: true,
  themes: ["midnight", "sunset", "forest", "violet"],
};

const users = new Map();
const messages = [];
const wsMeta = new Map(); // ws => { uuid, room }
const wsByUuid = new Map();
const toolsUsage = new Map();
const dailyLogins = new Set();

function nowDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDirForState() {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function serializeState() {
  return {
    users: [...users.values()],
    messages,
    toolsUsage: [...toolsUsage.entries()],
    dailyLogins: [...dailyLogins],
  };
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const state = JSON.parse(raw);

    for (const u of state.users || []) users.set(u.uuid, u);
    for (const m of state.messages || []) messages.push(m);
    for (const [k, v] of state.toolsUsage || []) toolsUsage.set(k, v);
    for (const k of state.dailyLogins || []) dailyLogins.add(k);
  } catch (err) {
    console.warn("Failed loading persisted state:", err.message);
  }
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      ensureDirForState();
      fs.writeFileSync(STATE_FILE, JSON.stringify(serializeState(), null, 2));
    } catch (err) {
      console.warn("Failed writing state:", err.message);
    }
  }, 250);
}

function getUser(uuid) {
  if (!users.has(uuid)) {
    users.set(uuid, {
      uuid,
      displayName: `guest-${uuid.slice(0, 6)}`,
      premium: false,
      xpTotal: 0,
      dailyXp: {},
      theme: "midnight",
      room: "lobby",
      lastSeenAt: 0,
      puzzleSolvedDay: null,
      createdAt: Date.now(),
    });
    schedulePersist();
  }
  return users.get(uuid);
}

function roomForUser(user, requestedRoom) {
  const room = String(requestedRoom || user.room || "lobby").trim().slice(0, 32) || "lobby";
  if (room.startsWith("private-") && !user.premium) return "lobby";
  return room;
}

function addXp(uuid, amount) {
  const user = getUser(uuid);
  const day = nowDayKey();
  user.xpTotal += amount;
  user.dailyXp[day] = (user.dailyXp[day] || 0) + amount;
  schedulePersist();
  return user;
}

function ensureDailyLoginXp(uuid) {
  const key = `${uuid}:${nowDayKey()}`;
  if (dailyLogins.has(key)) return;
  dailyLogins.add(key);
  addXp(uuid, 10);
}

function markSeen(uuid) {
  const user = getUser(uuid);
  user.lastSeenAt = Date.now();
  ensureDailyLoginXp(uuid);
  schedulePersist();
}

function onlineUsers(room = null) {
  const cutoff = Date.now() - PRESENCE_MS;
  return [...users.values()].filter((u) => {
    if (u.lastSeenAt < cutoff) return false;
    if (room && (u.room || "lobby") !== room) return false;
    return true;
  });
}

function puzzleForDay(day = nowDayKey()) {
  const seed = day.replace(/-/g, "");
  const words = ["studio", "puzzle", "signal", "future", "social", "stream"];
  const idx = parseInt(seed.slice(-2), 10) % words.length;
  const answer = words[idx];
  const scramble = answer
    .split("")
    .sort((a, b) => ((a.charCodeAt(0) + seed.length) % 3) - ((b.charCodeAt(0) + seed.length) % 3))
    .join("");
  return {
    id: day,
    day,
    type: "word-scramble",
    prompt: `Unscramble this word: ${scramble.toUpperCase()}`,
    scramble,
    answer,
  };
}

function sanitizeMessage(message) {
  return String(message || "").replace(/\s+/g, " ").trim().slice(0, 1000);
}

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

function authFromReq(req) {
  const headerUuid = req.header("x-user-id");
  const bodyUuid = req.body?.uuid;
  const uuid = (headerUuid || bodyUuid || "").trim() || randomUUID();
  markSeen(uuid);
  return getUser(uuid);
}

function exposeUser(user) {
  return {
    uuid: user.uuid,
    displayName: user.displayName,
    xpTotal: user.xpTotal,
    dailyXp: user.dailyXp[nowDayKey()] || 0,
    premium: user.premium,
    theme: user.theme || "midnight",
    room: user.room || "lobby",
    lastSeenAt: user.lastSeenAt,
  };
}

function enforceToolLimits(user, body = {}) {
  const limits = user.premium ? PREMIUM_LIMITS : FREE_LIMITS;
  const size = Number(body.fileSizeBytes || 0);
  const expiryHours = Number(body.expiryHours || 0);
  const day = nowDayKey();

  if (size > limits.fileSizeBytes) {
    return `File too large for your tier (${limits.fileSizeBytes} bytes max).`;
  }
  if (expiryHours > limits.expiryHours) {
    return `Expiry too long for your tier (${limits.expiryHours}h max).`;
  }

  const usageKey = `${user.uuid}:${day}`;
  const used = toolsUsage.get(usageKey) || 0;
  if (used >= limits.dailyUsage) {
    return `Daily tool limit reached (${limits.dailyUsage}).`;
  }
  toolsUsage.set(usageKey, used + 1);
  schedulePersist();
  return null;
}

// ---------- Authentication ----------
app.post("/api/auth/anonymous", (req, res) => {
  const incoming = String(req.body?.uuid || "").trim();
  const uuid = incoming || randomUUID();
  const user = getUser(uuid);

  if (typeof req.body?.displayName === "string") {
    user.displayName = req.body.displayName.trim().slice(0, 32) || user.displayName;
  }
  if (typeof req.body?.room === "string") {
    user.room = roomForUser(user, req.body.room);
  }

  markSeen(uuid);
  res.json({ ...exposeUser(user), limits: user.premium ? PREMIUM_LIMITS : FREE_LIMITS });
});

app.post("/api/auth/display-name", (req, res) => {
  const user = authFromReq(req);
  const displayName = String(req.body?.displayName || "").trim().slice(0, 32);
  if (!displayName) return res.status(400).json({ error: "displayName is required." });
  user.displayName = displayName;
  schedulePersist();
  res.json({ ok: true, ...exposeUser(user) });
});

app.post("/api/auth/theme", (req, res) => {
  const user = authFromReq(req);
  const requested = String(req.body?.theme || "").trim();
  const allowed = user.premium ? PREMIUM_LIMITS.themes : FREE_LIMITS.themes;
  if (!allowed.includes(requested)) {
    return res.status(403).json({ error: `Theme not available for your tier. Allowed: ${allowed.join(", ")}` });
  }
  user.theme = requested;
  schedulePersist();
  return res.json({ ok: true, ...exposeUser(user), themes: allowed });
});

app.post("/api/chat/room", (req, res) => {
  const user = authFromReq(req);
  user.room = roomForUser(user, req.body?.room);
  schedulePersist();
  return res.json({ ok: true, room: user.room });
});

// ---------- Chat ----------
app.post("/api/chat/send", (req, res) => {
  const user = authFromReq(req);
  user.room = roomForUser(user, req.body?.room || user.room);

  const text = sanitizeMessage(req.body?.message);
  if (!text) return res.status(400).json({ error: "message is required" });

  const msg = {
    id: randomUUID(),
    uuid: user.uuid,
    room: user.room || "lobby",
    displayName: user.displayName,
    message: text,
    createdAt: Date.now(),
  };

  messages.push(msg);
  if (messages.length > MESSAGE_HISTORY_LIMIT) messages.shift();

  addXp(user.uuid, 1);
  schedulePersist();
  broadcast("chat:new", msg, msg.room);

  res.json({ ok: true, message: msg, xpTotal: user.xpTotal, dailyXp: user.dailyXp[nowDayKey()] || 0, room: msg.room });
});

app.get("/api/chat/history", (req, res) => {
  const user = authFromReq(req);
  const room = roomForUser(user, req.query.room || user.room || "lobby");
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const roomMessages = messages.filter((m) => m.room === room).slice(-limit);

  res.json({ messages: roomMessages, room, you: exposeUser(user) });
});

app.get("/api/chat/presence", (req, res) => {
  const user = authFromReq(req);
  const room = roomForUser(user, req.query.room || user.room || "lobby");
  const online = onlineUsers(room).map(exposeUser);
  res.json({ room, onlineCount: online.length, users: online });
});

// ---------- Leaderboard ----------
app.get("/api/leaderboard/daily", (req, res) => {
  authFromReq(req);
  const day = nowDayKey();
  const rows = [...users.values()]
    .map((u) => ({ uuid: u.uuid, displayName: u.displayName, xp: u.dailyXp[day] || 0 }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 50);
  res.json({ day, rows });
});

app.get("/api/leaderboard/global", (req, res) => {
  authFromReq(req);
  const rows = [...users.values()]
    .map((u) => ({ uuid: u.uuid, displayName: u.displayName, xp: u.xpTotal }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 50);
  res.json({ rows });
});

// ---------- Puzzle ----------
app.get("/api/puzzle/today", (req, res) => {
  authFromReq(req);
  const p = puzzleForDay();
  res.json({ id: p.id, day: p.day, type: p.type, prompt: p.prompt, scramble: p.scramble });
});

app.get("/api/puzzle/state", (req, res) => {
  const user = authFromReq(req);
  const p = puzzleForDay();
  const solved = user.puzzleSolvedDay === p.day;
  res.json({ day: p.day, solved, xpAward: solved ? 5 : 0 });
});

app.post("/api/puzzle/submit", (req, res) => {
  const user = authFromReq(req);
  const p = puzzleForDay();
  const move = String(req.body?.move || "").trim().toLowerCase();
  if (!move) return res.status(400).json({ error: "move is required" });

  const correct = move === p.answer;
  let awarded = 0;
  if (correct && user.puzzleSolvedDay !== p.day) {
    user.puzzleSolvedDay = p.day;
    addXp(user.uuid, 5);
    awarded = 5;
  }
  schedulePersist();
  res.json({ correct, awardedXp: awarded, answerLength: p.answer.length });
});

// ---------- Business Tools (MVP placeholders with limits) ----------
function toolHandler(toolName) {
  return (req, res) => {
    const user = authFromReq(req);
    const blocked = enforceToolLimits(user, req.body);
    if (blocked) return res.status(429).json({ error: blocked });

    const taskId = randomUUID();
    res.json({
      ok: true,
      tool: toolName,
      taskId,
      tier: user.premium ? "premium" : "free",
      status: "queued",
      limitsApplied: user.premium ? PREMIUM_LIMITS : FREE_LIMITS,
    });
  };
}

app.post("/api/tools/pdf/merge", toolHandler("pdf-merge"));
app.post("/api/tools/pdf/compress", toolHandler("pdf-compress"));
app.post("/api/tools/invoice", toolHandler("invoice-generator"));
app.post("/api/tools/share", toolHandler("expiring-file-share"));

// ---------- Music metadata helper (frontend-only sync helper) ----------
app.get("/api/music/current", (_req, res) => {
  res.json({
    provider: "spotify",
    track: "Cut To The Feeling",
    artist: "Carly Rae Jepsen",
    embedUrl: "https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl",
  });
});

// ---------- Subscription Placeholder ----------
app.get("/api/subscription/stripe-placeholder", (req, res) => {
  authFromReq(req);
  res.json({
    status: "placeholder",
    message: "Stripe integration will unlock premium limits, private rooms, and custom themes.",
    premiumFeatures: ["higher_file_limits", "private_rooms", "custom_themes"],
  });
});

// ---------- WebSocket ----------
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const uuid = (url.searchParams.get("uuid") || "").trim() || randomUUID();
  const user = getUser(uuid);
  user.room = roomForUser(user, url.searchParams.get("room") || user.room || "lobby");
  markSeen(uuid);

  wsByUuid.set(uuid, ws);
  wsMeta.set(ws, { uuid, room: user.room });

  ws.send(JSON.stringify({
    type: "hello",
    payload: exposeUser(user),
    ts: Date.now(),
  }));

  broadcast("presence:update", { room: user.room, onlineCount: onlineUsers(user.room).length }, user.room);

  ws.on("message", (raw) => {
    let data = null;
    try { data = JSON.parse(String(raw)); } catch { return; }

    if (data?.type === "heartbeat") {
      markSeen(uuid);
      return;
    }

    if (data?.type === "chat:join") {
      const nextRoom = roomForUser(user, data.room);
      user.room = nextRoom;
      wsMeta.set(ws, { uuid, room: nextRoom });
      schedulePersist();
      ws.send(JSON.stringify({ type: "chat:joined", payload: { room: nextRoom }, ts: Date.now() }));
      broadcast("presence:update", { room: nextRoom, onlineCount: onlineUsers(nextRoom).length }, nextRoom);
      return;
    }

    if (data?.type === "chat:send") {
      const room = roomForUser(user, data.room || user.room);
      const text = sanitizeMessage(data.message);
      if (!text) return;
      const msg = {
        id: randomUUID(),
        uuid: user.uuid,
        room,
        displayName: user.displayName,
        message: text,
        createdAt: Date.now(),
      };
      messages.push(msg);
      if (messages.length > MESSAGE_HISTORY_LIMIT) messages.shift();
      addXp(user.uuid, 1);
      schedulePersist();
      broadcast("chat:new", msg, room);
    }
  });

  ws.on("close", () => {
    wsMeta.delete(ws);
    wsByUuid.delete(uuid);
    const room = user.room || "lobby";
    broadcast("presence:update", { room, onlineCount: onlineUsers(room).length }, room);
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, online: onlineUsers().length, messages: messages.length, users: users.size });
});

loadState();
server.listen(PORT, () => {
  console.log(`Social Studio server listening on http://localhost:${PORT}`);
});
