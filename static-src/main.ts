// Hollow Creek — standalone static client (GitHub Pages / Newgrounds).
// Talks to the authoritative server over the same HTTP API as the Next client;
// reuses the canvas Renderer and generative AudioDirector unchanged.
import { Renderer } from "../src/game/render";
import { AudioDirector } from "../src/game/audio";
import { BELL_X } from "../src/game/types";
import type { RoomListing, Snapshot } from "../src/game/types";

const DEFAULT_SERVER = "https://3000-irlhq619hi9cpbud4mpec.e2b.app";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
let server = (params.get("server") || localStorage.getItem("hc_server") || "").replace(/\/$/, "");
if (!server) {
  // served from our own origin (/play) → same origin; hosted elsewhere → default
  server = /github\.io$/.test(location.hostname) || location.protocol === "file:" ? DEFAULT_SERVER : location.origin;
}
function getPid(): string {
  let pid = localStorage.getItem("hc_pid");
  if (!pid) { pid = crypto.randomUUID(); localStorage.setItem("hc_pid", pid); }
  return pid;
}

let snap: Snapshot | null = null;
let roomCode = "";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let roomsTimer: ReturnType<typeof setInterval> | null = null;
let lastPhase = "lobby";
let overlayKey = "";
const keys = new Set<string>();
let lastDir = 0;
const displayX = new Map<string, number>();
const audio = new AudioDirector();
let tasksOpen = window.innerWidth > 640;

async function api(path: string, body?: unknown): Promise<any> {
  const res = await fetch(server + path, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return res.json();
}
function toast(msg: string) {
  const t = $("toast"); t.textContent = msg; t.style.display = "block";
  setTimeout(() => { t.style.display = "none"; }, 2200);
}
async function send(payload: Record<string, unknown>) {
  try {
    const d = await api("/api/game/input", { code: roomCode, playerId: getPid(), ...payload });
    if (d && d.ok === false && d.error) toast(d.error);
  } catch { /* next poll resyncs */ }
}

// ---------------------------------------------------------------- menu ----
function initMenu() {
  $("name").setAttribute("value", localStorage.getItem("hc_name") ?? "");
  ($("name") as HTMLInputElement).value = localStorage.getItem("hc_name") ?? "";
  ($("server") as HTMLInputElement).value = server;
  ($("fullsite") as HTMLAnchorElement).href = server + "/";
  $("server").addEventListener("change", () => {
    server = ($("server") as HTMLInputElement).value.trim().replace(/\/$/, "") || DEFAULT_SERVER;
    localStorage.setItem("hc_server", server);
    ($("fullsite") as HTMLAnchorElement).href = server + "/";
    void refreshRooms();
  });
  $("create").addEventListener("click", async () => {
    saveName();
    try {
      const d = await api("/api/game/create", { playerId: getPid(), name: nameVal() });
      if (d.code) enterRoom(d.code); else menuErr(d.error ?? "Failed");
    } catch { menuErr("Cannot reach the town server. Check the Server field."); }
  });
  const joinCode = async (c: string) => {
    c = c.trim().toUpperCase();
    if (c.length < 4) { menuErr("Enter the 4-letter town code."); return; }
    saveName();
    try {
      const d = await api("/api/game/join", { code: c, playerId: getPid(), name: nameVal() });
      if (d.ok) { if (d.playerId) localStorage.setItem("hc_pid", d.playerId); enterRoom(c); }
      else menuErr(d.error ?? "Failed to join");
    } catch { menuErr("Cannot reach the town server. Check the Server field."); }
  };
  $("join").addEventListener("click", () => joinCode(($("code") as HTMLInputElement).value));
  $("code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinCode(($("code") as HTMLInputElement).value); });
  $("rooms").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("[data-code]") as HTMLElement | null;
    if (b) joinCode(b.dataset.code!);
  });
  void refreshRooms();
  roomsTimer = setInterval(refreshRooms, 3000);
  const rc = params.get("room");
  if (rc) joinCode(rc);
}
function nameVal() { return ($("name") as HTMLInputElement).value.trim() || "Stranger"; }
function saveName() { localStorage.setItem("hc_name", nameVal()); }
function menuErr(m: string) { const e = $("menuerr"); e.textContent = m; e.style.display = "block"; }
async function refreshRooms() {
  if ($("menu").style.display === "none") return;
  try {
    const d = await api("/api/game/rooms");
    const rooms: RoomListing[] = d.rooms ?? [];
    $("rooms").innerHTML = rooms.length === 0
      ? `<p class="muted">No towns on the map yet. Found one, and others will find you.</p>`
      : rooms.map((r) => {
        const phase = r.phase === "lobby" ? "gathering at dusk" : r.phase === "meeting" ? "the bell tolls" : r.phase === "ended" ? "the tale ended" : `night ${r.round || 1} has fallen`;
        const btn = r.phase === "lobby"
          ? `<button data-code="${r.code}" ${r.playerCount >= 10 ? "disabled" : ""}>${r.playerCount >= 10 ? "Full" : "Join"}</button>`
          : r.phase === "ended"
            ? `<button class="ghost" data-code="${r.code}">Return</button>`
            : `<span class="meta" style="flex:0">in progress</span>`;
        return `<div class="room"><div><div class="code">${r.code}</div><div class="meta">${phase}</div></div><div class="meta">${r.playerCount}/10 · ${r.names.slice(0, 4).map(esc).join(", ")}</div>${btn}</div>`;
      }).join("");
  } catch {
    $("rooms").innerHTML = `<p class="muted">The map is unreadable — is the server awake?</p>`;
  }
}
function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }

