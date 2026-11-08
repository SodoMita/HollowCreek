// Singleplayer school: a fully offline tutorial. No server, no framework.
// All state lives in one object (`s`); the step loop and the canvas loop read it,
// and the HUD is refreshed from it. The game modules are the same ones multiplayer uses.
import { Renderer } from "../src/game/render";
import {
  BUILDINGS, DOOR_REACH, buildingHint, clampWorld, doorX, dropBuildingKeys, newDoors,
  interactWithBuilding, walkThroughBuildings, type DoorState,
} from "../src/game/buildings";
import { WardPanel, morphHtml, renderWardJob } from "../src/game/ward-ui";
import { TimePanel } from "../src/game/time-ui";
import {
  WARD_JOBS, applyWardMove, createWardPuzzle, wardProgress, wardSolved, wardView,
  type WardKind, type WardPuzzle,
} from "../src/game/wards";
import { AudioDirector } from "../src/game/audio";
import { SettingsStore, applyDocumentPreferences, matchesControl } from "../src/game/settings";
import { SettingsDialog } from "../src/game/settings-ui";
import {
  BELL_X, CAGE_UNLOCK_RANGE, CART_PUSH_RANGE, CART_SOLO_SPEED, CARRY_SPEED, CARRY_VIGOR_DRAIN,
  INTERACT_RANGE, SPEED, STAMINA_IDLE_REGEN, STATIONS, GHOST_SPEED, SUPPLY_CART_START,
  TIMEPIECE_X, TIME_VISIT_MS, HISTORY_SAMPLE_MS, type Snapshot, type TaskView,
} from "../src/game/types";
import { mergeReturnedDoors, mergeReturnedTasks } from "./tutorial/tutorial-time";
import { buildTutorialSnapshot } from "./tutorial/tutorial-snapshot";
import { CHAPTERS } from "./tutorial/chapters";
import type { TutorialFrame, TutorialFuture, TutorialVisit } from "./tutorial/tutorial-types";

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

interface Tutorial {
  chapter: number;
  completed: number[];
  toast: string | null;
  toastTimer: ReturnType<typeof setTimeout> | null;
  playerX: number;
  timepieceX: number | null;
  hasTimepiece: boolean;
  actionNotice: { text: string; until: number } | null;
  timeVisit: TutorialVisit | null;
  timeNow: number;
  history: TutorialFrame[];
  future: TutorialFuture | null;
  doors: DoorState[];
  inside: string | null;
  facing: number;
  moving: boolean;
  stamina: number;
  exhausted: boolean;
  hasSupply: boolean;
  hasKey: boolean;
  cartX: number;
  cartHeld: boolean;
  cartPushers: number;
  supplyDrops: number[];
  keyX: number | null;
  cagedNeighbor: boolean;
  danger: number;
  bellAt: number;
  meetingActive: boolean;
  activeWardId: string | null;
  tasks: TaskView[];
  puzzles: Map<string, WardPuzzle>;
  practiceOpen: boolean;
  practiceKind: WardKind;
  practicePuzzle: WardPuzzle | null;
  practicePreviewUntil: number;
  practiceHtml: string;
}

const s: Tutorial = {
  chapter: 1,
  completed: [],
  toast: null,
  toastTimer: null,
  playerX: 480,
  timepieceX: TIMEPIECE_X,
  hasTimepiece: false,
  actionNotice: null,
  timeVisit: null,
  timeNow: 0,
  history: [],
  future: null,
  doors: newDoors(),
  inside: null,
  facing: 1,
  moving: false,
  stamina: 1,
  exhausted: false,
  hasSupply: false,
  hasKey: false,
  cartX: SUPPLY_CART_START,
  cartHeld: false,
  cartPushers: 0,
  supplyDrops: [],
  keyX: 1550,
  cagedNeighbor: true,
  danger: 0,
  bellAt: 0,
  meetingActive: false,
  activeWardId: null,
  tasks: STATIONS.map((st) => ({
    id: st.id, name: st.name, x: st.x, inside: st.inside, done: false,
    delivered: !!st.initialSupplied, sabotaged: false, progress: 0,
  })),
  puzzles: new Map(),
  practiceOpen: false,
  practiceKind: "well",
  practicePuzzle: null,
  practicePreviewUntil: 0,
  practiceHtml: "",
};

const keys = new Set<string>();
let lastDir = 0;
const displayX = new Map<string, number>();
let lastStepTime = 0;
let lastHudAt = 0;

