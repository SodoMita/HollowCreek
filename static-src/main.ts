// Hollow Creek — standalone static client (GitHub Pages / Newgrounds).
// Talks to the authoritative server over the same HTTP API as the Next client;
// reuses the canvas Renderer and generative AudioDirector unchanged.
import { Renderer, ZOOM_MAX, ZOOM_READ } from "../src/game/render";
import { WardPanel } from "../src/game/ward-ui";
import { TimePanel } from "../src/game/time-ui";
import { AudioDirector } from "../src/game/audio";
import { VoiceChat, type VoiceStatus } from "../src/game/voice";
import { SettingsStore, applyDocumentPreferences, keyLabel, matchesControl, type BindableAction } from "../src/game/settings";
import { SettingsDialog } from "../src/game/settings-ui";
import type { RoomListing, Snapshot } from "../src/game/types";
import { applyFrame, type WireFrame } from "../src/game/wire";
import { RoomHud, esc } from "./hud";

// Temporary author-built sandboxes run the same unified code (see SYNC.md).
// The menu probes them in order; room-code joins also discover the backend
// that owns the town and then stay pinned there. Use one server in production.
const SERVERS = [
  "https://3000-iv1ax3jjgiz1x3ha95746.e2b.app",
  "https://3000-ihrqg7gfricyapy48j4hv.e2b.app",
  "https://3000-irlhq619hi9cpbud4mpec.e2b.app",
];
const DEFAULT_SERVER = SERVERS[0];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
let server = (params.get("server") || localStorage.getItem("hc_server") || "").replace(/\/$/, "");
let mustProbe = false;
// Uploaded HTML builds run in a portal-owned iframe. That origin hosts only
// the static files; it is never the authoritative Hollow Creek server.
const externalStaticHost =
  /(^|\.)github\.io$/.test(location.hostname) ||
  /(^|\.)itch\.zone$/.test(location.hostname) ||
  /(^|\.)ungrounded\.net$/.test(location.hostname) ||
  location.protocol === "file:";
if (!server) {
  if (externalStaticHost) {
    server = DEFAULT_SERVER;
    mustProbe = true;
  } else {
    server = location.origin; // served from /play on a town server itself
  }
}
let probeEpoch = 0;
function cancelProbe() { probeEpoch++; }
function bindServer(s: string) {
  server = s.replace(/\/$/, "");
  ($("server") as HTMLInputElement).value = server;
  ($("fullsite") as HTMLAnchorElement).href = "records.html";
  if ($("tutoriallink")) ($("tutoriallink") as HTMLAnchorElement).href = "tutorial.html";
}
async function probeServers() {
  const epoch = ++probeEpoch;
  for (const s of [server, ...SERVERS.filter((x) => x !== server)]) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3500);
      const r = await fetch(s + "/api/health", { signal: ctl.signal });
      clearTimeout(t);
      // A create/join clicked while this probe was in flight pins the server.
      // Never change it after that request has succeeded.
      if (epoch !== probeEpoch) return;
      if (r.ok) {
        bindServer(s);
        void refreshRooms();
        return;
      }
    } catch { /* try the next town server */ }
  }
  if (epoch === probeEpoch) menuErr("No town server is awake. Set one under Server (advanced).");
}
function getPid(): string {
  let pid = localStorage.getItem("hc_pid");
  if (!pid) { pid = crypto.randomUUID(); localStorage.setItem("hc_pid", pid); }
  return pid;
}

let snap: Snapshot | null = null;
let roomCode = "";
let gameVisible = false;
let roomsTimer: ReturnType<typeof setInterval> | null = null;
let streamEpoch = 0;
let eventSource: EventSource | null = null;
let pollAbort: AbortController | null = null;
let pollFailures = 0;
let pollBackoffMs = 0;
let roomError = "";
let lastPhase = "lobby";
const keys = new Set<string>();
let lastDir = 0;
const displayX = new Map<string, number>();
const steerState = { dir: 0, cartHeld: false, interactHeld: false };
let steerInFlight = false;
let steerQueued = false;
const netStats = { rttMs: 40, droppedInputs: 0, lastPosAt: 0, gaps: [] as number[], renderFrames: 0 };
const showNet = params.get("net") === "1";
let netEl: HTMLElement | null = null;
let lastAudioAt = 0;
let audioEdgeKey = "";
let held: Snapshot | null = null; // what the server thinks we hold (deltas merge into it)
let lastPollAt = 0;
let heldRev = "";
const settingsStore = new SettingsStore();
const audio = new AudioDirector(settingsStore);
let lastVoiceKey = "";
const voice = new VoiceChat({ baseUrl: () => server, roomCode: () => roomCode,
  playerId: getPid, getSettings: () => settingsStore.value, onStatus: updateVoiceHud });
