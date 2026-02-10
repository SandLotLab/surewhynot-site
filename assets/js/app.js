// ===============================
// IDENTITY (stable per day)
// ===============================
function ymdUTC(d=new Date()){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function randFrom(list){
  return list[Math.floor(Math.random()*list.length)];
}

function makeDailyName(){
  const adj = ["Quiet","Rusty","Neon","Grim","Solar","Polar","Swift","Wired","Calm","Feral","Coded","Void","Tactical","Glitch","Iron","Ghost"];
  const noun = ["Raptor","Signal","Router","Falcon","Nomad","Circuit","Cipher","Beacon","Horizon","Kernel","Comet","Vector","Warden","Anvil","Pulse","Lambda"];
  const num = Math.floor(100 + Math.random()*900);
  return `${randFrom(adj)}${randFrom(noun)}${num}`;
}

export function getIdentity(){
  const key = "swn_identity";
  const today = ymdUTC();
  let obj = null;

  try { obj = JSON.parse(localStorage.getItem(key) || "null"); } catch {}

  if (!obj || obj.day !== today || !obj.name || !obj.uid){
    obj = {
      day: today,
      name: makeDailyName(),
      uid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + ":" + Math.random()
    };
    localStorage.setItem(key, JSON.stringify(obj));
  }
  return obj;
}

// ===============================
// TOP BAR
// ===============================
export function injectTopbar(active){
  const ident = getIdentity();
  const host = document.createElement("div");
  host.className = "topbar";
  host.innerHTML = `
    <div class="brand">
      <b>surewhynot.app</b>
      <span>User: <span class="pill">${ident.name}</span></span>
    </div>
    <div class="nav">
      <a href="/index.html"${active==="home" ? ' style="text-decoration:underline;"' : ""}>Home</a>
      <a href="/pages/typerace/race.html"${active==="race" ? ' style="text-decoration:underline;"' : ""}>TypeRace</a>
      <a href="/pages/fax.html"${active==="fax" ? ' style="text-decoration:underline;"' : ""}>Fax</a>
      <a href="/pages/about.html"${active==="about" ? ' style="text-decoration:underline;"' : ""}>About</a>
    </div>
  `;
  const mount = document.querySelector("[data-topbar]") || document.body;
  mount.prepend(host);
}

// ===============================
// CHAT SOCKET (LIVE, SITE-WIDE)
// ===============================
let CHAT_SOCKET = null;

function chatUrl(){
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  const ident = getIdentity();
  return `${proto}${location.host}/chat?room=SITE&nick=${encodeURIComponent(ident.name)}`;
}

function getChatSocket(){
  if (CHAT_SOCKET && (CHAT_SOCKET.readyState === 0 || CHAT_SOCKET.readyState === 1)) {
    return CHAT_SOCKET;
  }
  CHAT_SOCKET = new WebSocket(chatUrl());
  return CHAT_SOCKET;
}

// ===============================
// CHAT WIDGET (PERSISTENT)
// ===============================
export function injectChatWidget(){
  if (document.getElementById("swnChatBtn")) return;

  const ident = getIdentity();
  const log = [];

  const css = document.createElement("style");
  css.textContent = `
    #swnChatBtn{ position:fixed; right:18px; bottom:18px; z-index:9999;
      border-radius:999px; padding:10px 12px;
      border:1px solid rgba(255,255,255,0.14);
      background:rgba(255,255,255,0.06);
      color:#e8edf5; cursor:pointer;
      font-family: ui-monospace, monospace;
      box-shadow:0 10px 30px rgba(0,0,0,0.35); }
    #swnChatDock{ position:fixed; right:18px; bottom:66px; z-index:9999;
      width:min(360px, calc(100vw - 36px));
      max-height:60vh; border-radius:14px;
      border:1px solid rgba(255,255,255,0.12);
      background:rgba(0,0,0,0.55);
      display:none; overflow:hidden;
      box-shadow:0 10px 30px rgba(0,0,0,0.45);
      font-family: ui-monospace, monospace; }
    #swnChatDock.open{ display:flex; flex-direction:column; }
    #swnChatTop{ padding:10px 12px; display:flex; justify-content:space-between;
      border-bottom:1px solid rgba(255,255,255,0.10); font-size:12px; }
    #swnChatLog{ padding:10px 12px; overflow:auto; flex:1; font-size:12px; }
    .swnMsg{ margin:6px 0; padding:6px 8px; border-radius:10px;
      border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.25); }
    #swnChatComposer{ padding:10px; display:grid; grid-template-columns:1fr auto; gap:8px;
      border-top:1px solid rgba(255,255,255,0.10); }
    #swnChatInput{ width:100%; min-height:34px; border-radius:10px;
      border:1px solid rgba(255,255,255,0.12);
      background:rgba(0,0,0,0.35); color:#e8edf5; padding:6px; }
  `;
  document.head.appendChild(css);

  const btn = document.createElement("button");
  btn.id = "swnChatBtn";
  btn.textContent = "Chat";
  document.body.appendChild(btn);

  const dock = document.createElement("div");
  dock.id = "swnChatDock";
  dock.innerHTML = `
    <div id="swnChatTop">
      <div>${ident.name}</div>
      <button id="swnChatClose">Close</button>
    </div>
    <div id="swnChatLog"></div>
    <div id="swnChatComposer">
      <textarea id="swnChatInput" placeholder="Type…"></textarea>
      <button id="swnChatSend">Send</button>
    </div>
  `;
  document.body.appendChild(dock);

  const $ = (id) => document.getElementById(id);

  function render(){
    $("swnChatLog").innerHTML = log.map(m =>
      `<div class="swnMsg"><b>${m.nick}</b>: ${m.text}</div>`
    ).join("");
    $("swnChatLog").scrollTop = $("swnChatLog").scrollHeight;
  }

  const ws = getChatSocket();
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === "history") {
      log.length = 0;
      log.push(...msg.entries);
      render();
    }
    if (msg.t === "chat") {
      log.push(msg.entry);
      render();
    }
  };

  $("swnChatSend").onclick = () => {
    const text = $("swnChatInput").value.trim();
    if (!text) return;
    ws.send(JSON.stringify({ t:"chat", nick: ident.name, text }));
    $("swnChatInput").value = "";
  };

  $("swnChatClose").onclick = () => dock.classList.remove("open");
  btn.onclick = () => dock.classList.toggle("open");
}