const store = new SettingsStore();
let audio: AudioDirector | null = null;
let settingsDialog: SettingsDialog | null = null;
let timePanel: TimePanel | null = null;
let wardPanel: WardPanel | null = null;
let renderer: Renderer | null = null;

function ensureAudio(): void {
  if (!audio) audio = new AudioDirector(store);
  audio.start();
}

function showToast(msg: string): void {
  if (s.toastTimer) clearTimeout(s.toastTimer);
  s.toast = msg;
  s.toastTimer = setTimeout(() => { s.toast = null; s.toastTimer = null; }, 3200);
}

function showAction(text: string): void {
  s.actionNotice = { text, until: Date.now() + 3500 };
}

function releaseKeys(): void {
  keys.clear();
  lastDir = 0;
  s.moving = false;
  s.cartHeld = false;
}

function menuOpen(): boolean {
  return s.practiceOpen || !!settingsDialog?.isOpen || !!timePanel?.isOpen || !!wardPanel?.isOpen;
}

function advance(next: number): void {
  if (!s.completed.includes(s.chapter)) s.completed.push(s.chapter);
  s.chapter = next;
  showToast(`Completed! Next: ${CHAPTERS[next - 1]?.title ?? "Finish"}`);
}

function endVisit(): void {
  const future = s.future;
  if (!future || !s.timeVisit) return;
  const merged = mergeReturnedTasks(future, s);
  const mergedDoors = mergeReturnedDoors(future, s);
  s.tasks = merged;
  s.doors = mergedDoors;
  s.cartX = future.cartX;
  s.supplyDrops = future.supplyDrops;
  s.hasKey = s.hasKey || future.hasKey;
  s.keyX = s.hasKey ? null : s.keyX !== future.baselineKeyX ? s.keyX : future.keyX;
  s.hasSupply = s.hasSupply || future.hasSupply;
  s.cagedNeighbor = future.baselineCaged && !s.cagedNeighbor ? false : future.cagedNeighbor;
  s.puzzles = future.puzzles;
  s.activeWardId = null;
  wardPanel?.update(null, 1, false);
  releaseKeys();
  s.future = null;
  s.timeVisit = null;
  showToast("You return to the present. Past changes have carried forward.");
}

function beginVisit(targetAt: number): void {
  const frame = [...s.history].reverse().find((item) => item.at <= targetAt) ?? s.history[0];
  if (!frame || !s.hasTimepiece || s.timeVisit) return;
  const futureDoors = structuredClone(s.doors);
  dropBuildingKeys(futureDoors, "me", s.playerX, s.inside);
  const baselineDoors = structuredClone(frame.snapshot.doors ?? newDoors())
    .map((door) => ({ ...door, holder: door.holder === "me" ? "echo:me" : door.holder }));
  s.future = {
    tasks: structuredClone(s.tasks), doors: futureDoors,
    keyX: s.hasKey ? s.playerX : s.keyX, hasKey: false, hasSupply: false,
    supplyDrops: s.hasSupply ? [...s.supplyDrops, s.playerX] : [...s.supplyDrops],
    cartX: s.cartX, cagedNeighbor: s.cagedNeighbor,
    puzzles: structuredClone(s.puzzles), baselineTasks: structuredClone(frame.snapshot.tasks),
    baselineDoors, baselineCaged: !!frame.snapshot.cages[0]?.occupant, baselineKeyX: frame.snapshot.keyX,
  };
  s.tasks = structuredClone(frame.snapshot.tasks);
  s.doors = structuredClone(baselineDoors);
  s.keyX = frame.snapshot.keyX;
  s.cartX = frame.snapshot.cartX;
  s.supplyDrops = [...frame.snapshot.supplyDrops];
  s.cagedNeighbor = !!frame.snapshot.cages[0]?.occupant;
  s.hasKey = false;
  s.hasSupply = false;
  s.puzzles = new Map();
  s.activeWardId = null;
  const now = Date.now();
  s.hasTimepiece = false;
  s.timepieceX = null;
  s.timeVisit = { originAt: frame.at, startedAt: now, endsAt: now + TIME_VISIT_MS };
  s.timeNow = now;
  releaseKeys();
  showToast("The timepiece breaks. You are in the recorded past.");
}

