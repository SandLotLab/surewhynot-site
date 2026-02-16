export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];
    this.players = {};
    this.gameText = null;
    this.raceFinished = false;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

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

    const playerId = `Player ${Object.keys(this.players).length + 1}`;
    this.players[playerId] = 0;
    this.clients.push(server);

    server.send(
      JSON.stringify({
        event: "init",
        text: this.gameText,
        you: playerId,
        players: this.players,
      })
    );

    this.broadcast(JSON.stringify({ event: "join", player: playerId }), server);

    server.addEventListener("message", async (msgEvt) => {
      try {
        const data = JSON.parse(msgEvt.data);

        if (data.event === "progress") {
          if (this.raceFinished) return;
          const { player, charsTyped } = data;
          this.players[player] = charsTyped;
          this.broadcast(
            JSON.stringify({ event: "update", player, charsTyped }),
            server
          );
        }

        if (data.event === "finish") {
          const { player, time } = data;
          if (!this.raceFinished) {
            this.raceFinished = true;
            this.broadcast(JSON.stringify({ event: "finish", player, time }), null);

            const kvKey = `room:${this.state.id.toString()}:text`;
            await this.env.ROOM_STATE.delete(kvKey);
          }
        }
      } catch (err) {
        console.error("DO message error:", err);
      }
    });

    server.addEventListener("close", () => {
      this.clients = this.clients.filter((ws) => ws !== server);
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
    // so we strip that prefix so your routes still match.
    const PREFIX = "/typeracer-ws";
    let path = url.pathname;
    if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || "/";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders("*") });
    }

    if (path === "/createRoom") {
      const code = Math.random().toString(36).slice(2, 10);
      env.ROOM_DO.idFromName(code); // ensures consistent name → DO id mapping
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