// ---------------------------------------------------------------- room ----
function enterRoom(code: string) {
  roomCode = code;
  $("menu").style.display = "none";
  $("game").style.display = "block";
  if (roomsTimer) { clearInterval(roomsTimer); roomsTimer = null; }
  history.replaceState(null, "", `${location.pathname}?room=${code}${params.get("server") ? `&server=${encodeURIComponent(server)}` : ""}`);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, 100);
  void poll();
}
function leaveToMenu() {
  void send({ dir: 0, interactHeld: false });
  beaconLeave();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  snap = null; roomCode = ""; overlayKey = "";
  $("game").style.display = "none";
  $("menu").style.display = "block";
  history.replaceState(null, "", location.pathname);
  void refreshRooms();
  roomsTimer = setInterval(refreshRooms, 3000);
}
function beaconLeave() {
  if (!roomCode) return;
  try {
    navigator.sendBeacon(server + "/api/game/leave", new Blob([JSON.stringify({ code: roomCode, playerId: getPid() })], { type: "application/json" }));
  } catch { /* noop */ }
}
window.addEventListener("pagehide", beaconLeave);

async function poll() {
  try {
    const s = (await api(`/api/game/state?code=${roomCode}&playerId=${getPid()}`)) as Snapshot & { error?: string };
    if (s.error || !s.self) return;
    snap = s;
    audio.update(s);
    if (lastPhase === "lobby" && s.phase === "playing") reveal(s.self.role === "hollow");
    lastPhase = s.phase;
    renderHud(s);
  } catch { /* retry */ }
}
function reveal(hollow: boolean) {
  const r = $("reveal");
  r.querySelector(".r1")!.textContent = hollow ? "You are Hollow" : "Townfolk";
  (r.querySelector(".r1") as HTMLElement).style.color = hollow ? "#ff4a3a" : "#a8c98a";
  r.querySelector(".r2")!.textContent = hollow ? "Wear their faces. Kill when none watch. Q to strike, F to snuff the lights." : "Finish the town's wards. Find the key. Trust no one.";
  r.style.display = "flex";
  setTimeout(() => { r.style.display = "none"; }, 4500);
}