function updateVoiceHud(status: VoiceStatus) {
  $("voicebtn").textContent = status.starting ? "…" : status.speaking ? "🗣" : status.active ? "◉" : "🎙";
  $("voicebtn").setAttribute("aria-label", status.active ? "Leave proximity voice" : "Join proximity voice");
  $("voicebtn").title = status.active
    ? `Voice: ${status.connected} in earshot (${status.p2pCount} P2P, ${status.relayCount} Relay) · ${status.speaking ? "Speaking" : "Listening"} · ${keyLabel(settingsStore.value.controls.talk)} to leave`
    : `Join proximity voice (${keyLabel(settingsStore.value.controls.talk)}) · microphone permission`;
  $("micmute").style.display = status.active ? "inline-block" : "none";
  $("micmute").textContent = status.muted ? "🔇" : "🎙";
  $("micmute").title = status.muted ? "Unmute microphone" : "Mute microphone";
  $("voicestatus").style.display = status.error && roomCode ? "block" : "none";
  $("voicestatus").innerHTML = status.error
    ? `${esc(status.error)}${status.error.includes("Enable sound") ? ` <button data-act="voiceplay" style="text-decoration:underline">Enable sound</button>` : ""}` : "";
  const key = JSON.stringify([status.active, status.starting, status.muted, status.speaking, status.p2pCount, status.relayCount, status.error]);
  if (lastVoiceKey !== key) {
    lastVoiceKey = key;
    hud.invalidateOverlay();
    if (snap?.phase === "lobby" || snap?.phase === "ended") renderHud(snap);
  }
  document.querySelectorAll<HTMLElement>("[data-voicepeers]").forEach((label) => {
    label.textContent = `${status.connected} connected (${status.p2pCount} P2P, ${status.relayCount} Server Relay) · ${status.nearby} in earshot${status.speaking ? " · ● Speaking" : ""}`;
  });
}
const hud = new RoomHud();
const wardPanel = new WardPanel(document.body, {
  move: (wardId, move) => { void send({ action: "ward_move", wardId, move }); },
  close: () => { void send({ action: "ward_cancel" }); },
  opened: releaseInputs,
});
const timePanel = new TimePanel(document.body, { travel: (targetAt) => { void send({ action: "time_travel", targetAt }); }, opened: releaseInputs });
let interactToggled = false;
const settingsDialog = new SettingsDialog(settingsStore, document.body, { onOpen: releaseInputs });
settingsStore.subscribe((settings) => {
  applyDocumentPreferences(settings);
  $("mute").textContent = settings.audio.muted ? "🔇" : "🔊";
  voice.applyMix();
});
applyDocumentPreferences(settingsStore.value);

async function api(path: string, body?: unknown, base = server, timeoutMs = 0): Promise<any> {
  const ctl = timeoutMs > 0 ? new AbortController() : undefined;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : undefined;
  const init: RequestInit = body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  };
  if (ctl) init.signal = ctl.signal;
  try {
    const res = await fetch(base + path, init);
    return await res.json();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function toast(msg: string) {
  const t = $("toast"); t.textContent = msg; t.style.display = "block";
  setTimeout(() => { t.style.display = "none"; }, 2200);
}
async function postInput(payload: Record<string, unknown>, retry429 = true): Promise<{ ok: boolean; status: number }> {
  if (!roomCode) return { ok: false, status: 0 };
  const sentAt = performance.now();
  try {
    const res = await fetch(server + "/api/game/input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: roomCode, playerId: getPid(), ...payload }),
    });
    if (res.status === 429 && retry429) {
      await new Promise((r) => setTimeout(r, 80));
      return postInput(payload, false);
    }
    const d = await res.json().catch(() => ({}));
    netStats.rttMs = netStats.rttMs * 0.7 + Math.min(1500, Math.max(5, performance.now() - sentAt)) * 0.3;
    if (d && d.ok === false && d.error) toast(d.error);
    if (!res.ok && res.status !== 400) netStats.droppedInputs++;
    return { ok: res.ok, status: res.status };
  } catch {
    netStats.droppedInputs++;
    return { ok: false, status: 0 };
  }
}

