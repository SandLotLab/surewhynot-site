export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];              // Array of connected WebSocket server endpoints
    this.players = {};              // Map of playerName -> progress (chars typed)
    this.gameText = null;           // The text snippet for this race
    this.raceFinished = false;      // Flag to mark if race is finished
  }

  async fetch(request) {
    // This Durable Object handles only WebSocket connections (upgrade requests)
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', {status: 426});
    }
    // If race already finished, reject new connections
    if (this.raceFinished || Object.keys(this.players).length >= 4) {
      return new Response('Room closed or full', {status: 403});
    }

    // Get or generate the race text for this room
    const roomId = this.state.id.toString();  // Unique ID of this DO instance
    if (!this.gameText) {
      // If not already set, fetch from KV or generate a new snippet
      const kvKey = `room:${roomId}:text`;
      let text = await this.env.ROOM_STATE.get(kvKey);
      if (!text) {
        // No text in KV (new room) – choose a random quote/snippet
        const snippets = [
          "The quick brown fox jumps over the lazy dog.",
          "Cloudflare Workers let you run JavaScript on the edge.",
          "Durable Objects are useful for real-time apps."
        ];
        text = snippets[Math.floor(Math.random()*snippets.length)];
        // Store in KV with TTL (e.g. expire after 10 minutes)
        await this.env.ROOM_STATE.put(kvKey, text, { expirationTtl: 600 }); 
      }
      this.gameText = text;
    }

    // Accept the WebSocket connection
    const [ client, server ] = Object.values(new WebSocketPair());
    server.accept();

    // Assign a player name and initialize their progress
    const playerId = `Player ${Object.keys(this.players).length + 1}`;
    this.players[playerId] = 0;
    this.clients.push(server);

    // Send initial data to the newly connected client: the race text, their player name, and current players
    server.send(JSON.stringify({
      event: "init",
      text: this.gameText,
      you: playerId,
      players: this.players
    }));

    // Notify existing players about the new player
    this.broadcast(JSON.stringify({ event: "join", player: playerId }), server);

    // Set up event handlers for this WebSocket server endpoint
    server.addEventListener('message', async msgEvt => {
      const message = msgEvt.data;
      try {
        const data = JSON.parse(message);
        if (data.event === "progress") {
          // Player progress update (number of characters typed correctly)
          if (this.raceFinished) return;  // ignore updates after race finished
          const { player, charsTyped } = data;
          this.players[player] = charsTyped;
          // Broadcast progress to other players
          this.broadcast(JSON.stringify({ event: "update", player, charsTyped }), server);
        } else if (data.event === "finish") {
          // A player finished the race
          const { player, time } = data;
          if (!this.raceFinished) {
            this.raceFinished = true;
            // Announce the winner to all players
            this.broadcast(JSON.stringify({ event: "finish", player, time }), null);
            // Clear stored room data in KV (text no longer needed)
            const kvKey = `room:${this.state.id.toString()}:text`;
            await this.env.ROOM_STATE.delete(kvKey);
          }
        }
      } catch (err) {
        console.error("Error processing message in DO:", err);
      }
    });

    server.addEventListener('close', () => {
      // Remove this client from list on disconnect
      this.clients = this.clients.filter(ws => ws !== server);
      // Optionally, cleanup if all players left
      if (this.clients.length === 0) {
        this.state.storage.deleteAll();  // clear any durable storage (optional)
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // Helper to broadcast a message to all connected clients (except optionally one client)
  broadcast(message, exceptServer=null) {
    for (const ws of this.clients) {
      if (ws !== exceptServer) {
        try { ws.send(message); } catch (err) { /* ignore errors, connection might be closing */ }
      }
    }
  }
}

// Main Worker fetch event – routes requests to Durable Object or handles creation
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/createRoom") {
      // Endpoint to create a new room
      // Generate a unique room name or ID. We'll use a random 8-char code for human-friendliness.
      const code = Math.random().toString(36).substr(2, 8);
      const id = env.ROOM_DO.idFromName(code);
      // (We don't actually need to instantiate the DO here; just return the code for the frontend to use)
      return new Response(code, {status: 200, headers: { "Access-Control-Allow-Origin": "*" }});
    } else if (path.startsWith("/room/")) {
      // WebSocket connection to a room Durable Object
      const roomCode = path.split("/")[2];
      if (!roomCode) {
        return new Response("Room ID required", {status: 400});
      }
      // Get Durable Object stub for this room (will create object if it doesn't exist yet)
      const roomId = env.ROOM_DO.idFromName(roomCode);
      const roomObject = env.ROOM_DO.get(roomId);
      // Forward the request to the Durable Object (which will handle the WebSocket upgrade)
      return roomObject.fetch(request);
    }
    // For any other routes, return 404
    return new Response("Not found", { status: 404 });
  }
};
