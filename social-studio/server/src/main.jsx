import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const UUID_KEY = "social_studio_uuid_v1";
const NAME_KEY = "social_studio_name_v1";
const ROOM_KEY = "social_studio_room_v1";
const THEME_KEY = "social_studio_theme_v1";

const THEMES = ["midnight", "sunset", "forest", "violet"];

function getOrCreateUuid() {
  let uuid = localStorage.getItem(UUID_KEY);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(UUID_KEY, uuid);
  }
  return uuid;
}

function App() {
  const [uuid] = useState(getOrCreateUuid);
  const [displayName, setDisplayName] = useState(localStorage.getItem(NAME_KEY) || "");
  const [room, setRoom] = useState(localStorage.getItem(ROOM_KEY) || "lobby");
  const [theme, setTheme] = useState(localStorage.getItem(THEME_KEY) || "midnight");
  const [auth, setAuth] = useState(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [presence, setPresence] = useState({ onlineCount: 0, users: [] });
  const [dailyBoard, setDailyBoard] = useState([]);
  const [globalBoard, setGlobalBoard] = useState([]);
  const [puzzle, setPuzzle] = useState(null);
  const [puzzleInput, setPuzzleInput] = useState("");
  const [puzzleState, setPuzzleState] = useState(null);
  const [track, setTrack] = useState(null);
  const [status, setStatus] = useState("Ready");
  const [socket, setSocket] = useState(null);

  async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: {
        "content-type": "application/json",
        "x-user-id": uuid,
        ...(opts.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  useEffect(() => {
    localStorage.setItem(ROOM_KEY, room);
  }, [room]);
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (displayName) localStorage.setItem(NAME_KEY, displayName);
  }, [displayName]);

  const wsUrl = useMemo(() => {
    const base = API_BASE.replace(/^http/, "ws");
    return `${base}/ws?uuid=${encodeURIComponent(uuid)}&room=${encodeURIComponent(room)}`;
  }, [uuid, room]);

  async function loadAll() {
    const [h, p, d, g, t, ps, music] = await Promise.all([
      api(`/api/chat/history?room=${encodeURIComponent(room)}`),
      api(`/api/chat/presence?room=${encodeURIComponent(room)}`),
      api("/api/leaderboard/daily"),
      api("/api/leaderboard/global"),
      api("/api/puzzle/today"),
      api("/api/puzzle/state"),
      api("/api/music/current"),
    ]);

    setMessages(h.messages || []);
    setPresence(p);
    setDailyBoard(d.rows || []);
    setGlobalBoard(g.rows || []);
    setPuzzle(t);
    setPuzzleState(ps);
    setTrack(music);
  }

  useEffect(() => {
    (async () => {
      const data = await api("/api/auth/anonymous", {
        method: "POST",
        body: JSON.stringify({ uuid, displayName: displayName || undefined, room }),
      });
      setAuth(data);
      if (!displayName && data.displayName) setDisplayName(data.displayName);
      if (data.room && data.room !== room) setRoom(data.room);
      if (data.theme && data.theme !== theme) setTheme(data.theme);
      await loadAll();
    })().catch((e) => setStatus(e.message));
  }, [uuid]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    setSocket(ws);

    ws.onopen = () => {
      setStatus(`Connected (${room})`);
      ws.send(JSON.stringify({ type: "chat:join", room }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "chat:new") {
        setMessages((m) => [...m, msg.payload].slice(-100));
      }
      if (msg.type === "presence:update") {
        if (!msg.payload?.room || msg.payload.room === room) {
          api(`/api/chat/presence?room=${encodeURIComponent(room)}`).then(setPresence).catch(() => {});
        }
      }
      if (msg.type === "hello") {
        setAuth((prev) => ({ ...(prev || {}), ...msg.payload }));
      }
      if (msg.type === "chat:joined") {
        setStatus(`Joined ${msg.payload.room}`);
      }
    };
    ws.onclose = () => setStatus("Disconnected");

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "heartbeat" }));
    }, 30_000);

    return () => {
      clearInterval(heartbeat);
      ws.close();
    };
  }, [wsUrl]);

  useEffect(() => {
    loadAll().catch((e) => setStatus(e.message));
  }, [room]);

  async function sendMessage() {
    if (!message.trim()) return;
    try {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "chat:send", room, message }));
      } else {
        await api("/api/chat/send", { method: "POST", body: JSON.stringify({ room, message }) });
      }
      setMessage("");
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function saveName() {
    try {
      await api("/api/auth/display-name", { method: "POST", body: JSON.stringify({ displayName }) });
      setStatus("Name updated");
      loadAll();
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function changeTheme(next) {
    setTheme(next);
    try {
      const res = await api("/api/auth/theme", { method: "POST", body: JSON.stringify({ theme: next }) });
      setAuth((prev) => ({ ...(prev || {}), ...res }));
      setStatus(`Theme set: ${next}`);
    } catch (e) {
      setStatus(e.message);
      setTheme(auth?.theme || "midnight");
    }
  }

  async function changeRoom(nextRoom) {
    const normalized = nextRoom.trim() || "lobby";
    try {
      const res = await api("/api/chat/room", { method: "POST", body: JSON.stringify({ room: normalized }) });
      setRoom(res.room);
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "chat:join", room: res.room }));
      setStatus(`Room set: ${res.room}`);
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function submitPuzzle() {
    try {
      const result = await api("/api/puzzle/submit", { method: "POST", body: JSON.stringify({ move: puzzleInput }) });
      setStatus(result.correct ? `Solved! +${result.awardedXp} XP` : "Try again");
      setPuzzleInput("");
      loadAll();
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function callTool(route) {
    try {
      const result = await api(route, {
        method: "POST",
        body: JSON.stringify({ fileSizeBytes: 1024 * 1024, expiryHours: 6 }),
      });
      setStatus(`Tool queued: ${result.tool}`);
    } catch (e) {
      setStatus(e.message);
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar panel">
        <h3>Tools</h3>
        <button onClick={() => callTool("/api/tools/pdf/merge")}>PDF Merge</button>
        <button onClick={() => callTool("/api/tools/pdf/compress")}>PDF Compress</button>
        <button onClick={() => callTool("/api/tools/invoice")}>Invoice Generator</button>
        <button onClick={() => callTool("/api/tools/share")}>Expiring Share</button>

        <h4>Theme</h4>
        <select value={theme} onChange={(e) => changeTheme(e.target.value)}>
          {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <h4>Subscription</h4>
        <small>Premium unlocks private rooms, custom themes, and higher limits.</small>
      </aside>

      <main className="chat panel">
        <header>
          <h1>Social Studio</h1>
          <div className="status">{status}</div>
        </header>

        <div className="nameRow">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />
          <button onClick={saveName}>Save</button>
          <span>UUID: {uuid.slice(0, 8)}…</span>
          <span>XP: {auth?.xpTotal ?? 0}</span>
        </div>

        <div className="nameRow">
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="room (e.g. lobby or private-team)" />
          <button onClick={() => changeRoom(room)}>Join room</button>
          <span>Current room: {auth?.room || room}</span>
        </div>

        <section className="messages">
          {messages.map((m) => (
            <div key={m.id}><b>{m.displayName}</b> <small>[{m.room}]</small>: {m.message}</div>
          ))}
        </section>

        <footer>
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Send a message" />
          <button onClick={sendMessage}>Send</button>
        </footer>
      </main>

      <aside className="right panel">
        <h3>Online users ({presence.onlineCount})</h3>
        <ul>{presence.users.map((u) => <li key={u.uuid}>{u.displayName} ({u.xpTotal})</li>)}</ul>
        <h3>Daily Leaderboard</h3>
        <ol>{dailyBoard.slice(0, 5).map((u) => <li key={u.uuid}>{u.displayName}: {u.xp}</li>)}</ol>
        <h3>Global Leaderboard</h3>
        <ol>{globalBoard.slice(0, 5).map((u) => <li key={u.uuid}>{u.displayName}: {u.xp}</li>)}</ol>
      </aside>

      <section className="puzzle panel">
        <h3>Daily Puzzle</h3>
        <p>{puzzle?.prompt}</p>
        <input value={puzzleInput} onChange={(e) => setPuzzleInput(e.target.value)} placeholder="Enter answer" />
        <button onClick={submitPuzzle}>Submit move</button>
        <div>Solved: {String(puzzleState?.solved || false)}</div>
      </section>

      <section className="music panel">
        <h3>Music Sync (Frontend only)</h3>
        <div className="tiny">Now playing: {track ? `${track.track} — ${track.artist}` : "loading..."}</div>
        <iframe
          title="spotify"
          src={track?.embedUrl || "https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl"}
          width="100%"
          height="152"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
