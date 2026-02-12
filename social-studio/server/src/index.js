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

const users = new Map();
const messages = [];
const wsMeta = new Map();
const wsByUuid = new Map();

function nowDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function markSeen(uuid) {
  const user = getUser(uuid);
  user.lastSeenAt = Date.now();
}

function onlineUsers() {
  const cutoff = Date.now() - PRESENCE_MS;
  return [...users.values()].filter((u) => u.lastSeenAt > cutoff);
}

function getUser(uuid) {
  if (!users.has(uuid)) {
    users.set(uuid, {
      uuid,
      displayName: `guest-${uuid.slice(0, 6)}`,
      xpTotal: 0,
      dailyXp: {},
      lastSeenAt: 0,
      createdAt: Date.now(),
    });
  }
  return users.get(uuid);
}

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function authFromReq(req) {
  const uuid = (req.header("x-user-id") || req.body?.uuid || "").trim() || randomUUID();
  markSeen(uuid);
  return getUser(uuid);
}

/* =========================
   ROOT ROUTE (fixes Cannot GET /)
========================= */
app.get("/", (_req, res) => {
  res.send("Social Studio server is running.");
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    online: onlineUsers().length,
    messages: messages.length,
    users: users.size,
  });
});

/* =========================
   CHAT SEND
========================= */
app.post("/api/chat/send", (req, res) => {
  const user = authFromReq(req);
  const text = String(req.body?.message || "").trim();
  if (!text) return res.status(400).json({ error: "message required" });

  const msg = {
    id: randomUUID(),
    uuid: user.uuid,
    displayName: user.displayName,
    message: text,
    createdAt: Date.now(),
  };

  messages.push(msg);
  if (messages.length > MESSAGE_HISTORY_LIMIT) messages.shift();

  broadcast("chat:new", msg);

  res.json({ ok: true, message: msg });
});

/* =========================
   CHAT HISTORY
========================= */
app.get("/api/chat/history", (_req, res) => {
  res.json({ messages });
});

/* =========================
   WEBSOCKET
========================= */
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const uuid = (url.searchParams.get("uuid") || "").trim() || randomUUID();
  const user = getUser(uuid);

  markSeen(uuid);
  wsMeta.set(ws, { uuid });
  wsByUuid.set(uuid, ws);

  ws.send(
    JSON.stringify({
      type: "hello",
      payload: user,
      ts: Date.now(),
    })
  );

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (data?.type === "heartbeat") {
      markSeen(uuid);
    }

    if (data?.type === "chat:send") {
      const text = String(data.message || "").trim();
      if (!text) return;

      const msg = {
        id: randomUUID(),
        uuid: user.uuid,
        displayName: user.displayName,
        message: text,
        createdAt: Date.now(),
      };

      messages.push(msg);
      if (messages.length > MESSAGE_HISTORY_LIMIT) messages.shift();
      broadcast("chat:new", msg);
    }
  });

  ws.on("close", () => {
    wsMeta.delete(ws);
    wsByUuid.delete(uuid);
  });
});

/* =========================
   START SERVER
========================= */
server.listen(PORT, () => {
  console.log(`Social Studio server listening on http://localhost:${PORT}`);
});