function activateTimepiece(): void {
  if (s.timeVisit) { endVisit(); return; }
  const first = s.history[0];
  const last = s.history[s.history.length - 1];
  if (s.hasTimepiece && first && last) timePanel?.open({ mode: "present", earliest: first.at, latest: last.at });
}

function handleBuilding(action: "interact" | "lock"): boolean {
  const next = s.doors.map((d) => ({ ...d }));
  const result = interactWithBuilding(next, "me", s.playerX, s.inside, action);
  if (!result.handled) return false;
  if (result.message) {
    s.doors = next;
    showToast(result.message);
    if (result.message.startsWith("You found ")) showAction(result.message.replace(/^You found /, "took "));
  }
  if (result.error) showToast(result.error);
  return true;
}

function atTask(t: TaskView): boolean {
  return (t.inside ?? null) === s.inside && Math.abs(t.x - s.playerX) < INTERACT_RANGE;
}

function handleInteract(): void {
  ensureAudio();
  if (!s.inside && s.timepieceX !== null && Math.abs(s.timepieceX - s.playerX) < 55) {
    s.timepieceX = null;
    s.hasTimepiece = true;
    showAction("took the timepiece");
    showToast("You found the timepiece. Press M to choose a moment.");
    return;
  }
  if (handleBuilding("interact")) return;

  // 1. Deliver kit to a broken ward
  if (s.hasSupply) {
    const nearby = s.tasks.find((t) => !t.done && !t.delivered && atTask(t));
    if (nearby) {
      s.hasSupply = false;
      s.tasks = s.tasks.map((t) => (t.id === nearby.id ? { ...t, delivered: true } : t));
      showToast(`Delivered kit to ${nearby.name}! Press E again to open workbench.`);
      return;
    }
  }

  // 2. Open workbench at a supplied ward
  const ready = s.tasks.find((t) => !t.done && t.delivered && atTask(t));
  if (ready) {
    let puzzle = s.puzzles.get(ready.id);
    if (!puzzle) {
      const station = STATIONS.find((st) => st.id === ready.id)!;
      puzzle = createWardPuzzle(station.kind, 42);
      s.puzzles.set(ready.id, puzzle);
    }
    s.activeWardId = ready.id;
    wardPanel?.update(wardView(ready.id, ready.name, puzzle), s.stamina, s.exhausted);
    return;
  }

  // 3. Take kit from the cart
  if (!s.inside && !s.hasSupply && Math.abs(s.cartX - s.playerX) < INTERACT_RANGE) {
    s.hasSupply = true;
    showAction("took a repair kit");
    showToast("Took a repair kit! Notice your slower stride and vigor drain.");
    if (s.chapter === 2) advance(3);
    return;
  }

  // 4. Recover dropped kit from the street
  if (!s.inside && !s.hasSupply) {
    const idx = s.supplyDrops.findIndex((x) => Math.abs(x - s.playerX) < INTERACT_RANGE);
    if (idx !== -1) {
      s.supplyDrops = s.supplyDrops.filter((_, i) => i !== idx);
      s.hasSupply = true;
      showAction("picked up a repair kit");
      showToast("Recovered dropped repair kit!");
      return;
    }
  }

  // 5. Unlock the iron cage with the key
  if (!s.inside && s.hasKey && s.cagedNeighbor && Math.abs(1940 - s.playerX) < CAGE_UNLOCK_RANGE) {
    s.hasKey = false;
    s.cagedNeighbor = false;
    s.keyX = 1980; // the key falls by the open cage
    showToast("Cage unlocked! Nils steps free in front of the bars.");
    if (s.chapter === 4) advance(5);
    return;
  }

  // 6. Pick up the iron key
  if (!s.inside && s.keyX !== null && !s.hasKey && Math.abs(s.keyX - s.playerX) < INTERACT_RANGE) {
    s.hasKey = true;
    s.keyX = null;
    showAction("took the iron key");
    showToast("Found the iron key! Walk to the cage in the square to unlock Nils.");
    return;
  }

  // 7. Ring the chapel bell
  if (!s.inside && Math.abs(BELL_X - s.playerX) < INTERACT_RANGE) {
    s.bellAt = Date.now();
    s.meetingActive = true;
    showToast("The chapel bell tolls! In multiplayer, everyone gathers in the square to vote.");
    if (s.chapter === 5) advance(6);
  }
}

function dropSupply(): void {
  if (!s.hasSupply) return;
  if (s.inside) { showToast("Carry the kit outside to set it down."); return; }
  s.hasSupply = false;
  s.supplyDrops = [...s.supplyDrops, s.playerX];
  showToast("Dropped repair kit on the road.");
}