async function flushSteer() {
  if (steerInFlight) { steerQueued = true; return; }
  steerInFlight = true;
  try {
    do {
      steerQueued = false;
      const snapSteer = { dir: steerState.dir, cartHeld: steerState.cartHeld, interactHeld: steerState.interactHeld };
      const r = await postInput(snapSteer, false);
      if (r.status === 429) {
        await new Promise((r2) => setTimeout(r2, 80));
        steerQueued = true; // resend freshest steering state
      }
    } while (steerQueued && roomCode);
  } finally {
    steerInFlight = false;
  }
}

async function send(payload: Record<string, unknown>) {
  await postInput(payload, true);
}

// ---------------------------------------------------------------- menu ----
function initMenu() {
  $("name").setAttribute("value", localStorage.getItem("hc_name") ?? "");
  ($("name") as HTMLInputElement).value = localStorage.getItem("hc_name") ?? "";
  ($("server") as HTMLInputElement).value = server;
  ($("fullsite") as HTMLAnchorElement).href = "records.html";
  if ($("tutoriallink")) ($("tutoriallink") as HTMLAnchorElement).href = "tutorial.html";
  $("server").addEventListener("change", () => {
    cancelProbe();
    bindServer(($("server") as HTMLInputElement).value.trim() || DEFAULT_SERVER);
    localStorage.setItem("hc_server", server);
    void refreshRooms();
  });
  $("create").addEventListener("click", async () => {
    cancelProbe();
    saveName();
    try {
      const d = await api("/api/game/create", { playerId: getPid(), name: nameVal() }, server, 8000);
      if (d.code) enterRoom(d.code); else menuErr(d.error ?? "Failed");
    } catch { menuErr("Cannot reach the town server. Check the Server field."); }
  });
  let joinInFlight = false;
  const joinCode = async (c: string) => {
    c = c.trim().toUpperCase();
    if (c.length < 4) { menuErr("Enter the 4-letter town code."); return; }
    if (joinInFlight) return;
    joinInFlight = true;
    cancelProbe();
    saveName();
    $("menuerr").style.display = "none";
    let lastError = "Cannot reach the town server. Check the Server field.";
    try {
      // A room code identifies a town, not whichever backend this browser
      // happened to probe first. If it is unknown here, locate it on the other
      // configured backends. Once accepted, pin every poll to that backend.
      const candidates = [server, ...SERVERS.filter((x) => x !== server)];
      for (const candidate of candidates) {
        try {
          const d = await api("/api/game/join", { code: c, playerId: getPid(), name: nameVal() }, candidate, 6000);
          if (d.ok) {
            if (d.playerId) localStorage.setItem("hc_pid", d.playerId);
            bindServer(candidate);
            enterRoom(c);
            return;
          }
          lastError = d.error ?? "Failed to join";
          // Full/begun rooms are authoritative answers, not a reason to try
          // a coincidentally identical code on another backend.
          if (!/no such town/i.test(lastError)) break;
        } catch { /* try the next backend */ }
      }
      menuErr(lastError);
    } finally {
      joinInFlight = false;
    }
  };
  $("join").addEventListener("click", () => joinCode(($("code") as HTMLInputElement).value));
  $("code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinCode(($("code") as HTMLInputElement).value); });
  $("rooms").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("[data-code]") as HTMLElement | null;
    if (b) joinCode(b.dataset.code!);
  });
  void refreshRooms();
  roomsTimer = setInterval(refreshRooms, 3000);
  if (mustProbe) void probeServers();
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

// ---------------------------------------------------------------- room ----
function stopStream() {
  streamEpoch++;
  if (eventSource) { eventSource.close(); eventSource = null; }
  if (pollAbort) { pollAbort.abort(); pollAbort = null; }
}

