export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];
    this.players = {};
    this.gameText = null;

    // NEW: lobby state
    this.raceFinished = false;
    this.raceStarted = false;
    this.host = null; // playerId
  }

  pickGoofyName() {
    const pool = [
      "CaptainWaffles","SirTyposALot","QuantumBanana","TurboHamster","ByteMeBro",
      "404SpeedNotFound","MajesticToaster","ColonelKeyboard","SpaceSausage",
      "LintWizard","NeonPotato","PanicAtTheDiscoKey","FuzzyFirewall","CryptoPenguin",
      "LatencyLlama","PacketPirate","SyntaxSamurai","WPMWarlock","GremlinGears",
      "GlitchGoblin","ChonkChampion","SnackOps","NullPointerNinja","MemeMachine"
    ];

    const used = new Set(Object.keys(this.players));
    const available = pool.filter(n => !used.has(n));

    if (available.length) {
      return available[Math.floor(Math.random() * available.length)];
    }

    let n = Object.keys(this.players).length + 1;
    let candidate = `ChaosGoblin${n}`;
    while (used.has(candidate)) { n++; candidate = `ChaosGoblin${n}`; }
    return candidate;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    // Keep your existing gate, but allow joining before start.
    if (this.raceFinished || Object.keys(this.players).length >= 4) {
      return new Response("Room closed or full", { status: 403 });
    }

    const roomId = this.state.id.toString();

    if (!this.gameText) {
      const kvKey = `room:${roomId}:text`;
      let text = await this.env.ROOM_STATE.get(kvKey);

      if (!text) {
        const snippets = [
          "The quick brown fox jumps over the lazy dog.",
          "Cloudflare Workers let you run JavaScript on the edge.",
          "Durable Objects are useful for real-time apps.",
        ];
        text = snippets[Math.floor(Math.random() * snippets.length)];
        await this.env.ROOM_STATE.put(kvKey, text, { expirationTtl: 600 });
      }

      this.gameText = text;
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const playerId = this.pickGoofyName();
    this.players[playerId] = 0;
    this.clients.push(server);

    // NEW: assign host if none yet
    if (!this.host) this.host = playerId;

    // IMPORTANT CHANGE:
    // init does NOT start the race anymore; it just tells client lobby state
    server.send(JSON.stringify({
      event: "init",
      text: this.gameText,
      you: playerId,
      host: this.host,
      started: this.raceStarted,
      players: this.players,
    }));

    // IMPORTANT CHANGE:
    // join broadcast includes full roster so UIs render immediately
    this.broadcast(JSON.stringify({
      event: "join",
      player: playerId,
      host: this.host,
      players: this.players,
    }), server);

    server.addEventListener("message", async (msgEvt) => {
      try {
        const data = JSON.parse(msgEvt.data);

        // NEW: host-controlled start
        if (data.event === "start") {
          if (this.raceFinished || this.raceStarted) return;
          if (data.player !== this.host) return; // only host can start

          this.raceStarted = true;
          this.broadcast(JSON.stringify({
            event: "start",
            host: this.host,
            players: this.players,
          }), null);
          return;
        }

        if (data.event === "progress") {
          if (this.raceFinished) return;
          if (!this.raceStarted) return; // ignore progress before start

          const { player, charsTyped } = data;

          // Trust server-side identity by socket? You kept client-sent player.
          // Minimal change: keep your existing pattern.
          this.players[player] = charsTyped;

          this.broadcast(
            JSON.stringify({ event: "update", player, charsTyped, players: this.players }),
            server
          );
          return;
        }

        if (data.event === "finish") {
          if (!this.raceStarted) return;

          const { player, time } = data;
          if (!this.raceFinished) {
            this.raceFinished = true;
            this.broadcast(JSON.stringify({ event: "finish", player, time }), null);

            const kvKey = `room:${this.state.id.toString()}:text`;
            await this.env.ROOM_STATE.delete(kvKey);
          }
          return;
        }
      } catch (err) {
        console.error("DO message error:", err);
      }
    });

    server.addEventListener("close", () => {
      this.clients = this.clients.filter((ws) => ws !== server);

      // OPTIONAL: host handoff before start
      if (!this.raceStarted && playerId === this.host) {
        const remainingNames = Object.keys(this.players).filter(p => p !== playerId);
        this.host = remainingNames.length ? remainingNames[0] : null;
      }

      // Optional: remove player from roster on disconnect (keeps lobby clean)
      delete this.players[playerId];

      this.broadcast(JSON.stringify({
        event: "leave",
        player: playerId,
        host: this.host,
        players: this.players
      }), null);

      if (this.clients.length === 0) {
        this.state.storage.deleteAll();
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message, exceptServer = null) {
    for (const ws of this.clients) {
      if (ws !== exceptServer) {
        try {
          ws.send(message);
        } catch {}
      }
    }
  }
}

/**
 * NEW: Lobby Durable Object (matchmaker)
 * Everyone connects to /typeracer-ws/lobby (WS).
 * When >= 2 waiting, it creates a room code and assigns up to 4 players.
 */
export class LobbyDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.waiting = []; // array of ws
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    this.waiting.push(server);

    // let client know they are queued
    server.send(JSON.stringify({ event: "queued", waiting: this.waiting.length }));

    const cleanup = () => {
      this.waiting = this.waiting.filter(w => w !== server);
    };

    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    // match now
    this.matchmake();

    return new Response(null, { status: 101, webSocket: client });
  }

  matchmake() {
    // rule: need at least 2 to start forming a room
    if (this.waiting.length < 2) return;

    // take up to 4
    const group = this.waiting.splice(0, 4);

    // create room code
    const code = Math.random().toString(36).slice(2, 10);

    // ensure DO exists (same trick you used)
    this.env.ROOM_DO.idFromName(code);

    const msg = JSON.stringify({ event: "assigned", room: code });

    for (const ws of group) {
      try {
        ws.send(msg);
        ws.close(1000, "assigned");
      } catch {}
    }

    // if enough remain, keep matching
    if (this.waiting.length >= 2) this.matchmake();
  }
}

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ✅ IMPORTANT: your Worker is mounted at /typeracer-ws/*
    const PREFIX = "/typeracer-ws";
    let path = url.pathname;
    if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || "/";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders("*") });
    }

    // NEW: Lobby route (WS)
    if (path === "/lobby") {
      const lobbyId = env.LOBBY_DO.idFromName("lobby");
      return env.LOBBY_DO.get(lobbyId).fetch(request);
    }

    // Keep your existing createRoom for share-links/manual rooms
    if (path === "/createRoom") {
      const code = Math.random().toString(36).slice(2, 10);
      env.ROOM_DO.idFromName(code);
      return new Response(code, { status: 200, headers: corsHeaders("*") });
    }

    if (path.startsWith("/room/")) {
      const roomCode = path.split("/")[2];
      if (!roomCode) return new Response("Room ID required", { status: 400 });

      const roomId = env.ROOM_DO.idFromName(roomCode);
      const roomObject = env.ROOM_DO.get(roomId);
      return roomObject.fetch(request);
    }

    return new Response("Not found", { status: 404, headers: corsHeaders("*") });
  },
};