function hollowRuin(): void {
  const hit = s.tasks.find((t) => (t.done || t.delivered) && (t.inside ?? null) === s.inside && Math.abs(t.x - s.playerX) < INTERACT_RANGE);
  if (hit) {
    s.tasks = s.tasks.map((t) => (t.id === hit.id ? { ...t, done: false, delivered: false, sabotaged: true, progress: 0 } : t));
    s.puzzles.delete(hit.id);
    showToast(`Sabotaged ${hit.name}! In real games, Hollow players can ruin mended wards.`);
  } else {
    showToast("Walk near a supplied or repaired ward to practice Hollow sabotage.");
  }
}

// ---- Practice workbench -------------------------------------------------

function openPractice(kind: WardKind): void {
  releaseKeys();
  s.practiceKind = kind;
  const now = Date.now();
  s.practicePuzzle = createWardPuzzle(kind, now);
  s.practicePreviewUntil = kind === "scarecrow" ? now + 3200 : 0;
  s.practiceOpen = true;
  s.practiceHtml = "";
  $("practice").hidden = false;
  renderPractice();
}

function closePractice(): void {
  s.practiceOpen = false;
  $("practice").hidden = true;
}

function practiceMove(index: number): void {
  const p = s.practicePuzzle;
  if (!p || (p.kind === "scarecrow" && index !== 4 && Date.now() < s.practicePreviewUntil)) return;
  const next = applyWardMove(p, index);
  s.practicePuzzle = next;
  if (p.kind === "scarecrow" && (index === 4 || next.values[0] !== p.values[0] || next.mistakes > p.mistakes)) {
    s.practicePreviewUntil = Date.now() + 3200;
  }
  if (wardSolved(next)) showToast(`${WARD_JOBS[s.practiceKind].title} solved! Excellent work.`);
}

function renderPractice(): void {
  const kinds = $("practiceKinds");
  if (!kinds.childElementCount) {
    for (const k of Object.keys(WARD_JOBS) as WardKind[]) {
      const b = document.createElement("button");
      b.dataset.kind = k;
      b.textContent = WARD_JOBS[k].title.split("·")[0].trim();
      kinds.append(b);
    }
  }
  for (const b of Array.from(kinds.children) as HTMLButtonElement[]) {
    b.classList.toggle("on", b.dataset.kind === s.practiceKind);
  }
  const p = s.practicePuzzle;
  if (!p) return;
  $("practiceTitle").textContent = WARD_JOBS[s.practiceKind].title;
  $("practiceInstr").textContent = WARD_JOBS[s.practiceKind].instruction;
  $("practiceProgress").textContent = `Progress: ${Math.round(wardProgress(p) * 100)}%`;
  $("practiceMoves").textContent = `Moves: ${p.moves}`;
  const solved = wardSolved(p);
  $("practiceSolved").hidden = !solved;
  $("practiceBoardWrap").hidden = solved;
  if (!solved) {
    const html = renderWardJob(wardView(s.practiceKind, WARD_JOBS[s.practiceKind].title, p, Math.max(0, s.practicePreviewUntil - Date.now())));
    if (html !== s.practiceHtml) {
      s.practiceHtml = html;
      morphHtml($("practiceBoard"), html);
    }
  }
}

// ---- HUD ----------------------------------------------------------------