function enterRoom(code: string) {
  voice.stop();
  cancelProbe();
  stopStream();
  roomCode = code;
  held = null; heldRev = ""; steerQueued = false;
  steerState.dir = 0; steerState.cartHeld = false; steerState.interactHeld = false;
  netStats.gaps.length = 0; netStats.lastPosAt = 0; netStats.droppedInputs = 0;
  displayX.clear();
  snap = null;
  wardPanel.update(null, 1, false);
  roomError = "";
  pollFailures = 0; pollBackoffMs = 0;
  hud.invalidateOverlay();
  $("overlay").style.display = "none";
  $("menu").style.display = "none";
  $("game").style.display = "block";
  gameVisible = true;
  resize();
  if (roomsTimer) { clearInterval(roomsTimer); roomsTimer = null; }
  // Preserve the backend that actually accepted the join. A refresh must not
  // probe a different server and turn a valid room into an empty screen.
  history.replaceState(null, "", `${location.pathname}?room=${code}&server=${encodeURIComponent(server)}`);
  startStream(code);
}
function leaveToMenu() {
  voice.stop();
  releaseInputs();
  stopStream();
  const departingCode = roomCode;
  const departingServer = server;
  if (departingCode) {
    void api("/api/game/leave", { code: departingCode, playerId: getPid() }, departingServer, 5000)
      .catch(() => {
        try { navigator.sendBeacon(departingServer + "/api/game/leave",
          new Blob([JSON.stringify({ code: departingCode, playerId: getPid() })], { type: "application/json" })); }
        catch { /* still return to the menu */ }
      }).finally(() => { if ($("menu").style.display !== "none") void refreshRooms(); });
  }
  snap = null; roomCode = ""; hud.invalidateOverlay(); roomError = ""; pollFailures = 0; pollBackoffMs = 0; held = null; heldRev = ""; lowerGlass();
  steerQueued = false; steerState.dir = 0; steerState.cartHeld = false; steerState.interactHeld = false;
  displayX.clear();
  wardPanel.update(null, 1, false);
  $("game").style.display = "none";
  gameVisible = false;
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
window.addEventListener("pagehide", () => voice.stop());

function showRoomError(message: string) {
  if (roomError === message) return;
  roomError = message;
  hud.invalidateOverlay();
  $("overlay").style.display = "flex";
  $("overlaypanel").innerHTML = `
    <h2>Cannot enter the town</h2>
    <p class="muted" style="margin-top:12px">${esc(message)}</p>
    <div class="row" style="margin-top:16px;justify-content:center">
      <button class="chip" data-act="menu" style="border-color:#84624c;padding:10px 12px;flex:1">← Back to towns</button>
    </div>`;
}
function ingestFrame(frame: WireFrame & { error?: string }) {
  if (frame.error) { showRoomError(frame.error); return; }
  if (frame.gone) { held = null; heldRev = ""; return; }
  // Bare clock tick `{ now }` with no state diff.
  if (!frame.snap && !frame.delta && !frame.patch) {
    if (snap) {
      snap.now = frame.now;
      lastPollAt = performance.now();
      hud.renderCountdowns(snap);
    }
    return;
  }
  const prevHeld = held;
  const s = applyFrame(held, frame);
  if (!s || !s.self) { held = null; heldRev = ""; return; }
  const now = performance.now();
  lastPollAt = now;
  held = s;
  heldRev = frame.etag ?? heldRev;

  // Record real position-frame cadence and sync authoritative server positions directly
  // without client-side prediction or artificial interpolation delay.
  if (frame.snap || frame.patch?.players || frame.delta?.players !== undefined) {
    if (netStats.lastPosAt > 0) {
      netStats.gaps.push(now - netStats.lastPosAt);
      if (netStats.gaps.length > 40) netStats.gaps.shift();
    }
    netStats.lastPosAt = now;
  }
  for (const p of s.players) displayX.set(p.id, p.x);
  if (displayX.size > s.players.length) {
    for (const id of displayX.keys()) if (!s.players.some((p) => p.id === id)) displayX.delete(id);
  }

  pollFailures = 0;
  pollBackoffMs = 0;
  roomError = "";
  snap = s;
  if (timePanel.isOpen && (!s.self.hasTimepiece || s.phase !== "playing")) timePanel.close();
  wardPanel.update(s.minigame, s.self.stamina, s.self.exhausted);
  const edgeKey = `${s.phase}|${s.taskBar?.done ?? 0}|${s.self.alive ? 1 : 0}|${s.bellAt}|${s.blackoutUntil}`;
  if (edgeKey !== audioEdgeKey || now - lastAudioAt >= 120) {
    audioEdgeKey = edgeKey;
    lastAudioAt = now;
    audio.update(s);
  }
  if (lastPhase === "lobby" && s.phase === "playing") reveal(s.self.role === "hollow");
  lastPhase = s.phase;
  renderHud(s);
}

function startStream(code: string) {
  const myEpoch = ++streamEpoch;
  if (typeof EventSource === "undefined") { void pollLoop(code, myEpoch); return; }
  let gotFrame = false;
  const es = new EventSource(`${server}/api/game/state/stream?code=${code}&playerId=${encodeURIComponent(getPid())}`);
  eventSource = es;
  es.onmessage = (ev) => {
    if (myEpoch !== streamEpoch || code !== roomCode) { es.close(); return; }
    gotFrame = true;
    try { ingestFrame(JSON.parse(ev.data) as WireFrame & { error?: string }); } catch { /* ignore bad frame */ }
  };
  es.onerror = () => {
    if (myEpoch !== streamEpoch || code !== roomCode) { es.close(); return; }
    // If SSE fails before opening or disconnects twice, switch cleanly to zero-gap long-poll.
    if (!gotFrame || ++pollFailures >= 2) {
      es.close();
      if (eventSource === es) eventSource = null;
      void pollLoop(code, myEpoch);
    }
  };
}

/** Zero-gap continuous long-poll fallback when SSE is unavailable. */
async function pollLoop(code: string, myEpoch: number) {
  while (myEpoch === streamEpoch && code === roomCode) {
    const rev = held && heldRev ? `&rev=${encodeURIComponent(heldRev)}` : "";
    const ctl = new AbortController();
    pollAbort = ctl;
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const res = await fetch(`${server}/api/game/state?code=${code}&playerId=${getPid()}&delta=1&wait=1${rev}`, { signal: ctl.signal });
      clearTimeout(timer);
      if (myEpoch !== streamEpoch || code !== roomCode) return;
      if (res.status === 304) {
        const now = performance.now();
        if (snap && lastPollAt) snap.now += now - lastPollAt;
        lastPollAt = now;
        if (snap) hud.renderCountdowns(snap);
        pollFailures = 0;
        pollBackoffMs = 0;
        continue;
      }
      if (!res.ok) {
        if (++pollFailures >= 5) showRoomError("The town server is not answering. Retrying…");
        pollBackoffMs = pollBackoffMs ? Math.min(4000, pollBackoffMs * 2) : 100;
        await new Promise((r) => setTimeout(r, pollBackoffMs));
        continue;
      }
      const frame = (await res.json()) as WireFrame & { error?: string };
      if (myEpoch !== streamEpoch || code !== roomCode) return;
      ingestFrame(frame);
    } catch {
      clearTimeout(timer);
      if (myEpoch !== streamEpoch || code !== roomCode) return;
      if (++pollFailures >= 5) showRoomError("The town server is not answering. Retrying…");
      pollBackoffMs = pollBackoffMs ? Math.min(4000, pollBackoffMs * 2) : 100;
      await new Promise((r) => setTimeout(r, pollBackoffMs));
    }
  }
}
function reveal(hollow: boolean) {
  const r = $("reveal");
  r.querySelector(".r1")!.textContent = hollow ? "You are Hollow" : "Townfolk";
  (r.querySelector(".r1") as HTMLElement).style.color = hollow ? "#ff4a3a" : "#a8c98a";
  r.querySelector(".r2")!.textContent = hollow ? `Wear their faces. ${keyLabel(settingsStore.value.controls.ability)} to strike, ${keyLabel(settingsStore.value.controls.blackout)} to snuff, ${keyLabel(settingsStore.value.controls.ruin)} to ruin a repaired ward.` : "Carry kits from the movable cart to broken wards; press E to open a repair puzzle. Find the key.";
  r.style.display = "flex";
  setTimeout(() => { r.style.display = "none"; }, 4500);
}

