// social-studio/server/src/tools/share.js
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DEFAULT_STATE_FILE = path.join(process.cwd(), "data", "state.json");

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readState(stateFile = DEFAULT_STATE_FILE) {
  try {
    if (!fs.existsSync(stateFile)) return { users: [], messages: [], shares: [] };
    const raw = fs.readFileSync(stateFile, "utf8");
    const s = JSON.parse(raw || "{}");
    return {
      users: Array.isArray(s.users) ? s.users : [],
      messages: Array.isArray(s.messages) ? s.messages : [],
      shares: Array.isArray(s.shares) ? s.shares : [],
    };
  } catch {
    return { users: [], messages: [], shares: [] };
  }
}

function writeState(next, stateFile = DEFAULT_STATE_FILE) {
  const dir = path.dirname(stateFile);
  ensureDir(dir);
  fs.writeFileSync(stateFile, JSON.stringify(next, null, 2));
}

export function createShare({ expiryHours = 6, fileSizeBytes = 0 } = {}, { stateFile = DEFAULT_STATE_FILE } = {}) {
  const hours = Math.max(1, Math.min(72, safeNumber(expiryHours, 6)));
  const expiresAt = Date.now() + hours * 60 * 60 * 1000;

  const shareId = `shr_${randomUUID()}`;

  const state = readState(stateFile);
  state.shares = state.shares || [];
  state.shares.push({
    shareId,
    createdAt: Date.now(),
    expiresAt,
    fileSizeBytes: safeNumber(fileSizeBytes, 0),
  });
  writeState(state, stateFile);

  return { shareId, expiresAt, hours };
}

export function getShare(shareId, { stateFile = DEFAULT_STATE_FILE } = {}) {
  const state = readState(stateFile);
  const shares = Array.isArray(state.shares) ? state.shares : [];
  return shares.find((s) => s.shareId === shareId) || null;
}