function renderHud(): void {
  const chap = CHAPTERS[s.chapter - 1] ?? CHAPTERS[0];
  $("chapTitle").textContent = chap.title;
  $("chapSummary").textContent = `· ${chap.summary}`;
  $("chapInstr").textContent = chap.instruction;
  $("chapNote").textContent = `“${chap.guideNote}”`;
  const nav = $("chapNav");
  if (!nav.childElementCount) {
    for (const ch of CHAPTERS) {
      const b = document.createElement("button");
      b.className = "chap";
      b.dataset.chapter = String(ch.id);
      b.title = ch.title;
      b.textContent = String(ch.id);
      nav.append(b);
    }
  }
  for (const b of Array.from(nav.children) as HTMLButtonElement[]) {
    const id = Number(b.dataset.chapter);
    const done = s.completed.includes(id);
    b.className = `chap${s.chapter === id ? " on" : done ? " done" : ""}`;
    b.textContent = done ? "✓" : String(id);
  }

  const countdown = $("countdown");
  countdown.hidden = !s.timeVisit;
  if (s.timeVisit) $("countdownText").textContent = `In the past · ${Math.max(0, Math.ceil((s.timeVisit.endsAt - s.timeNow) / 1000))}s`;
  $("timeBtn").hidden = !(s.hasTimepiece || s.timeVisit);
  $("timeBtn").textContent = s.timeVisit ? "Return · M" : "Timepiece · M";

  $("wardsDone").textContent = `${s.tasks.filter((t) => t.done).length} / ${s.tasks.length}`;
  $("carrying").textContent = s.hasSupply ? "YES (slow)" : "None";
  $("location").textContent = s.inside ? BUILDINGS.find((b) => b.id === s.inside)?.name ?? "" : "The road";
  $("position").textContent = String(Math.round(s.playerX));
  $("cartPos").textContent = `x=${Math.round(s.cartX)}`;
  $("keyState").textContent = s.hasKey ? "In Hand" : s.keyX !== null ? "On Road" : "Used";

  $("vigorLabel").textContent = s.exhausted ? "spent — rest!" : "vigor";
  $("vigorLabel").style.color = s.exhausted ? "#e06a5a" : "#9c8b7a";
  const bar = $("vigorBar");
  bar.style.width = `${Math.round(s.stamina * 100)}%`;
  bar.style.background = s.stamina <= 0 ? "#e06a5a" : s.stamina < 0.3 ? "#d99a3d" : "#6b8e23";
  $("hauling").hidden = !s.hasSupply;

  const nearKeyed = BUILDINGS.find((b) => Math.abs(doorX(b) - s.playerX) <= DOOR_REACH && s.doors.some((d) => d.id === b.id && d.holder === "me"));
  const nearState = s.doors.find((d) => d.id === nearKeyed?.id);
  $("lockBtn").hidden = !nearKeyed;
  if (nearKeyed) $("lockBtn").textContent = `${nearState?.locked ? "Unlock" : "Lock"} (L)`;
  $("dropBtn").hidden = !s.hasSupply;
  $("pushBtn").hidden = !!s.hasSupply;

  const nearbyJob = s.tasks.find((t) => t.inside && t.inside === s.inside && !t.done && Math.abs(t.x - s.playerX) < INTERACT_RANGE);
  let hint: string | null;
  if (!s.inside && s.timepieceX !== null && Math.abs(s.timepieceX - s.playerX) < 55) hint = "E — take the timepiece";
  else hint = buildingHint(s.doors, "me", s.playerX, s.inside)
    ?? (nearbyJob ? `E — ${nearbyJob.delivered ? "repair" : "deliver a kit to"} ${nearbyJob.name}` : null);
  $("hint").hidden = !hint;
  $("hint").textContent = hint ?? "";

  const toast = $("toast");
  toast.hidden = !s.toast;
  toast.textContent = s.toast ?? "";
}

// ---- Settings, audio, ward panel --------------------------------------

function applyMuted(muted: boolean): void {
  $("muteBtn").textContent = muted ? "🔇" : "🔊";
  $("muteBtn").title = muted ? "Unmute" : "Mute";
}

function setupPanels(): void {
  applyDocumentPreferences(store.value);
  applyMuted(store.value.audio.muted);
  store.subscribe((next) => {
    applyMuted(next.audio.muted);
    applyDocumentPreferences(next);
    renderer?.setSettings(next);
    resize();
  });
  settingsDialog = new SettingsDialog(store, document.body, { onOpen: releaseKeys });
  timePanel = new TimePanel(document.body, {
    travel: (targetAt: number) => beginVisit(targetAt),
    opened: releaseKeys,
    practice: true,
  });
  wardPanel = new WardPanel(document.body, {
    move: (stationId: string, index: number) => {
      const puzzle = s.puzzles.get(stationId);
      if (!puzzle) return;
      const next = applyWardMove(puzzle, index);
      s.puzzles.set(stationId, next);
      const done = wardSolved(next);
      const prog = wardProgress(next);
      s.tasks = s.tasks.map((t) => (t.id === stationId ? { ...t, done, progress: prog } : t));
      if (done) {
        const station = STATIONS.find((st) => st.id === stationId);
        showToast(`${station ? WARD_JOBS[station.kind].title : "Ward"} repaired!`);
        wardPanel?.update(null, 1, false);
        s.activeWardId = null;
        if (s.chapter === 3) advance(4);
      } else {
        const st = STATIONS.find((x) => x.id === stationId);
        if (st) wardPanel?.update(wardView(stationId, st.name, next), s.stamina, s.exhausted);
      }
    },
    close: () => {
      wardPanel?.update(null, 1, false);
      s.activeWardId = null;
    },
    opened: () => { keys.clear(); lastDir = 0; s.moving = false; },
  });
}