// ----------------------------------------------------------------- HUD ----
function renderHud(s: Snapshot) { hud.render(s, settingsStore.value, voice.current, server, viewZoom > 1.05); }
// -------------------------------------------------------------- inputs ----
function releaseInputs() {
  keys.clear();
  lastDir = 0;
  interactToggled = false;
  steerState.dir = 0;
  steerState.cartHeld = false;
  steerState.interactHeld = false;
  if (roomCode) void flushSteer();
}
function activateTimepiece() {
  if (snap?.time?.mode === "past") { void send({ action: "time_return" }); return; }
  if (snap?.self.hasTimepiece && snap.time) timePanel.open(snap.time);
}
function stopInteract() {
  interactToggled = false;
  steerState.interactHeld = false;
  if (roomCode) void flushSteer();
}
function interactDown() {
  if (settingsStore.value.controls.interactMode === "toggle") {
    interactToggled = !interactToggled;
    steerState.interactHeld = interactToggled;
    void send({ action: "interact", interactHeld: interactToggled });
  } else {
    steerState.interactHeld = true;
    void send({ action: "interact", interactHeld: true });
  }
}
function interactUp() {
  if (settingsStore.value.controls.interactMode === "hold") stopInteract();
}
function computeDir() {
  const d = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
  if (d !== lastDir) {
    lastDir = d;
    steerState.dir = d;
    void flushSteer();
  }
}
function chatOpen() { return $("chatbox").style.display === "block"; }
function openChat() {
  stopInteract();
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
function bound(action: BindableAction, e: KeyboardEvent) {
  return matchesControl(settingsStore.value.controls, action, e.code);
}
window.addEventListener("keydown", (e) => {
  audio.start();
  if (settingsDialog.isOpen || timePanel.isOpen || !roomCode) return;
  if (wardPanel.isOpen) {
    if (e.code === "Escape") { e.preventDefault(); void send({ action: "ward_cancel" }); }
    return; // Puzzle buttons own Tab, Enter and Space.
  }
  if (chatOpen()) { if (e.key === "Escape") { $("chatbox").style.display = "none"; ($("chatinput") as HTMLInputElement).blur(); } return; }
  if (viewZoom > 1.05) { if (!e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); lowerGlass(); } return; } // the raised glass: any key lowers it
  if (e.code === "KeyZ" && !e.repeat) { e.preventDefault(); toggleGlass(); return; }
  const target = e.target as HTMLElement | null;
  if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
  if (bound("left", e)) { keys.add("left"); computeDir(); e.preventDefault(); }
  else if (bound("right", e)) { keys.add("right"); computeDir(); e.preventDefault(); }
  else if (e.code === "KeyM" && !e.repeat) { activateTimepiece(); e.preventDefault(); }
  else if (e.code === "KeyL" && !e.repeat) { void send({ action: "door_lock" }); e.preventDefault(); }
  else if (bound("interact", e) && !e.repeat) { interactDown(); e.preventDefault(); }
  else if (bound("ability", e) && !e.repeat) { void send({ action: "ability" }); e.preventDefault(); }
  else if (bound("blackout", e) && !e.repeat) { void send({ action: "blackout" }); e.preventDefault(); }
  else if (bound("push", e) && !e.repeat) { steerState.cartHeld = true; void flushSteer(); e.preventDefault(); }
  else if (bound("drop", e) && !e.repeat) { void send({ action: "drop_supply" }); e.preventDefault(); }
  else if (bound("ruin", e) && !e.repeat) { void send({ action: "sabotage" }); e.preventDefault(); }
  else if (bound("chat", e) && !e.repeat) { openChat(); e.preventDefault(); }
  else if (bound("talk", e) && !e.repeat) { if (voice.current.active) voice.stop(); else void voice.start(); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  if (settingsDialog.isOpen || timePanel.isOpen || wardPanel.isOpen || !roomCode) return;
  if (bound("left", e)) { keys.delete("left"); computeDir(); }
  else if (bound("right", e)) { keys.delete("right"); computeDir(); }
  else if (bound("interact", e)) interactUp();
  else if (bound("push", e)) { steerState.cartHeld = false; void flushSteer(); }
});
window.addEventListener("blur", releaseInputs);
$("chatinput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitChat(); e.stopPropagation(); });
$("chatinput").addEventListener("blur", () => setTimeout(submitChat, 50));
window.addEventListener("pointerdown", () => audio.start());

// Pointer-captured touch rocker for ◀ ▶ so mobile thumbs never drop movement
// from small drift, and sliding across the gap switches direction cleanly.
{
  const leftBtn = document.querySelector<HTMLElement>('[data-hold="left"]');
  const rightBtn = document.querySelector<HTMLElement>('[data-hold="right"]');
  const group = leftBtn?.parentElement;
  if (leftBtn && rightBtn && group) {
    let walkPointer: number | null = null;
    const setTouchDir = (dir: "left" | "right" | null) => {
      keys.delete("left"); keys.delete("right");
      if (dir) keys.add(dir);
      leftBtn.classList.toggle("active", dir === "left");
      rightBtn.classList.toggle("active", dir === "right");
      computeDir();
    };
    const pickDir = (cx: number, cy: number): "left" | "right" | null => {
      const lb = leftBtn.getBoundingClientRect();
      const rb = rightBtn.getBoundingClientRect();
      const pad = 34;
      if (cy < Math.min(lb.top, rb.top) - pad || cy > Math.max(lb.bottom, rb.bottom) + pad) return null;
      if (cx < lb.left - pad || cx > rb.right + pad) return null;
      return cx <= (lb.right + rb.left) / 2 ? "left" : "right";
    };
    group.addEventListener("pointerdown", (e) => {
      const dir = pickDir(e.clientX, e.clientY);
      if (!dir) return;
      e.preventDefault();
      walkPointer = e.pointerId;
      try { group.setPointerCapture(e.pointerId); } catch { /* noop */ }
      setTouchDir(dir);
    });
    group.addEventListener("pointermove", (e) => {
      if (walkPointer !== e.pointerId) return;
      setTouchDir(pickDir(e.clientX, e.clientY));
    });
    const endTouch = (e: PointerEvent) => {
      if (walkPointer !== e.pointerId) return;
      walkPointer = null;
      setTouchDir(null);
    };
    group.addEventListener("pointerup", endTouch);
    group.addEventListener("pointercancel", endTouch);
    group.addEventListener("lostpointercapture", endTouch);
    group.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}
for (const what of ["e", "push"] as const) {
  const b = document.querySelector<HTMLElement>(`[data-hold="${what}"]`);
  if (!b) continue;
  let activeId: number | null = null;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    activeId = e.pointerId;
    try { b.setPointerCapture(e.pointerId); } catch { /* noop */ }
    b.classList.add("active");
    if (what === "e") interactDown();
    else { steerState.cartHeld = true; void flushSteer(); }
  });
  const off = (e: PointerEvent) => {
    if (activeId !== e.pointerId) return;
    activeId = null;
    b.classList.remove("active");
    if (what === "e") interactUp();
    else { steerState.cartHeld = false; void flushSteer(); }
  };
  b.addEventListener("pointerup", off);
  b.addEventListener("pointercancel", off);
  b.addEventListener("lostpointercapture", off);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}
$("ability").addEventListener("click", () => send({ action: "ability" }));
$("snuffbtn").addEventListener("click", () => send({ action: "blackout" }));
$("talkbtn").addEventListener("click", openChat);
$("leave").addEventListener("click", leaveToMenu);
$("supplydrop").addEventListener("click", () => void send({ action: "drop_supply" }));
let noteFocusX: number | null = null;
$("pinbtn").addEventListener("click", () => { $("pinpanel").style.display = "flex"; ($("pintextarea") as HTMLTextAreaElement).focus(); });
$("pincancel").addEventListener("click", () => { $("pinpanel").style.display = "none"; ($("pintextarea") as HTMLTextAreaElement).value = ""; });
$("pinsubmit").addEventListener("click", () => {
  const text = ($("pintextarea") as HTMLTextAreaElement).value.trim();
  if (!text) return;
  void send({ action: "pin_note", noteText: text });
  ($("pintextarea") as HTMLTextAreaElement).value = "";
  $("pinpanel").style.display = "none";
});
// The glass: a continuous zoom (wheel, trackpad, pinch); the chip and Z snap
// between lowered and the reading zoom, aimed at a nearby page if there is one.
let viewZoom = 1;
function applyZoom(z: number) {
  viewZoom = Math.max(1, Math.min(ZOOM_MAX, z));
  renderer.setViewZoom(viewZoom);
  const up = viewZoom > 1.05;
  if (snap) hud.minimap.update(snap, up);
  $("noteoverlay").style.display = up ? "block" : "none";
  $("readnote").setAttribute("aria-pressed", up ? "true" : "false");
  $("readnote").textContent = up ? "🔭 Lower glass" : "🔭 Spyglass";
  if (!up) { noteFocusX = null; $("notetext").textContent = ""; $("noteauthor").textContent = ""; }
}
function lowerGlass() { applyZoom(1); }
function toggleGlass() {
  if (viewZoom > 1.05) { lowerGlass(); return; }
  const note = (snap?.notes ?? []).find((n) => n.id === ($("readnote").dataset.noteId ?? ""));
  if (note) { noteFocusX = note.x; $("notetext").textContent = note.text; $("noteauthor").textContent = `— pinned by ${note.author}`; }
  applyZoom(ZOOM_READ);
}
$("readnote").addEventListener("click", toggleGlass);
$("noteclose").addEventListener("click", (e) => { e.stopPropagation(); lowerGlass(); });
$("noteoverlay").addEventListener("click", lowerGlass);
{
  const canvas = $("cv") as HTMLCanvasElement;
  canvas.addEventListener("wheel", (e) => {
    if (!roomCode) return;
    e.preventDefault();
    applyZoom(viewZoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  }, { passive: false });
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart = 0, zoomStart = 1;
  const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { pinchStart = dist(); zoomStart = viewZoom; }
  });
  window.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart > 0) applyZoom(zoomStart * dist() / pinchStart);
  });
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = 0; };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
$("ruinbtn").addEventListener("click", () => void send({ action: "sabotage" }));
$("settings").addEventListener("click", () => settingsDialog.open());
$("menusettings").addEventListener("click", () => settingsDialog.open());
$("voicebtn").addEventListener("click", () => { if (voice.current.active) voice.stop(); else void voice.start(); });
$("micmute").addEventListener("click", () => voice.setMuted(!voice.current.muted));
$("doorlock").addEventListener("click", () => { void send({ action: "door_lock" }); });
$("timebtn").addEventListener("click", activateTimepiece);
$("mute").addEventListener("click", () => {
  audio.start();
  audio.setMuted(!audio.muted);
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
    else if (act.dataset.act === "settings") settingsDialog.open();
    else if (act.dataset.act === "voice") { if (voice.current.active) voice.stop(); else void voice.start(); }
    else if (act.dataset.act === "micmute") voice.setMuted(!voice.current.muted);
    else if (act.dataset.act === "voiceplay") void voice.resumePlayback();
  }
  const v = t.closest("[data-vote]") as HTMLElement | null;
  if (v) void send({ action: "vote", vote: v.dataset.vote });
  if (t.closest("#tasktoggle")) { hud.tasksOpen = !hud.tasksOpen; if (snap) renderHud(snap); }
});