// ----------------------------------------------------------------- HUD ----
function renderHud(s: Snapshot) {
  const me = s.players.find((p) => p.id === s.self.id);
  $("copycode").textContent = s.code;
  $("soulcount").textContent = `${s.playerCount} souls`;
  const role = $("role");
  role.textContent = (!s.self.alive ? "Ghost" : s.self.role === "hollow" ? "The Hollow" : "Townfolk") + (s.self.caged && s.self.alive ? " · Caged" : "");
  role.className = !s.self.alive ? "ghost" : s.self.role;
  $("taskfill").style.width = `${s.taskBar.total ? (100 * s.taskBar.done) / s.taskBar.total : 0}%`;

  // tasks
  const tasks = $("tasks");
  if (s.phase !== "lobby" && s.self.alive && s.tasks.length) {
    tasks.style.display = "block";
    tasks.innerHTML = `<div class="hd" id="tasktoggle">${s.self.role === "hollow" ? "Town wards (pretend)" : "Town wards · shared"} ${tasksOpen ? "▾" : "▸"}</div>` +
      (tasksOpen ? s.tasks.map((t) => `<div class="t ${t.done ? "done" : ""}">${t.done ? "✓" : "•"} ${esc(t.name)}${!t.done && t.progress > 0 ? ` <span style="color:var(--amber)">${Math.round(t.progress * 100)}%</span>` : ""}</div>`).join("") : "");
  } else tasks.style.display = "none";

  // feed
  $("feed").innerHTML = s.feed.slice(-4).map((f, i) => `<p style="opacity:${0.4 + i * 0.2}">${esc(f.text)}</p>`).join("");

  // meeting banner + vote
  const banner = $("banner"), vote = $("vote");
  if (s.phase === "meeting" && s.meeting) {
    const secs = Math.max(0, Math.ceil((s.meeting.endsAt - s.now) / 1000));
    banner.style.display = "block";
    banner.querySelector(".why")!.textContent = `🔔 ${s.meeting.reason}`;
    banner.querySelector(".sub")!.innerHTML = s.meeting.inArea
      ? `Cast your verdict — <b>${secs}s</b>`
      : `Walk to the town square ${me && me.x < BELL_X ? "→ east" : "← west"} — <b>${secs}s</b>`;
    if (s.meeting.inArea && s.self.alive) {
      vote.style.display = "block";
      const opts = [
        ...s.players.filter((p) => p.alive && !p.caged && p.id !== s.self.id).map((p) => ({ key: p.id, label: `Cage ${p.name}`, color: p.color })),
        ...s.players.filter((p) => p.caged).map((p) => ({ key: `free:${p.id}`, label: `Free ${p.name}`, color: "#7fb069" })),
        { key: "skip", label: "Abstain", color: "#7f8c8d" },
      ];
      vote.innerHTML = `<h3>The Verdict</h3>` + opts.map((o) =>
        `<button data-vote="${o.key}" class="${s.self.myVote === o.key ? "mine" : ""}" ${s.self.myVote ? "disabled" : ""}><span class="dot" style="background:${o.color}"></span>${esc(o.label)}</button>`
      ).join("") + `<div class="note">${s.self.myVote ? "Verdict cast. Wait for the toll." : "Most votes: caged in the square. Free the caged by vote or iron key."}</div>`;
    } else vote.style.display = "none";
  } else { banner.style.display = "none"; vote.style.display = "none"; }

  // status strip
  const status = $("status");
  if (!s.self.alive && s.phase !== "ended") { status.style.display = "block"; status.textContent = "You are dead. Drift as a ghost — only the dead can see and hear you."; status.style.color = "#99aaaa"; }
  else if (s.self.caged && s.self.alive) { status.style.display = "block"; status.textContent = "The iron is cold. You can still speak and vote — plead for the key."; status.style.color = "var(--amber)"; }
  else status.style.display = "none";

  // vigor
  const st = s.self.stamina;
  $("vigor").style.display = s.self.alive && s.phase !== "lobby" ? "flex" : "none";
  const fill = $("vigorfill");
  fill.style.width = `${Math.round(st * 100)}%`;
  fill.style.background = st <= 0 ? "#e06a5a" : st < 0.3 ? "#d99a3d" : "#6b8e23";
  $("vigorlbl").textContent = s.self.exhausted ? "spent — rest!" : "vigor";
  $("vigorlbl").style.color = s.self.exhausted ? "#e06a5a" : "var(--dim)";

  // controls
  const hint = $("hint");
  hint.style.display = s.hint ? "block" : "none";
  if (s.hint) hint.textContent = s.hint;
  $("ebtn").className = `rbtn ${s.hint ? "hot" : ""}`;
  const ab = $("ability");
  ab.textContent = s.abilityLabel;
  ab.className = `rbtn kill ${s.abilityReady ? "hot" : ""}`;
  ab.style.display = s.self.alive ? "block" : "none";
  const snuff = $("snuffbtn");
  snuff.style.display = s.self.role === "hollow" && s.self.alive && s.phase === "playing" ? "block" : "none";
  snuff.className = `rbtn snuff ${s.self.canBlackout ? "hot" : ""}`;
  $("cd").textContent = s.self.role === "hollow" && s.self.alive
    ? (s.self.killCooldownMs > 0 ? `${Math.ceil(s.self.killCooldownMs / 1000)}s` : "") + (s.self.blackoutCooldownMs > 0 ? ` 🌑${Math.ceil(s.self.blackoutCooldownMs / 1000)}s` : "")
    : "";

  // overlays (lobby / end) — rebuild only when changed
  const key = JSON.stringify([s.phase, s.players.map((p) => [p.id, p.name, p.isHost]), s.self.id === s.hostId, s.round, s.winner, s.playerCount]);
  if (key !== overlayKey) {
    overlayKey = key;
    const ov = $("overlay"), panel = $("overlaypanel");
    if (s.phase === "lobby") {
      ov.style.display = "flex";
      panel.innerHTML = `
        <h2>${s.round > 0 ? `Night ${s.round + 1} approaches` : "Gathering at dusk"}</h2>
        <p class="muted" style="margin-top:4px">${s.round > 0 ? "The same souls, the same street — new roles when darkness falls" : "Share the town code with your fellow townsfolk"}</p>
        <div class="bigcode">${s.code}</div>
        <div class="roster">${s.players.map((p) => `<div class="seat"><span class="dot" style="background:${p.color}"></span><span>${esc(p.name)}</span>${p.isHost ? `<span class="host">host</span>` : ""}</div>`).join("")}</div>
        ${s.self.id === s.hostId
          ? `<button class="big" data-act="start" ${s.playerCount < 4 ? "disabled" : ""}>${s.playerCount < 4 ? "Waiting for more souls… (min 4)" : "Let night fall"}</button>`
          : `<p class="muted" style="margin-top:16px">Waiting for the host to let night fall…</p>`}
        <p class="muted">4–10 players · 1–2 of you will be Hollow</p>`;
    } else if (s.phase === "ended") {
      ov.style.display = "flex";
      panel.innerHTML = `
        <h2 style="color:${s.winner === "hollow" ? "#ff4a3a" : "#a8c98a"};font-size:44px">${s.winner === "hollow" ? "The Hollow wins" : "The town survives"}</h2>
        <p style="margin-top:12px;font-style:italic;color:#c9b8a4">${esc(s.winReason ?? "")}</p>
        ${s.self.id === s.hostId ? `<button class="big" data-act="restart">Gather the same souls again</button>` : `<p class="muted" style="margin-top:14px">The lantern-bearer may gather this town for another night…</p>`}
        <div class="row" style="margin-top:12px;justify-content:center;gap:10px">
          <button class="chip" data-act="menu">Other towns</button>
          <a class="chip" href="${server}/chronicle/${s.code}" target="_blank" style="text-decoration:none">Chronicle</a>
          <a class="chip" href="${server}/stats" target="_blank" style="text-decoration:none">Records</a>
        </div>`;
    } else ov.style.display = "none";
  }
}