// ---- Input --------------------------------------------------------------

function bindInput(): void {
  window.addEventListener("keydown", (e) => {
    ensureAudio();
    if (menuOpen()) return;
    const target = e.target as HTMLElement | null;
    if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    const controls = store.value.controls;
    if (matchesControl(controls, "left", e.code)) { keys.add("left"); e.preventDefault(); }
    else if (matchesControl(controls, "right", e.code)) { keys.add("right"); e.preventDefault(); }
    else if (matchesControl(controls, "push", e.code)) { s.cartHeld = true; e.preventDefault(); }
    else if (matchesControl(controls, "drop", e.code)) { dropSupply(); e.preventDefault(); }
    else if (matchesControl(controls, "ruin", e.code)) { hollowRuin(); e.preventDefault(); }
    else if (e.code === "KeyM" && !e.repeat) { activateTimepiece(); e.preventDefault(); }
    else if (e.code === "KeyL" && !e.repeat) { handleBuilding("lock"); e.preventDefault(); }
    else if (matchesControl(controls, "interact", e.code) && !e.repeat) { handleInteract(); e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => {
    if (menuOpen()) return;
    const controls = store.value.controls;
    if (matchesControl(controls, "left", e.code)) keys.delete("left");
    else if (matchesControl(controls, "right", e.code)) keys.delete("right");
    else if (matchesControl(controls, "push", e.code)) s.cartHeld = false;
  });
  window.addEventListener("blur", () => { keys.clear(); s.cartHeld = false; });

  const hold = (id: string, action: string) => {
    const el = $(id);
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (action === "push") s.cartHeld = true; else keys.add(action);
    });
    const release = () => { if (action === "push") s.cartHeld = false; else keys.delete(action); };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointerleave", release);
  };
  hold("left", "left");
  hold("right", "right");
  hold("pushBtn", "push");

  $("interact").addEventListener("click", () => handleInteract());
  $("lockBtn").addEventListener("click", () => handleBuilding("lock"));
  $("dropBtn").addEventListener("click", () => dropSupply());
  $("ruin").addEventListener("click", () => hollowRuin());
  $("timeBtn").addEventListener("click", () => activateTimepiece());
  $("returnNow").addEventListener("click", () => activateTimepiece());
  $("practiceBtn").addEventListener("click", () => openPractice("well"));
  $("practiceClose").addEventListener("click", () => closePractice());
  $("practiceReset").addEventListener("click", () => openPractice(s.practiceKind));
  $("practiceKinds").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-kind]");
    if (b?.dataset.kind) openPractice(b.dataset.kind as WardKind);
  });
  $("practiceBoard").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ward-move]");
    if (b && !b.disabled) practiceMove(Number(b.dataset.wardMove));
  });
  $("muteBtn").addEventListener("click", () => {
    ensureAudio();
    const m = !store.value.audio.muted;
    store.update((draft) => { draft.audio.muted = m; });
    audio?.setMuted(m);
  });
  $("settingsBtn").addEventListener("click", () => settingsDialog?.open());
  $("left").addEventListener("contextmenu", (e) => e.preventDefault());
  $("right").addEventListener("contextmenu", (e) => e.preventDefault());
  $("pushBtn").addEventListener("contextmenu", (e) => e.preventDefault());
  $("chapNav").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-chapter]");
    if (b?.dataset.chapter) s.chapter = Number(b.dataset.chapter);
  });
}

// ---- Loops --------------------------------------------------------------

