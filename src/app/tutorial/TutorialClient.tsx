"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Renderer } from "@/game/render";
import { BUILDINGS, DOOR_REACH, buildingHint, clampWorld, doorX, dropBuildingKeys, newDoors, interactWithBuilding, walkThroughBuildings } from "@/game/buildings";
import { WardPanel } from "@/game/ward-ui";
import { TimePanel } from "@/game/time-ui";
import {
  WARD_JOBS,
  applyWardMove,
  createWardPuzzle,
  wardKindFor,
  wardProgress,
  wardSolved,
  wardView,
  type WardGameView,
  type WardKind,
  type WardPuzzle,
} from "@/game/wards";
import { AudioDirector } from "@/game/audio";
import {
  SettingsStore,
  applyDocumentPreferences,
  createDefaultSettings,
  keyLabel,
  matchesControl,
  type BindableAction,
  type GameSettings,
} from "@/game/settings";
import { SettingsDialog } from "@/game/settings-ui";
import {
  BELL_X,
  CAGE_UNLOCK_RANGE,
  CART_MAX_SPEED,
  CART_PUSH_RANGE,
  CART_SOLO_SPEED,
  CARRY_SPEED,
  CARRY_VIGOR_DRAIN,
  INTERACT_RANGE,
  MEETING_FROM,
  MEETING_TO,
  SPEED,
  STAMINA_IDLE_REGEN,
  STATIONS,
  GHOST_SPEED,
  SUPPLY_CART_START,
  TIMEPIECE_X,
  TIME_VISIT_MS,
  HISTORY_SAMPLE_MS,
  WORLD_W,
  type Snapshot,
  type TaskView,
} from "@/game/types";

import { mergeReturnedDoors, mergeReturnedTasks } from "./tutorial-time";
import { buildTutorialSnapshot } from "./tutorial-snapshot";
import { CHAPTERS } from "./chapters";
import { TutorialOverlay } from "./TutorialOverlay";
import type { TutorialFrame, TutorialFuture, TutorialVisit } from "./tutorial-types";


