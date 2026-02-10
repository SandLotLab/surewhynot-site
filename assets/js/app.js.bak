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

export function injectChatWidget(){
  // Don’t inject twice
  if (document.getElementById("swnChatBtn")) return;

  const ident = getIdentity();

  // --- styles (inline so it works everywhere) ---
  const css = document.createElement("style");
  css.textContent = `
    #swnChatBtn{
      position:fixed; right:18px; bottom:18px; z-index:9999;
      border-radius:999px; padding:10px 12px;
      border:1px solid rgba(255,255,255,0.14);
      background:rgba(255,255,255,0.06);
      color:#e8edf5; cursor:pointer;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      box-shadow:0 10px 30px rgba(0,0,0,0.35);
    }
    #swnChatDock{
      position:fixed; right:18px; bottom:66px; z-index:9999;
      width:min(360px, calc(100vw - 36px));
      max-height: 60vh;
      border-radius:14px;
      border:1px solid rgba(255,255,255,0.12);
      background:rgba(0,0,0,0.55);
      backdrop-filter: blur(10px);
      color:#e8edf5;
      display:none;
      overflow:hidden;
      box-shadow:0 10px 30px rgba(0,0,0,0.45);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    #swnChatDock.open{ display:flex; flex-direction:column; }
    #swnChatTop{
      padding:10px 12px;
      display:flex; align-items:center; justify-content:space-between; gap:10px;
      border-bottom:1px solid rgba(255,255,255,0.10);
      background:rgba(255,255,255,0.03);
      font-size:12px;
    }
    #swnChatLog{
      padding:10px 12px;
      overflow:auto;
      flex:1;
      font-size:12px;
      white-space:pre-wrap;
    }
    .swnMsg{ margin:8px 0; padding:8px 10px; border-radius:12px;
      border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.25);
    }
    .swnMsg b{ opacity:.9; }
    .swnMeta{ opacity:.6; margin-left:6px; }
    #swnChatComposer{
      padding:10px 12px;
      border-top:1px solid rgba(255,255,255,0.10);
      display:grid; grid-template-columns:1fr auto; gap:8px;
      background:rgba(255,255,255,0.02);
    }
    #swnChatInput{
      width:100%; min-height:38px; max-height:110px; resize:vertical;
      border-radius:12px;
      border:1px solid rgba(255,255,255,0.12);
      background:rgba(0,0,0,0.35);
      color:#e8edf5;
      padding:8px 10px;
      outline:none;
      font-family: inherit;
      font-size:12px;
    }
    #swnChatSend{
      border-radius:12px;
      border:1px solid rgba(255,200,80,0.35);
      background:rgba(255,255,255,0.06);
      color:#e8edf5; cursor:pointer;
      padding:8px 12px;
      font-family: inherit;
      font-size:12px;
      height: fit-content;
    }
    #swnEmojiRow{
      display:flex; gap:6px; flex-wrap:wrap; padding:0 12px 10px 12px;
      border-top:1px solid rgba(255,255,255,0.06);
    }
    .swnEmoji{
      border:1px solid rgba(255,255,255,0.12);
      background:rgba(0,0,0,0.25);
      color:#e8edf5; cursor:pointer;
      border-radius:999px;
      padding:4px 8px;
      font-size:12px;
      font-family: inherit;
    }
  `;
  document.head.appendChild(css);

  // --- DOM ---
  const btn = document.createElement("button");
  btn.id = "swnChatBtn";
  btn.textContent = "Chat";
  document.body.appendChild(btn);

  const dock = document.createElement("div");
  dock.id = "swnChatDock";
  dock.innerHTML = `
    <div id="swnChatTop">
      <div>User: <span style="opacity:.85;">${ident.name}</span></div>
      <div style="display:flex; gap:8px;">
        <button class="swnEmoji" id="swnChatClear">Clear</button>
        <button class="swnEmoji" id="swnChatClose">Close</button>
      </div>
    </div>
    <div id="swnChatLog"></div>
    <div id="swnEmojiRow">
      <button class="swnEmoji" data-ins="🙂">🙂</button>
      <button class="swnEmoji" data-ins="😂">😂</button>
      <button class="swnEmoji" data-ins="🔥">🔥</button>
      <button class="swnEmoji" data-ins="✅">✅</button>
      <button class="swnEmoji" data-ins="🫡">🫡</button>
      <button class="swnEmoji" data-ins="(╯°□°）╯︵ ┻━┻">(╯°□°）╯︵ ┻━┻</button>
      <button class="swnEmoji" data-ins="¯\\_(ツ)_/¯">¯\\_(ツ)_/¯</button>
      <button class="swnEmoji" data-ins="(•_•) ( •_•)>⌐■-■ (⌐■_■)">(•_•) ( •_•)>⌐■-■ (⌐■_■)</button>
    </div>
    <div id="swnChatComposer">
      <textarea id="swnChatInput" placeholder="Type… (Enter sends, Shift+Enter newline)"></textarea>
      <button id="swnChatSend">Send</button>
    </div>
  `;
  document.body.appendChild(dock);

  const $ = (id) => document.getElementById(id);

  // local-only store for now
  const log = [];
const ws = getChatSocket();

  function esc(s){
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function render(){
    $("swnChatLog").innerHTML = log.map(m => `
      <div class="swnMsg">
        <b>${esc(m.name)}</b><span class="swnMeta">${new Date(m.t).toLocaleString()}</span>
        <div>${esc(m.text)}</div>
      </div>
    `).join("") || `<div style="opacity:.65;">No messages yet.</div>`;
    $("swnChatLog").scrollTop = $("swnChatLog").scrollHeight;
  }

  function save(){
    localStorage.setItem(KEY, JSON.stringify(log));
  }

  function send(){
    const box = $("swnChatInput");
    const text = box.value.trim();
    if (!text) return;
    log.push({ uid: ident.uid, name: ident.name, text, t: Date.now() });
    save();
    box.value = "";
    render();
  }

  btn.onclick = () => {
    dock.classList.toggle("open");
    if (dock.classList.contains("open")) $("swnChatInput").focus();
  };

  $("swnChatClose").onclick = () => dock.classList.remove("open");
  $("swnChatSend").onclick = send;

  $("swnChatClear").onclick = () => {
    localStorage.removeItem(KEY);
    log.length = 0;
    render();
  };

  // Enter to send (Shift+Enter newline)
  $("swnChatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey){
      e.preventDefault();
      send();
    }
  });

  // emoji/ascii insert
  dock.querySelectorAll("[data-ins]").forEach(b => {
    b.addEventListener("click", () => {
      const ins = b.getAttribute("data-ins");
      const box = $("swnChatInput");
      const start = box.selectionStart ?? box.value.length;
      const end = box.selectionEnd ?? box.value.length;
      box.value = box.value.slice(0, start) + ins + box.value.slice(end);
      const pos = start + ins.length;
      box.setSelectionRange(pos, pos);
      box.focus();
    });
  });

  render();
}

// ===============================
// SITE CHAT (real WebSocket chat)
// ===============================
let SWN_CHAT_SOCKET = null;

function chatWsUrl() {
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  return proto + location.host + "/chat?room=SITE";
}

export function getChatSocket() {
  if (SWN_CHAT_SOCKET && (SWN_CHAT_SOCKET.readyState === 0 || SWN_CHAT_SOCKET.readyState === 1)) {
    return SWN_CHAT_SOCKET;
  }
  SWN_CHAT_SOCKET = new WebSocket(chatWsUrl());
  return SWN_CHAT_SOCKET;
}