// -------------------------------------------------------------- canvas ----
const canvas = $("cv") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
const renderer = new Renderer();
renderer.setSettings(settingsStore.value);
const vw = () => window.visualViewport?.width ?? window.innerWidth;
const vh = () => window.visualViewport?.height ?? window.innerHeight;
let viewW = vw();
let viewH = vh();
function resize() {
  const graphics = settingsStore.value.graphics;
  const dprCap = graphics.quality === "high" ? 1.5 : graphics.quality === "medium" ? 1.25 : 1;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * graphics.resolution;
  viewW = vw();
  viewH = vh();
  canvas.width = Math.max(1, Math.round(viewW * dpr));
  canvas.height = Math.max(1, Math.round(viewH * dpr));
  canvas.style.width = `${viewW}px`; canvas.style.height = `${viewH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
settingsStore.subscribe((settings) => { renderer.setSettings(settings); resize(); });
resize();
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
let last = performance.now();
let netSampleAt = last;
let netSampleFrames = 0;
if (showNet) {
  netEl = document.createElement("div");
  netEl.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:90;background:rgba(13,8,16,.85);border:1px solid #3a2733;border-radius:6px;padding:4px 8px;font:11px/1.35 monospace;color:#d8c9b4;pointer-events:none";
  document.body.appendChild(netEl);
}
function loop(nowMs: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;
  if (!snap || !gameVisible) return;
  netStats.renderFrames++;
  netSampleFrames++;
  if (netEl && nowMs - netSampleAt >= 250) {
    const fps = Math.round((netSampleFrames * 1000) / Math.max(1, nowMs - netSampleAt));
    netSampleAt = nowMs;
    netSampleFrames = 0;
    const sorted = netStats.gaps.slice().sort((a, b) => a - b);
    const p50 = sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.5)]) : 0;
    netEl.textContent = `${fps} fps · rtt ${Math.round(netStats.rttMs)} ms · gap p50 ${p50} ms · drop ${netStats.droppedInputs} · souls ${snap.players.length}`;
  }
  renderer.setFocus(noteFocusX);
  renderer.render(ctx, viewW, viewH, snap, displayX, nowMs / 1000, dt);
}
requestAnimationFrame(loop);

initMenu();