// -------------------------------------------------------------- inputs ----
function computeDir() {
  const d = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
  if (d !== lastDir) { lastDir = d; void send({ dir: d }); }
}
function chatOpen() { return $("chatbox").style.display === "block"; }
function openChat() {
  $("chatbox").style.display = "block";
  setTimeout(() => $("chatinput").focus(), 30);
}
function submitChat() {
  const inp = $("chatinput") as HTMLInputElement;
  if (inp.value.trim()) void send({ chat: inp.value.trim() });
  inp.value = "";
  $("chatbox").style.display = "none";
  inp.blur();
}
window.addEventListener("keydown", (e) => {
  audio.start();
  if (!roomCode) return;
  if (chatOpen()) { if (e.key === "Escape") { $("chatbox").style.display = "none"; ($("chatinput") as HTMLInputElement).blur(); } return; }
  if ((e.target as HTMLElement)?.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a") { keys.add("left"); computeDir(); e.preventDefault(); }
  else if (k === "arrowright" || k === "d") { keys.add("right"); computeDir(); e.preventDefault(); }
  else if (k === "e" && !e.repeat) void send({ action: "interact", interactHeld: true });
  else if ((k === "q" || k === " ") && !e.repeat) { void send({ action: "ability" }); e.preventDefault(); }
  else if (k === "f" && !e.repeat) void send({ action: "blackout" });
  else if (k === "enter") { openChat(); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a") { keys.delete("left"); computeDir(); }
  else if (k === "arrowright" || k === "d") { keys.delete("right"); computeDir(); }
  else if (k === "e") void send({ interactHeld: false });
});
$("chatinput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitChat(); e.stopPropagation(); });
$("chatinput").addEventListener("blur", () => setTimeout(submitChat, 50));
window.addEventListener("pointerdown", () => audio.start());

// hold buttons (movement + E)
document.querySelectorAll<HTMLElement>("[data-hold]").forEach((b) => {
  const what = b.dataset.hold!;
  const on = (e: Event) => {
    e.preventDefault();
    if (what === "e") void send({ action: "interact", interactHeld: true });
    else { keys.add(what); computeDir(); }
  };
  const off = () => {
    if (what === "e") void send({ interactHeld: false });
    else { keys.delete(what); computeDir(); }
  };
  b.addEventListener("pointerdown", on);
  b.addEventListener("pointerup", off);
  b.addEventListener("pointerleave", off);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
});
$("ability").addEventListener("click", () => send({ action: "ability" }));
$("snuffbtn").addEventListener("click", () => send({ action: "blackout" }));
$("talkbtn").addEventListener("click", openChat);
$("leave").addEventListener("click", leaveToMenu);
$("mute").addEventListener("click", () => {
  audio.start();
  audio.setMuted(!audio.muted);
  $("mute").textContent = audio.muted ? "🔇" : "🔊";
});
$("mute").textContent = audio.muted ? "🔇" : "🔊";
$("copycode").addEventListener("click", () => { void navigator.clipboard?.writeText(roomCode); toast("Town code copied"); });
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const act = t.closest("[data-act]") as HTMLElement | null;
  if (act) {
    if (act.dataset.act === "start") void send({ action: "start" });
    else if (act.dataset.act === "restart") void send({ action: "restart" });
    else if (act.dataset.act === "menu") leaveToMenu();
  }
  const v = t.closest("[data-vote]") as HTMLElement | null;
  if (v) void send({ action: "vote", vote: v.dataset.vote });
  if (t.closest("#tasktoggle")) { tasksOpen = !tasksOpen; if (snap) renderHud(snap); }
});

// -------------------------------------------------------------- canvas ----
const canvas = $("cv") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const renderer = new Renderer();
const vw = () => window.visualViewport?.width ?? window.innerWidth;
const vh = () => window.visualViewport?.height ?? window.innerHeight;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = vw() * dpr; canvas.height = vh() * dpr;
  canvas.style.width = `${vw()}px`; canvas.style.height = `${vh()}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
let last = performance.now();
function loop(nowMs: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;
  if (!snap || $("game").style.display === "none") return;
  for (const p of snap.players) {
    const cur = displayX.get(p.id);
    if (cur === undefined || Math.abs(cur - p.x) > 300) displayX.set(p.id, p.x);
    else displayX.set(p.id, cur + (p.x - cur) * Math.min(1, dt * 10));
  }
  renderer.render(ctx, vw(), vh(), snap, displayX, nowMs / 1000, dt);
}
requestAnimationFrame(loop);

initMenu();