export default function TutorialClient() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Settings & audio
  const [settings, setSettings] = useState<GameSettings>(createDefaultSettings);
  const [muted, setMuted] = useState(false);
  const settingsStoreRef = useRef<SettingsStore | null>(null);
  const settingsDialogRef = useRef<SettingsDialog | null>(null);
  const audioRef = useRef<AudioDirector | null>(null);
  const wardPanelRef = useRef<WardPanel | null>(null);
  const timePanelRef = useRef<TimePanel | null>(null);

  // Tutorial progression state
  const [currentChapter, setCurrentChapter] = useState(1);
  const [completedChapters, setCompletedChapters] = useState<number[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [practiceModalOpen, setPracticeModalOpen] = useState(false);
  const [practiceKind, setPracticeKind] = useState<WardKind>("well");
  const [practicePuzzle, setPracticePuzzle] = useState<WardPuzzle | null>(null);
  const [practicePreviewUntil, setPracticePreviewUntil] = useState(0);
  const [practiceNow, setPracticeNow] = useState(0);
  useEffect(() => {
    if (!practiceModalOpen) return;
    const timer = setInterval(() => setPracticeNow(Date.now()), 150);
    return () => clearInterval(timer);
  }, [practiceModalOpen]);

  // Simulated player state
  const [playerX, setPlayerX] = useState(480);
  const [timepieceX, setTimepieceX] = useState<number | null>(TIMEPIECE_X);
  const [hasTimepiece, setHasTimepiece] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ text: string; until: number } | null>(null);
  const [timeVisit, setTimeVisit] = useState<TutorialVisit | null>(null);
  const [timeNow, setTimeNow] = useState(0);
  const tutorialHistory = useRef<TutorialFrame[]>([]);
  const tutorialFuture = useRef<TutorialFuture | null>(null);
  const [doors, setDoors] = useState(newDoors);
  const [inside, setInside] = useState<string | null>(null);
  const [facing, setFacing] = useState(1);
  const [moving, setMoving] = useState(false);
  const [stamina, setStamina] = useState(1.0);
  const [exhausted, setExhausted] = useState(false);
  const [hasSupply, setHasSupply] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [cartX, setCartX] = useState(SUPPLY_CART_START);
  const [cartHeld, setCartHeld] = useState(false);
  const [cartPushers, setCartPushers] = useState(0);
  const [supplyDrops, setSupplyDrops] = useState<number[]>([]);
  const [keyX, setKeyX] = useState<number | null>(1550);
  const [cagedNeighbor, setCagedNeighbor] = useState(true);
  const [blackoutUntil, setBlackoutUntil] = useState(0);
  const [danger, setDanger] = useState(0);
  const [bellAt, setBellAt] = useState(0);
  const [meetingActive, setMeetingActive] = useState(false);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [activeWardId, setActiveWardId] = useState<string | null>(null);

  // Simulated ward task pool (9 stations)
  const [tasks, setTasks] = useState<TaskView[]>(() =>
    STATIONS.map((s) => ({
      id: s.id,
      name: s.name,
      x: s.x,
      inside: s.inside,
      done: false,
      delivered: !!s.initialSupplied,
      sabotaged: false,
      progress: 0,
    }))
  );
  const wardPuzzles = useRef<Map<string, WardPuzzle>>(new Map());

  // Input tracking
  const keys = useRef(new Set<string>());
  const lastDir = useRef(0);
  const displayX = useRef(new Map<string, number>());
  const lastStepTime = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showAction = useCallback((text: string) => setActionNotice({ text, until: Date.now() + 3500 }), []);
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => { setToast(null); toastTimer.current = null; }, 3200);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const getSettingsStore = useCallback(() => {
    if (!settingsStoreRef.current) settingsStoreRef.current = new SettingsStore();
    return settingsStoreRef.current;
  }, []);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new AudioDirector(getSettingsStore());
    audioRef.current.start();
  }, [getSettingsStore]);

  // Advance tutorial chapter
  const advanceToChapter = useCallback(
    (next: number) => {
      setCompletedChapters((prev) => (prev.includes(currentChapter) ? prev : [...prev, currentChapter]));
      setCurrentChapter(next);
      showToast(`Completed! Next: ${CHAPTERS[next - 1]?.title ?? "Finish"}`);
    },
    [currentChapter, showToast]
  );

  // Hot values do not restart the timer, camera, audio or settings dialog.
  const live = useRef({ playerX, cartX, cartHeld, hasSupply, currentChapter, stamina, exhausted, doors, inside, tasks, keyX, hasKey, supplyDrops, cagedNeighbor, timeVisit });
  const advanceRef = useRef(advanceToChapter);
  useEffect(() => {
    live.current = { playerX, cartX, cartHeld, hasSupply, currentChapter, stamina, exhausted, doors, inside, tasks, keyX, hasKey, supplyDrops, cagedNeighbor, timeVisit };
    advanceRef.current = advanceToChapter;
  }, [playerX, cartX, cartHeld, hasSupply, currentChapter, stamina, exhausted, doors, inside, tasks, keyX, hasKey, supplyDrops, cagedNeighbor, timeVisit, advanceToChapter]);

  const endTutorialVisit = useCallback(() => {
    const future = tutorialFuture.current, current = live.current;
    if (!future || !current.timeVisit) return;
    const merged = mergeReturnedTasks(future, current);
    const mergedDoors = mergeReturnedDoors(future, current);
    setTasks(merged); setDoors(mergedDoors); setCartX(future.cartX); setSupplyDrops(future.supplyDrops);
    setHasKey(current.hasKey || future.hasKey);
    setKeyX(current.hasKey ? null : current.keyX !== future.baselineKeyX ? current.keyX : future.keyX);
    setHasSupply(current.hasSupply || future.hasSupply);
    setCagedNeighbor(future.baselineCaged && !current.cagedNeighbor ? false : future.cagedNeighbor);
    wardPuzzles.current = future.puzzles;
    setActiveWardId(null); wardPanelRef.current?.update(null, 1, false);
    keys.current.clear(); lastDir.current = 0; setMoving(false); setCartHeld(false);
    tutorialFuture.current = null; current.timeVisit = null; setTimeVisit(null);
    showToast("You return to the present. Past changes have carried forward.");
  }, [showToast]);

  const beginTutorialVisit = useCallback((targetAt: number) => {
    const frame = [...tutorialHistory.current].reverse().find((item) => item.at <= targetAt) ?? tutorialHistory.current[0];
    if (!frame || !hasTimepiece || timeVisit) return;
    const futureDoors = structuredClone(doors);
    dropBuildingKeys(futureDoors, "me", playerX, inside);
    tutorialFuture.current = { tasks: structuredClone(tasks), doors: futureDoors,
      keyX: hasKey ? playerX : keyX, hasKey: false, hasSupply: false,
      supplyDrops: hasSupply ? [...supplyDrops, playerX] : [...supplyDrops], cartX, cagedNeighbor,
      puzzles: structuredClone(wardPuzzles.current), baselineTasks: structuredClone(frame.snapshot.tasks),
      baselineDoors: structuredClone(frame.snapshot.doors ?? newDoors()).map((door) => ({ ...door, holder: door.holder === "me" ? "echo:me" : door.holder })),
      baselineCaged: !!frame.snapshot.cages[0]?.occupant, baselineKeyX: frame.snapshot.keyX };
    setTasks(structuredClone(frame.snapshot.tasks));
    setDoors(structuredClone(tutorialFuture.current.baselineDoors));
    setKeyX(frame.snapshot.keyX); setCartX(frame.snapshot.cartX); setSupplyDrops([...frame.snapshot.supplyDrops]);
    setCagedNeighbor(!!frame.snapshot.cages[0]?.occupant); setHasKey(false); setHasSupply(false);
    wardPuzzles.current = new Map(); setActiveWardId(null);
    const now = Date.now(), visit = { originAt: frame.at, startedAt: now, endsAt: now + TIME_VISIT_MS };
    setHasTimepiece(false); setTimepieceX(null); live.current.timeVisit = visit; setTimeVisit(visit); setTimeNow(now);
    keys.current.clear(); lastDir.current = 0; setMoving(false); setCartHeld(false);
    showToast("The timepiece breaks. You are in the recorded past.");
  }, [hasTimepiece, timeVisit, doors, playerX, inside, tasks, hasKey, keyX, hasSupply, supplyDrops, cartX, cagedNeighbor, showToast]);
  const beginVisitRef = useRef(beginTutorialVisit);
  const endVisitRef = useRef(endTutorialVisit);
  useEffect(() => { beginVisitRef.current = beginTutorialVisit; endVisitRef.current = endTutorialVisit; }, [beginTutorialVisit, endTutorialVisit]);
  useEffect(() => {
    if (!timeVisit) return;
    const timer = setInterval(() => { const now = Date.now(); setTimeNow(now); if (now >= timeVisit.endsAt) endVisitRef.current(); }, 250);
    return () => clearInterval(timer);
  }, [timeVisit]);
  const activateTimepiece = useCallback(() => {
    if (timeVisit) { endVisitRef.current(); return; }
    const first = tutorialHistory.current[0], last = tutorialHistory.current.at(-1);
    if (hasTimepiece && first && last) timePanelRef.current?.open({ mode: "present", earliest: first.at, latest: last.at });
  }, [hasTimepiece, timeVisit]);
  const handleBuilding = useCallback((action: "interact" | "lock") => {
    const state = live.current;
    const next = state.doors.map((d) => ({ ...d }));
    const result = interactWithBuilding(next, "me", state.playerX, state.inside, action);
    if (!result.handled) return false;
    if (result.message) {
      state.doors = next; setDoors(next); showToast(result.message);
      if (result.message.startsWith("You found ")) showAction(result.message.replace(/^You found /, "took "));
    }
    if (result.error) showToast(result.error);
    return true;
  }, [showToast, showAction]);

  // Initialize settings, audio, and ward panel
  useEffect(() => {
    const store = getSettingsStore();
    setSettings(store.value);
    setMuted(store.value.audio.muted);
    applyDocumentPreferences(store.value);

    const unsub = store.subscribe((next) => {
      setSettings(next);
      setMuted(next.audio.muted);
      applyDocumentPreferences(next);
    });

    const release = () => { keys.current.clear(); lastDir.current = 0; setMoving(false); setCartHeld(false); };
    const dialog = new SettingsDialog(store, document.body, { onOpen: release });
    settingsDialogRef.current = dialog;
    const timePanel = new TimePanel(document.body, { travel: (targetAt) => beginVisitRef.current(targetAt), opened: release, practice: true });
    timePanelRef.current = timePanel;

    const panel = new WardPanel(document.body, {
      move: (stationId, index) => {
        const puzzle = wardPuzzles.current.get(stationId);
        if (!puzzle) return;
        const next = applyWardMove(puzzle, index);
        wardPuzzles.current.set(stationId, next);

        const done = wardSolved(next);
        const prog = wardProgress(next);

        setTasks((prev) =>
          prev.map((t) => (t.id === stationId ? { ...t, done, progress: prog } : t))
        );

        if (done) {
          const station = STATIONS.find((s) => s.id === stationId);
          showToast(`${station ? WARD_JOBS[station.kind].title : "Ward"} repaired!`);
          panel.update(null, 1, false);
          setActiveWardId(null);
          if (live.current.currentChapter === 3) {
            advanceRef.current(4);
          }
        } else {
          const st = STATIONS.find((s) => s.id === stationId);
          if (st) panel.update(wardView(stationId, st.name, next), live.current.stamina, live.current.exhausted);
        }
      },
      close: () => {
        panel.update(null, 1, false);
        setActiveWardId(null);
      },
      opened: () => {
        keys.current.clear();
        lastDir.current = 0;
        setMoving(false);
      },
    });
    wardPanelRef.current = panel;

    return () => {
      unsub();
      dialog.destroy();
      timePanel.destroy(); timePanelRef.current = null;
      panel.destroy();
      audioRef.current?.destroy();
      settingsDialogRef.current = null;
      wardPanelRef.current = null;
      audioRef.current = null;
    };
  }, [getSettingsStore, showToast]);

  // Handle player actions in tutorial
  const handleInteract = useCallback(() => {
    ensureAudio();
    if (!inside && timepieceX !== null && Math.abs(timepieceX - playerX) < 55) {
      setTimepieceX(null); setHasTimepiece(true); showAction("took the timepiece"); showToast("You found the timepiece. Press M to choose a moment."); return;
    }
    if (handleBuilding("interact")) return;
    const atTask = (t: TaskView) => (t.inside ?? null) === inside && Math.abs(t.x - playerX) < INTERACT_RANGE;

    // 1. Deliver kit to a broken ward
    if (hasSupply) {
      const nearbyWard = tasks.find((t) => !t.done && !t.delivered && atTask(t));
      if (nearbyWard) {
        setHasSupply(false);
        setTasks((prev) =>
          prev.map((t) => (t.id === nearbyWard.id ? { ...t, delivered: true } : t))
        );
        showToast(`Delivered kit to ${nearbyWard.name}! Press E again to open workbench.`);
        return;
      }
    }

    // 2. Open workbench at a supplied ward
    const readyWard = tasks.find((t) => !t.done && t.delivered && atTask(t));
    if (readyWard) {
      let puzzle = wardPuzzles.current.get(readyWard.id);
      if (!puzzle) {
        const station = STATIONS.find((s) => s.id === readyWard.id)!;
        puzzle = createWardPuzzle(station.kind, 42);
        wardPuzzles.current.set(readyWard.id, puzzle);
      }
      setActiveWardId(readyWard.id);
      wardPanelRef.current?.update(wardView(readyWard.id, readyWard.name, puzzle), stamina, exhausted);
      return;
    }

    // 3. Take kit from the cart
    if (!inside && !hasSupply && Math.abs(cartX - playerX) < INTERACT_RANGE) {
      setHasSupply(true);
      showAction("took a repair kit");
      showToast("Took a repair kit! Notice your slower stride and vigor drain.");
      if (currentChapter === 2) {
        advanceToChapter(3);
      }
      return;
    }

    // 4. Recover dropped kit from street
    if (!inside && !hasSupply) {
      const droppedIdx = supplyDrops.findIndex((x) => Math.abs(x - playerX) < INTERACT_RANGE);
      if (droppedIdx !== -1) {
        setSupplyDrops((prev) => prev.filter((_, i) => i !== droppedIdx));
        setHasSupply(true);
        showAction("picked up a repair kit");
        showToast("Recovered dropped repair kit!");
        return;
      }
    }

    // 5. Unlock iron cage with key
    if (!inside && hasKey && cagedNeighbor && Math.abs(1940 - playerX) < CAGE_UNLOCK_RANGE) {
      setHasKey(false);
      setCagedNeighbor(false);
      setKeyX(1980); // key falls by the open cage
      showToast("Cage unlocked! Nils steps free in front of the bars.");
      if (currentChapter === 4) {
        advanceToChapter(5);
      }
      return;
    }

    // 6. Pick up iron key
    if (!inside && keyX !== null && !hasKey && Math.abs(keyX - playerX) < INTERACT_RANGE) {
      setHasKey(true);
      setKeyX(null);
      showAction("took the iron key");
      showToast("Found the iron key! Walk to the cage in the square to unlock Nils.");
      return;
    }

    // 7. Ring the chapel bell
    if (!inside && Math.abs(BELL_X - playerX) < INTERACT_RANGE) {
      setBellAt(Date.now());
      setMeetingActive(true);
      showToast("The chapel bell tolls! In multiplayer, everyone gathers in the square to vote.");
      if (currentChapter === 5) {
        advanceToChapter(6);
      }
      return;
    }
  }, [
    ensureAudio,
    handleBuilding,
    showAction,
    inside,
    timepieceX,
    hasSupply,
    tasks,
    playerX,
    cartX,
    currentChapter,
    advanceToChapter,
    supplyDrops,
    hasKey,
    cagedNeighbor,
    keyX,
    showToast,
    stamina,
    exhausted,
  ]);

  const handleDropSupply = useCallback(() => {
    if (!hasSupply) return;
    if (inside) { showToast("Carry the kit outside to set it down."); return; }
    setHasSupply(false);
    setSupplyDrops((prev) => [...prev, playerX]);
    showToast("Dropped repair kit on the road.");
  }, [hasSupply, inside, playerX, showToast]);

  const handleHollowRuin = useCallback(() => {
    // Simulated sabotage
    const suppliedOrDone = tasks.find((t) => (t.done || t.delivered) && (t.inside ?? null) === inside && Math.abs(t.x - playerX) < INTERACT_RANGE);
    if (suppliedOrDone) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === suppliedOrDone.id ? { ...t, done: false, delivered: false, sabotaged: true, progress: 0 } : t
        )
      );
      wardPuzzles.current.delete(suppliedOrDone.id);
      showToast(`Sabotaged ${suppliedOrDone.name}! In real games, Hollow players can ruin mended wards.`);
    } else {
      showToast("Walk near a supplied or repaired ward to practice Hollow sabotage.");
    }
  }, [tasks, playerX, inside, showToast]);

  // Input listeners
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      ensureAudio();
      if (practiceModalOpen || settingsDialogRef.current?.isOpen || timePanelRef.current?.isOpen || wardPanelRef.current?.isOpen) return;

      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;

      const controls = getSettingsStore().value.controls;
      if (matchesControl(controls, "left", e.code)) {
        keys.current.add("left");
        e.preventDefault();
      } else if (matchesControl(controls, "right", e.code)) {
        keys.current.add("right");
        e.preventDefault();
      } else if (matchesControl(controls, "push", e.code)) {
        setCartHeld(true);
        e.preventDefault();
      } else if (matchesControl(controls, "drop", e.code)) {
        handleDropSupply();
        e.preventDefault();
      } else if (matchesControl(controls, "ruin", e.code)) {
        handleHollowRuin();
        e.preventDefault();
      } else if (e.code === "KeyM" && !e.repeat) {
        activateTimepiece();
        e.preventDefault();
      } else if (e.code === "KeyL" && !e.repeat) {
        handleBuilding("lock");
        e.preventDefault();
      } else if (matchesControl(controls, "interact", e.code) && !e.repeat) {
        handleInteract();
        e.preventDefault();
      }
    };

    const up = (e: KeyboardEvent) => {
      if (practiceModalOpen || settingsDialogRef.current?.isOpen || timePanelRef.current?.isOpen || wardPanelRef.current?.isOpen) return;
      const controls = getSettingsStore().value.controls;
      if (matchesControl(controls, "left", e.code)) keys.current.delete("left");
      else if (matchesControl(controls, "right", e.code)) keys.current.delete("right");
      else if (matchesControl(controls, "push", e.code)) setCartHeld(false);
    };

    const release = () => { keys.current.clear(); setCartHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, [ensureAudio, getSettingsStore, handleDropSupply, handleHollowRuin, handleInteract, handleBuilding, practiceModalOpen, activateTimepiece]);

  // One stable timer repays late ticks instead of restarting on every render.
  useEffect(() => {
    lastStepTime.current = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.12, (now - lastStepTime.current) / 1000);
      lastStepTime.current = now;
      const state = live.current;
      const dir = (keys.current.has("right") ? 1 : 0) - (keys.current.has("left") ? 1 : 0);
      lastDir.current = dir;
      setMoving(dir !== 0);
      if (dir !== 0) {
        setFacing(dir);
        const pushing = !state.inside && state.cartHeld && !state.hasSupply && Math.abs(state.playerX - state.cartX) <= CART_PUSH_RANGE;
        setCartPushers(pushing ? 1 : 0);
        const speed = pushing ? CART_SOLO_SPEED : state.hasSupply ? CARRY_SPEED : SPEED;
        const step = walkThroughBuildings(state.playerX, state.playerX + dir * speed * dt, state.inside, state.doors);
        state.playerX = step.x; state.inside = step.inside;
        setPlayerX(step.x); setInside(step.inside);
        if (pushing) { state.cartX = clampWorld(state.cartX + dir * speed * dt, 90); setCartX(state.cartX); }
        if (pushing || state.hasSupply) {
          const next = Math.max(0, state.stamina - CARRY_VIGOR_DRAIN * (pushing ? 1.2 : 1) * dt);
          state.stamina = next; setStamina(next);
          if (next <= 0) setExhausted(true);
        }
        if (state.currentChapter === 1 && Math.abs(state.playerX - 480) > 220) {
          state.currentChapter = 2; advanceRef.current(2);
        }
      } else {
        setCartPushers(0);
        const next = Math.min(1, state.stamina + STAMINA_IDLE_REGEN * dt);
        state.stamina = next; setStamina(next);
        if (next >= 0.2 && state.exhausted) setExhausted(false);
      }
      if (state.currentChapter === 6) setDanger(Math.abs(state.playerX - BELL_X) < 400 ? 0.75 : 0.2);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Construct current simulated snapshot for canvas renderer
  const buildSnapshot = useCallback((): Snapshot => buildTutorialSnapshot({
    tasks, activeWardId, timeVisit, timepieceX, hasTimepiece, actionNotice, doors, inside,
    playerX, cartX, hasKey, cagedNeighbor, keyX, hasSupply, stamina, exhausted, myVote,
    facing, moving, supplyDrops, cartPushers, meetingActive, bellAt, blackoutUntil, danger,
  }, wardPuzzles.current, tutorialHistory.current), [
    tasks,
    activeWardId,
    timeVisit,
    timepieceX,
    hasTimepiece,
    actionNotice,
    doors,
    inside,
    playerX,
    cartX,
    hasKey,
    cagedNeighbor,
    keyX,
    hasSupply,
    stamina,
    exhausted,
    myVote,
    facing,
    moving,
    supplyDrops,
    cartPushers,
    meetingActive,
    bellAt,
    blackoutUntil,
    danger,
  ]);

  const snapshotRef = useRef(buildSnapshot);
  useEffect(() => { snapshotRef.current = buildSnapshot; }, [buildSnapshot]);

  // Main canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const renderer = new Renderer();
    const store = getSettingsStore();
    renderer.setSettings(store.value);

    let raf = 0;
    let last = performance.now();

    const vw = () => window.visualViewport?.width ?? window.innerWidth;
    const vh = () => window.visualViewport?.height ?? window.innerHeight;

    const resize = () => {
      const graphics = store.value.graphics;
      const dprCap = graphics.quality === "high" ? 2 : graphics.quality === "medium" ? 1.5 : 1;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * graphics.resolution;
      canvas.width = Math.max(1, Math.round(vw() * dpr));
      canvas.height = Math.max(1, Math.round(vh() * dpr));
      canvas.style.width = `${vw()}px`;
      canvas.style.height = `${vh()}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const unsub = store.subscribe((next) => {
      renderer.setSettings(next);
      resize();
    });

    resize();
    window.addEventListener("resize", resize);

    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;

      const snap = snapshotRef.current();
      if (snap.time?.mode !== "past" && (!tutorialHistory.current.length || Date.now() - tutorialHistory.current[tutorialHistory.current.length - 1].at >= HISTORY_SAMPLE_MS)) {
        tutorialHistory.current.push({ at: Date.now(), snapshot: structuredClone(snap) });
        if (tutorialHistory.current.length > 7200) tutorialHistory.current = tutorialHistory.current.filter((_, index) => index % 2 === 0);
      }
      for (const p of snap.players) {
        const cur = displayX.current.get(p.id);
        if (cur === undefined || Math.abs(cur - p.x) > 300) { displayX.current.set(p.id, p.x); continue; }
        if (p.id === snap.self.id && !snap.self.caged) {
          // Local prediction at the authoritative speed; the local step only
          // corrects drift, so movement no longer lags behind the input.
          const spd = !snap.self.alive ? GHOST_SPEED : snap.self.hasSupply ? CARRY_SPEED : SPEED;
          const pred = cur + lastDir.current * spd * dt;
          displayX.current.set(p.id, Math.abs(p.x - pred) > 90 ? p.x : pred + (p.x - pred) * Math.min(1, dt * 25));
        } else {
          displayX.current.set(p.id, cur + (p.x - cur) * Math.min(1, dt * 16));
        }
      }

      renderer.render(ctx, vw(), vh(), snap, displayX.current, nowMs / 1000, dt);
      audioRef.current?.update(snap);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [getSettingsStore]);

  // Practice modal helper
  const openPracticeWard = (kind: WardKind) => {
    keys.current.clear(); lastDir.current = 0; setMoving(false); setCartHeld(false);
    setPracticeKind(kind);
    const pz = createWardPuzzle(kind, Date.now());
    setPracticePuzzle(pz);
    const now = Date.now();
    setPracticeNow(now);
    setPracticePreviewUntil(kind === "scarecrow" ? now + 3200 : 0);
    setPracticeModalOpen(true);
  };

  const handlePracticeMove = (index: number) => {
    if (!practicePuzzle || (practicePuzzle.kind === "scarecrow" && index !== 4 && Date.now() < practicePreviewUntil)) return;
    const next = applyWardMove(practicePuzzle, index);
    setPracticePuzzle(next);
    if (practicePuzzle.kind === "scarecrow" && (index === 4 || next.values[0] !== practicePuzzle.values[0] || next.mistakes > practicePuzzle.mistakes)) {
      const now = Date.now(); setPracticeNow(now); setPracticePreviewUntil(now + 3200);
    }
    if (wardSolved(next)) {
      showToast(`${WARD_JOBS[practiceKind].title} solved! Excellent work.`);
    }
  };

  const activeChap = CHAPTERS[currentChapter - 1] ?? CHAPTERS[0];
  const nearKeyedDoor = BUILDINGS.find((b) => Math.abs(doorX(b) - playerX) <= DOOR_REACH && doors.some((d) => d.id === b.id && d.holder === "me"));
  const nearDoorState = doors.find((d) => d.id === nearKeyedDoor?.id);
  const nearbyIndoorJob = tasks.find((t) => t.inside && t.inside === inside && !t.done && Math.abs(t.x - playerX) < INTERACT_RANGE);
  const actionHint = !inside && timepieceX !== null && Math.abs(timepieceX - playerX) < 55 ? "E — take the timepiece" : buildingHint(doors, "me", playerX, inside) ?? (nearbyIndoorJob ? `E — ${nearbyIndoorJob.delivered ? "repair" : "deliver a kit to"} ${nearbyIndoorJob.name}` : null);

  return (
    <TutorialOverlay
      actionHint={actionHint}
      activateTimepiece={activateTimepiece}
      activeChap={activeChap}
      audioRef={audioRef}
      canvasRef={canvasRef}
      cartX={cartX}
      completedChapters={completedChapters}
      currentChapter={currentChapter}
      ensureAudio={ensureAudio}
      exhausted={exhausted}
      getSettingsStore={getSettingsStore}
      handleBuilding={handleBuilding}
      handleDropSupply={handleDropSupply}
      handleHollowRuin={handleHollowRuin}
      handleInteract={handleInteract}
      handlePracticeMove={handlePracticeMove}
      hasKey={hasKey}
      hasSupply={hasSupply}
      hasTimepiece={hasTimepiece}
      inside={inside}
      keyX={keyX}
      keys={keys}
      muted={muted}
      nearDoorState={nearDoorState}
      nearKeyedDoor={nearKeyedDoor}
      openPracticeWard={openPracticeWard}
      playerX={playerX}
      practiceKind={practiceKind}
      practiceModalOpen={practiceModalOpen}
      practiceNow={practiceNow}
      practicePreviewUntil={practicePreviewUntil}
      practicePuzzle={practicePuzzle}
      setCartHeld={setCartHeld}
      setCurrentChapter={setCurrentChapter}
      setPracticeModalOpen={setPracticeModalOpen}
      settingsDialogRef={settingsDialogRef}
      stamina={stamina}
      tasks={tasks}
      timeNow={timeNow}
      timeVisit={timeVisit}
      toast={toast}
    />
  );
}