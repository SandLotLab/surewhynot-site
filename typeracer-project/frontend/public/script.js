const createBtn = document.getElementById('createBtn');
const lobbyDiv = document.getElementById('lobby');
const raceDiv = document.getElementById('race');
const raceTextEl = document.getElementById('raceText');
const inputEl = document.getElementById('typingInput');
const playersStatusEl = document.getElementById('playersStatus');
const resultEl = document.getElementById('result');
const retryBtn = document.getElementById('retryBtn');

let playerName = null;
let roomId = null;
let socket = null;
let startTime = null;
let finished = false;

// Show race UI and hide lobby UI
function enterRace(text) {
  lobbyDiv.style.display = 'none';
  raceDiv.style.display = 'block';
  raceTextEl.textContent = text;
  inputEl.value = '';
  inputEl.focus();
  updatePlayersStatus(); // initialize player list UI
}

// Update the players status display
function updatePlayersStatus() {
  playersStatusEl.innerHTML = ''; 
  for (const [player, chars] of Object.entries(players)) {
    const totalChars = raceTextEl.textContent.length;
    const percent = Math.floor((chars / totalChars) * 100);
    const status = document.createElement('p');
    status.textContent = `${player}: ${percent}%`;
    if (chars >= totalChars) {
      status.textContent += " (finished)";
      status.classList.add('finished');
    }
    playersStatusEl.appendChild(status);
  }
}

// Handle create button (start a new race)
createBtn.onclick = async () => {
  // Call the backend to create a new room
  const resp = await fetch(API_BASE + "/createRoom");
  roomId = await resp.text();
  // Redirect to the room page (will reload the page with /room/ID path)
  window.location.href = `/room/${roomId}`;
};

// Handle retry button (start a new race after finishing)
retryBtn.onclick = () => {
  window.location.href = "/"; // go back to lobby (or we could auto-create next room)
};

function setupWebSocket() {
  socket = new WebSocket(API_WS_BASE + `/room/${roomId}`);
  socket.onopen = () => {
    console.log("Connected to room", roomId);
    startTime = Date.now();
  };
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    switch (data.event) {
      case "init":
        playerName = data.you;
        roomId = roomId || ""; // ensure global roomId is set
        players = data.players || {};
        // Enter race UI with the given text
        enterRace(data.text);
        break;
      case "join":
        // A new player joined
        players[data.player] = 0;
        updatePlayersStatus();
        break;
      case "update":
        // Another player progress update
        if (data.player in players) {
          players[data.player] = data.charsTyped;
          updatePlayersStatus();
        }
        break;
      case "finish":
        // Race finished, winner announced
        finished = true;
        const winner = data.player;
        const time = data.time;
        resultEl.textContent = `🏆 ${winner} finished first in ${time} seconds!`;
        resultEl.style.display = 'block';
        retryBtn.style.display = 'inline';
        break;
    }
  };
  socket.onclose = () => {
    console.log("Disconnected from room");
  };
}

// If URL contains a room ID, join that room; otherwise show lobby
const pathMatch = window.location.pathname.match(/^\/room\/(.+)$/);
let players = {};
const API_BASE = "https://<YOUR_WORKER_DOMAIN>";      // base URL of the Worker (e.g., https://typeracer-api.example.workers.dev)
const API_WS_BASE = API_BASE.replace(/^http/, "ws");   // WebSocket base (ws:// or wss://)
if (pathMatch) {
  roomId = pathMatch[1];
  setupWebSocket();
} else {
  // We are on the lobby page (no room). Show lobby (the default) and wait for create button.
}
  
// Send progress updates on input
inputEl.addEventListener('input', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN || finished) return;
  const charsTyped = inputEl.value.length;
  players[playerName] = charsTyped;
  // Broadcast my progress to others via DO
  socket.send(JSON.stringify({ event: "progress", player: playerName, charsTyped }));
  updatePlayersStatus();
  // If completed the text, notify finish
  if (charsTyped === raceTextEl.textContent.length && !finished) {
    finished = true;
    const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(2);
    socket.send(JSON.stringify({ event: "finish", player: playerName, time: totalTimeSec }));
    // Note: We will receive the broadcasted finish event as well to update UI
  }
});