function step(): void {
  const now = performance.now();
  const dt = Math.min(0.12, (now - lastStepTime) / 1000);
  lastStepTime = now;
  const dir = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
  lastDir = dir;
  s.moving = dir !== 0;
  if (dir !== 0) {
    s.facing = dir;
    const pushing = !s.inside && s.cartHeld && !s.hasSupply && Math.abs(s.playerX - s.cartX) <= CART_PUSH_RANGE;
    s.cartPushers = pushing ? 1 : 0;
    const speed = pushing ? CART_SOLO_SPEED : s.hasSupply ? CARRY_SPEED : SPEED;
    const move = walkThroughBuildings(s.playerX, s.playerX + dir * speed * dt, s.inside, s.doors);
    s.playerX = move.x;
    s.inside = move.inside;
    if (pushing) s.cartX = clampWorld(s.cartX + dir * speed * dt, 90);
    if (pushing || s.hasSupply) {
      s.stamina = Math.max(0, s.stamina - CARRY_VIGOR_DRAIN * (pushing ? 1.2 : 1) * dt);
      if (s.stamina <= 0) s.exhausted = true;
    }
    if (s.chapter === 1 && Math.abs(s.playerX - 480) > 220) advance(2);
  } else {
    s.cartPushers = 0;
    s.stamina = Math.min(1, s.stamina + STAMINA_IDLE_REGEN * dt);
    if (s.stamina >= 0.2 && s.exhausted) s.exhausted = false;
  }
  if (s.chapter === 6) s.danger = Math.abs(s.playerX - BELL_X) < 400 ? 0.75 : 0.2;
  // step() now runs at display rate; the HUD only needs ~8 updates a second.
  if (now - lastHudAt >= 120) {
    lastHudAt = now;
    renderHud();
  }
}

function buildSnapshot(): Snapshot {
  return buildTutorialSnapshot({
    tasks: s.tasks, activeWardId: s.activeWardId, timeVisit: s.timeVisit, timepieceX: s.timepieceX,
    hasTimepiece: s.hasTimepiece, actionNotice: s.actionNotice, doors: s.doors, inside: s.inside,
    playerX: s.playerX, cartX: s.cartX, hasKey: s.hasKey, cagedNeighbor: s.cagedNeighbor,
    keyX: s.keyX, hasSupply: s.hasSupply, stamina: s.stamina, exhausted: s.exhausted,
    myVote: null, facing: s.facing, moving: s.moving, supplyDrops: s.supplyDrops,
    cartPushers: s.cartPushers, meetingActive: s.meetingActive, bellAt: s.bellAt,
    blackoutUntil: 0, danger: s.danger,
  }, s.puzzles, s.history);
}

function resize(): void {
  const canvas = $<HTMLCanvasElement>("game");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const graphics = store.value.graphics;
  const dprCap = graphics.quality === "high" ? 2 : graphics.quality === "medium" ? 1.5 : 1;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * graphics.resolution;
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(nowMs: number, last: { t: number }): void {
  requestAnimationFrame((t) => frame(t, last));
  const canvas = $<HTMLCanvasElement>("game");
  const ctx = canvas.getContext("2d");
  if (!ctx || !renderer) return;
  const dt = Math.min(0.05, (nowMs - last.t) / 1000);
  last.t = nowMs;
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;

  const snap = buildSnapshot();
  const latest = s.history[s.history.length - 1];
  if (snap.time?.mode !== "past" && (!latest || Date.now() - latest.at >= HISTORY_SAMPLE_MS)) {
    s.history.push({ at: Date.now(), snapshot: structuredClone(snap) });
    if (s.history.length > 7200) s.history = s.history.filter((_, i) => i % 2 === 0);
  }
  for (const p of snap.players) {
    const cur = displayX.get(p.id);
    if (cur === undefined || Math.abs(cur - p.x) > 300) { displayX.set(p.id, p.x); continue; }
    if (p.id === snap.self.id && !snap.self.caged) {
      const spd = !snap.self.alive ? GHOST_SPEED : snap.self.hasSupply ? CARRY_SPEED : SPEED;
      const pred = cur + lastDir * spd * dt;
      displayX.set(p.id, Math.abs(p.x - pred) > 90 ? p.x : pred + (p.x - pred) * Math.min(1, dt * 25));
    } else {
      displayX.set(p.id, cur + (p.x - cur) * Math.min(1, dt * 16));
    }
  }
  renderer.render(w, h, snap, displayX, nowMs / 1000, dt);
  audio?.update(snap);
  if (s.practiceOpen) renderPractice();
}

function boot(): void {
  renderer = new Renderer($<HTMLCanvasElement>("game"));
  renderer.setSettings(store.value);
  setupPanels();
  bindInput();
  resize();
  window.addEventListener("resize", resize);
  lastStepTime = performance.now();
  setInterval(() => { renderHud(); }, 150);
  renderHud();
  const last = { t: performance.now() };
  requestAnimationFrame((t) => frame(t, last));
}

boot();
