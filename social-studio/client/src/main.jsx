import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// IMPORTANT: server routes are /social-studio/api/* and WS is /social-studio/ws
const API_BASE = "/social-studio";
const UUID_KEY = "social_studio_uuid_v1";
const NAME_KEY = "social_studio_name_v1";
const ROOM_KEY = "social_studio_room_v1";
const THEME_KEY = "social_studio_theme_v1";
const [tools, setTools] = useState([]);

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

  const [user, setUser] = useState(null); // server returns { ok, user }
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [presence, setPresence] = useState({ onlineCount: 0, users: [] });

  const [dailyBoard, setDailyBoard] = useState([]);
  const [globalBoard, setGlobalBoard] = useState([]);

  const [puzzle, setPuzzle] = useState(null); // server: { ok, puzzle: { day,type,scramble,hint } }
  const [puzzleInput, setPuzzleInput] = useState("");
  const [puzzleState, setPuzzleState] = useState(null); // server: { ok, day, solved }

  const [track, setTrack] = useState(null); // server stub returns { ok, track: null }
  const [status, setStatus] = useState("Ready");
  const [socket, setSocket] = useState(null);

  async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "x-user-id": uuid,
        ...(opts.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  useEffect(() => localStorage.setItem(ROOM_KEY, room), [room]);
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (displayName) localStorage.setItem(NAME_KEY, displayName);
  }, [displayName]);

  const wsUrl = useMemo(() => {
    const wsBase = API_BASE.replace(/^http/, "ws"); // keeps /social-studio
    return `${wsBase}/ws?uuid=${encodeURIComponent(uuid)}&room=${encodeURIComponent(room)}`;
  }, [uuid, room]);

  async function bootstrap() {
    const data = await api("/api/auth/anonymous", {
      method: "POST",
      body: JSON.stringify({
        uuid,
        displayName: displayName || undefined,
        room,
      }),
    });

    // server returns { ok: true, user: {...} }
    setUser(data.user);

    // if server assigned default name, keep it
    if (!displayName && data.user?.displayName) setDisplayName(data.user.displayName);
    if (data.user?.room && data.user.room !== room) setRoom(data.user.room);
  }

  async function loadAll() {
  const [h, p, d, g, t, ps, music, tl] = await Promise.all([
    api(`/api/chat/history?room=${encodeURIComponent(room)}`),
    api(`/api/chat/presence?room=${encodeURIComponent(room)}`),
    api("/api/leaderboard/daily"),
    api("/api/leaderboard/global"),
    api("/api/puzzle/today"),
    api("/api/puzzle/state"),
    api("/api/music/current"),
    api("/api/tools"),
  ]);

  setMessages(h.messages || []);
  setPresence(p);
  setDailyBoard(d.rows || []);
  setGlobalBoard(g.rows || []);
  setPuzzle(t);
  setPuzzleState(ps);
  setTrack(music);
  setTools(tl.tools || []);
}

  useEffect(() => {
    (async () => {
      await bootstrap();
      await loadAll();
    })().catch((e) => setStatus(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      if (msg.type === "hello") {
        // server sends full user object
        setUser(msg.payload);
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
  }, [wsUrl, room]);

  useEffect(() => {
    loadAll().catch((e) => setStatus(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  async function sendMessage() {
    if (!message.trim()) return;
    try {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "chat:send", room, message }));
      } else {
        await api("/api/chat/send", { method: "POST", body: JSON.stringify({ room, message }) });
      }

      // refresh user XP + boards/presence after sending
      await bootstrap();
      await loadAll();
      setMessage("");
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function saveName() {
    try {
      const res = await api("/api/auth/display-name", {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
      // server returns fields, but user is source of truth
      await bootstrap();
      await loadAll();
      setStatus("Name updated");
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function changeTheme(next) {
    // client-only for now (your server doesn't implement /api/auth/theme)
    setTheme(next);
    setStatus(`Theme set: ${next}`);
  }

  async function changeRoom(nextRoom) {
    const normalized = (nextRoom || "").trim() || "lobby";
    try {
      const res = await api("/api/chat/room", { method: "POST", body: JSON.stringify({ room: normalized }) });
      setRoom(res.room);
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "chat:join", room: res.room }));
      await bootstrap();
      await loadAll();
      setStatus(`Room set: ${res.room}`);
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function submitPuzzle() {
    try {
      const result = await api("/api/puzzle/submit", {
        method: "POST",
        body: JSON.stringify({ guess: puzzleInput }),
      });

      if (result.solved) setStatus(`Solved! +${result.awardXp || 0} XP`);
      else setStatus("Try again");

      setPuzzleInput("");
      await bootstrap();
      await loadAll();
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function callTool(route) {
    // server doesn't implement tools yet; keep as UI-only
    setStatus(`Missing server route: ${route}`);
  }

  return (
    <div className="layout">
      <aside className="sidebar panel">
        <h3>Tools</h3>
        {tools.length === 0 && <div className="tiny">Loading tools…</div>}

         {tools.map((t) => (
           <button
             key={t.id}
             onClick={() => callTool(t.path.replace("/social-studio", ""))}
           >
             {t.id}
           </button>
         ))}

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
          <span>XP: {user?.xpTotal ?? 0}</span>
          <span>Daily: {user?.dailyXp ?? 0}</span>
        </div>

        <div className="nameRow">
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="room (e.g. lobby)" />
          <button onClick={() => changeRoom(room)}>Join room</button>
          <span>Current room: {user?.room || room}</span>
        </div>

        <section className="messages">
          {messages.map((m) => (
            <div key={m.id}>
              <b>{m.displayName}</b> <small>[{m.room}]</small>: {m.message}
            </div>
          ))}
        </section>

        <footer>
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Send a message" />
          <button onClick={sendMessage}>Send</button>
        </footer>
      </main>
);
      <aside className="right panel">
        <h3>Online users ({presence.onlineCount})</h3>
        <ul>
          {presence.users.map((u) => (
            <li key={u.uuid}>
              {u.displayName} ({u.xpTotal ?? 0})
            </li>
          ))}
        </ul>

        <h3>Daily Leaderboard</h3>
        <ol>
          {dailyBoard.slice(0, 5).map((u) => (
            <li key={u.uuid}>
              {u.displayName}: {u.dailyXp ?? 0}
            </li>
          ))}
        </ol>

        <h3>Global Leaderboard</h3>
        <ol>
          {globalBoard.slice(0, 5).map((u) => (
            <li key={u.uuid}>
              {u.displayName}: {u.xpTotal ?? 0}
            </li>
          ))}
        </ol>
      </aside>

      <section className="puzzle panel">
        <h3>Daily Puzzle</h3>
        <div>
          <div>
            <b>Scramble:</b> {puzzle?.scramble || "…"}
          </div>
          <div>
            <b>Hint:</b> {puzzle?.hint || "…"}
          </div>
        </div>

        <input value={puzzleInput} onChange={(e) => setPuzzleInput(e.target.value)} placeholder="Enter answer" />
        <button onClick={submitPuzzle}>Submit</button>
        <div>Solved: {String(puzzleState?.solved || false)}</div>
      </section>

      <section className="music panel">
        <h3>Music Sync (Frontend only)</h3>
        <div className="tiny">Now playing: {track ? "custom track" : "none"}</div>
        <iframe
          title="spotify"
          src={"https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl"}
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
