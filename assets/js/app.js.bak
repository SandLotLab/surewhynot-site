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
      <a href="/pages/race.html"${active==="race" ? ' style="text-decoration:underline;"' : ""}>TypeRace</a>
      <a href="/pages/chat.html"${active==="chat" ? ' style="text-decoration:underline;"' : ""}>Chat</a>
      <a href="/pages/fax.html"${active==="fax" ? ' style="text-decoration:underline;"' : ""}>Fax</a>
      <a href="/pages/about.html"${active==="about" ? ' style="text-decoration:underline;"' : ""}>About</a>
    </div>
  `;
  const mount = document.querySelector("[data-topbar]") || document.body;
  mount.prepend(host);
}
