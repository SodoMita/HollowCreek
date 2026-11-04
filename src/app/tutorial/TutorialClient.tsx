"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  DoorOpen,
  Flame,
  HelpCircle,
  Key,
  Lock,
  Moon,
  RotateCcw,
  Sparkles,
  Trophy,
  Users,
  Volume2,
  Wrench,
  Zap,
} from "lucide-react";
import { Renderer } from "@/game/render";
import { BUILDINGS, DOOR_REACH, buildingHint, clampWorld, doorX, dropBuildingKeys, newDoors, interactWithBuilding, walkThroughBuildings, type DoorState } from "@/game/buildings";
import { WardPanel, renderWardJob } from "@/game/ward-ui";
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
  CAGE_XS,
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

interface Chapter {
  id: number;
  title: string;
  summary: string;
  instruction: string;
  guideNote: string;
}

const CHAPTERS: Chapter[] = [
  {
    id: 1,
    title: "Chapter I: The Autumn Lane",
    summary: "Movement, Facing & Vigor",
    instruction: "Walk along the street with A / D or ◀ ▶. Run a few steps, then stand still to feel your vigor return.",
    guideNote:
      "Hollow Creek is one long autumn road. Walking is easy, but deeds drain your vigor. When spent, you must stand still and catch your breath.",
  },
  {
    id: 2,
    title: "Chapter II: The Single Supply Cart",
    summary: "Cooperative Pushing & Hauling",
    instruction: "Walk to the heavy wooden cart at x=900. Hold Shift + A/D to push it. Then press E to take a repair kit.",
    guideNote:
      "The nine street wards start in ruins; houses hold smaller ready-to-repair jobs. The town shares one heavy cart of timber and iron. Hauling a kit slows you down and drains vigor. Press G to drop a kit if danger nears.",
  },
  {
    id: 3,
    title: "Chapter III: Mending a Ruined Ward",
    summary: "Delivery & The Puzzle Workbench",
    instruction: "Carry your kit to the Well (x=680) and press E to deliver it. Then press E again to open the repair workbench and solve the winch puzzle!",
    guideNote:
      "Wards are not key-holds. Each structure has its own mechanical challenge. Once supplied, open the board and solve it to restore the ward.",
  },
  {
    id: 4,
    title: "Chapter IV: The Condemned & The Key",
    summary: "Iron Cages & Realistic Depth",
    instruction: "Walk east to x=1550, pick up the iron key with E. Walk to the cage at x=1940 and unlock Nils. Notice he steps outside the bars!",
    guideNote:
      "Free souls walk in front of the iron bars; only prisoners stand behind them. Caging suspects does NOT end the night — you still have to mend the wards!",
  },
  {
    id: 5,
    title: "Chapter V: The Square & The Bell",
    summary: "Meetings, Accusations & Votes",
    instruction: "Walk into the town square (x=2200) and press E beside the bell tower to toll the bell, then cast your practice verdict.",
    guideNote:
      "When the bell tolls, all living souls must walk into the square. Vote to cage a suspect, free a prisoner, or abstain.",
  },
  {
    id: 6,
    title: "Chapter VI: The Hollow in the Dark",
    summary: "Survival, Dread & Sabotage",
    instruction: "Feel the darkness fall: lanterns snuff out and proximity dread beats in your chest. The Hollow can strike and ruin repaired wards (R).",
    guideNote:
      "One or two among you wear human faces. When dread rises, find a lantern, stick together, and finish every ward before dawn.",
  },
  {
    id: 7, title: "Chapter VII: The Houses Beyond", summary: "Separate Keys & Side Doors",
    instruction: "Walk west beyond the harvest shed. Find the tollhouse key, open its side door with E, and walk inside. Stand by the hearth and press E to repair it.",
    guideNote: "Each house has its own key and an indoor job with supplies on site. E closes a door without locking it; L locks or unlocks with its matching key.",
  },
  {
    id: 8, title: "Chapter VIII: A Minute Borrowed", summary: "The Timepiece",
    instruction: "Find the timepiece east of the cart at x=1260. Take it with E, then press M and choose a recorded moment.",
    guideNote: "Solo practice shows your own recorded movement. In multiplayer, recorded player commands are replayed against changes in the past.",
  },
];

type TutorialVisit = { originAt: number; startedAt: number; endsAt: number };
type TutorialFrame = { at: number; snapshot: Snapshot };
type TutorialFuture = {
  tasks: TaskView[]; doors: DoorState[]; keyX: number | null; hasKey: boolean; hasSupply: boolean;
  supplyDrops: number[]; cartX: number; cagedNeighbor: boolean; puzzles: Map<string, WardPuzzle>;
  baselineTasks: TaskView[]; baselineDoors: DoorState[]; baselineCaged: boolean; baselineKeyX: number | null;
};

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
    const merged = future.tasks.map((task) => {
      const past = current.tasks.find((item) => item.id === task.id);
      const before = future.baselineTasks.find((item) => item.id === task.id);
      if (!past || !before) return task;
      if (past.sabotaged && !before.sabotaged) return { ...task, done: false, delivered: false, sabotaged: true, progress: 0 };
      if (past.done && !before.done) return { ...task, done: true, delivered: true, progress: 1 };
      if (past.delivered && !before.delivered && !task.done) return { ...task, delivered: true };
      return task;
    });
    const mergedDoors = future.doors.map((door) => {
      const past = current.doors.find((item) => item.id === door.id);
      const before = future.baselineDoors.find((item) => item.id === door.id);
      if (!past || !before) return door;
      const next = { ...door };
      if (past.open !== before.open || past.locked !== before.locked) { next.open = past.open; next.locked = past.locked; }
      if (past.holder === "me" && before.holder !== "me") { next.holder = "me"; next.keyX = null; }
      return next;
    });
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
  const buildSnapshot = useCallback((): Snapshot => {
    const activeTask = tasks.find((t) => t.id === activeWardId);
    const pz = activeTask ? wardPuzzles.current.get(activeTask.id) : null;
    const mini = activeTask && pz ? wardView(activeTask.id, activeTask.name, pz) : null;

    let hint: string | null = null;
    const nearbyWard = tasks.find((t) => !t.done && (t.inside ?? null) === inside && Math.abs(t.x - playerX) < INTERACT_RANGE);
    const atCart = !inside && Math.abs(cartX - playerX) < INTERACT_RANGE;
    const nearCart = !inside && Math.abs(cartX - playerX) <= CART_PUSH_RANGE;

    if (nearbyWard && nearbyWard.delivered) hint = "E — open repair puzzle";
    else if (nearbyWard && !nearbyWard.delivered && hasSupply) hint = "E — deliver kit to ward";
    else if (hasKey && cagedNeighbor && Math.abs(1940 - playerX) < CAGE_UNLOCK_RANGE) hint = "E — unlock Nils's cage";
    else if (keyX !== null && Math.abs(keyX - playerX) < INTERACT_RANGE) hint = "E — take the iron key";
    else if (!hasSupply && atCart) hint = "E — take kit · hold Shift+A/D to push";
    else if (nearCart && !hasSupply) hint = "Hold Shift + A/D to push cart";
    else if (hasSupply) hint = "G — drop carried kit";
    else if (Math.abs(BELL_X - playerX) < INTERACT_RANGE) hint = "E — ring the chapel bell";
    hint = buildingHint(doors, "me", playerX, inside) ?? hint;
    if (!inside && timepieceX !== null && Math.abs(timepieceX - playerX) < 55) hint = "E — take the timepiece";
    else if (hasTimepiece && !hint) hint = "M — choose a moment in the past";

    const result: Snapshot = {
      code: "TUTOR",
      phase: "playing",
      round: 1,
      now: Date.now(),
      self: {
        id: "me",
        role: "crew",
        alive: true,
        caged: false,
        hasKey,
        hasSupply,
        doorKeys: doors.filter((d) => d.holder === "me").map((d) => d.id),
        hasTimepiece,
        bellUsed: false,
        killCooldownMs: 0,
        canKill: false,
        stamina,
        exhausted,
        blackoutCooldownMs: 0,
        canBlackout: false,
        sabotageCooldownMs: 0,
        canSabotage: true,
        teammates: [],
        myVote,
      },
      players: [
        {
          id: "me",
          name: "You",
          color: "#3a7ca5",
          x: playerX,
          facing,
          moving,
          alive: true,
          caged: false,
          hasKey,
          hasSupply,
          inside,
          hasTimepiece,
          doorKeys: doors.filter((door) => door.holder === "me").map((door) => door.id),
          action: actionNotice && actionNotice.until > Date.now() ? actionNotice : null,
          voted: myVote !== null,
          bubble: null,
          isHost: true,
        },
        {
          id: "nils",
          name: "Nils",
          color: "#6b8e23",
          x: cagedNeighbor ? CAGE_XS[0] : CAGE_XS[0] + 55,
          facing: 1,
          moving: false,
          alive: true,
          caged: cagedNeighbor,
          hasKey: false,
          hasSupply: false,
          voted: false,
          bubble: cagedNeighbor ? { text: "The key is west of the square! Unlock me!", until: Date.now() + 5000 } : null,
          isHost: false,
        },
        {
          id: "silas",
          name: "Silas (Guide)",
          color: "#e0a52a",
          x: Math.max(90, cartX - 60),
          facing: 1,
          moving: false,
          alive: true,
          caged: false,
          hasKey: false,
          hasSupply: false,
          voted: false,
          bubble: null,
          isHost: false,
        },
      ],
      bodies: [],
      doors,
      keyX,
      timepieceX,
      supplyDrops,
      cartX,
      cartPushers,
      cages: [
        { x: CAGE_XS[0], occupant: cagedNeighbor ? "nils" : null },
        { x: CAGE_XS[1], occupant: null },
        { x: CAGE_XS[2], occupant: null },
        { x: CAGE_XS[3], occupant: null },
        { x: CAGE_XS[4], occupant: null },
        { x: CAGE_XS[5], occupant: null },
      ],
      tasks,
      taskBar: {
        done: tasks.filter((t) => t.done).length,
        total: tasks.length,
      },
      meeting: meetingActive
        ? {
            endsAt: Date.now() + 30000,
            reason: "Silas called a practice assembly in the square",
            inArea: Math.abs(playerX - BELL_X) < 300,
          }
        : null,
      feed: [
        { text: "Welcome to the school of Hollow Creek. Follow the chapter guide above.", at: Date.now() - 10000 },
      ],
      winner: null,
      winReason: null,
      results: null,
      bellAt,
      flickerAt: 0,
      blackoutUntil,
      danger,
      visionRadius: 420,
      hint,
      abilityLabel: "Ring Bell",
      abilityReady: Math.abs(playerX - BELL_X) < INTERACT_RANGE + 20,
      hostId: "me",
      playerCount: 3,
      minigame: mini,
    };
    const first = tutorialHistory.current[0], last = tutorialHistory.current.at(-1);
    if (timeVisit) {
      const cursor = Math.min(Date.now(), timeVisit.originAt + Date.now() - timeVisit.startedAt);
      const historical = [...tutorialHistory.current].reverse().find((frame) => frame.at <= cursor) ?? first;
      if (historical) {
        const me = result.players[0];
        const shift = Date.now() - cursor;
        result.players = [me, ...historical.snapshot.players.map((player) => ({ ...player, id: `echo:${player.id}`, echo: true, isHost: false, bubble: null,
          action: player.action ? { ...player.action, until: player.action.until + shift } : null }))];
        result.cages = historical.snapshot.cages.map((cage) => ({ ...cage, occupant: cage.occupant ? `echo:${cage.occupant}` : null }));
      }
      result.time = { mode: "past", earliest: first?.at ?? timeVisit.originAt, latest: last?.at ?? timeVisit.originAt, cursor, endsAt: timeVisit.endsAt };
    } else result.time = { mode: "present", earliest: first?.at ?? Date.now(), latest: last?.at ?? Date.now() };
    return result;
  }, [
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
    <main
      className="fixed inset-0 h-[100dvh] w-full select-none overflow-hidden bg-[#0b0710]"
      style={{ touchAction: "none" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* ---- Top Bar & Chapter Guidance HUD ---- */}
      <div className="absolute left-0 right-0 top-0 z-20 flex flex-col items-center gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:p-4">
        {/* Top Controls Row */}
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded border border-[#3a2733] bg-[#140d18]/90 px-3 py-1.5 text-xs text-[#c9b8a4] backdrop-blur hover:border-[#c9762f] hover:text-[#ffd98a]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Town Menu
            </Link>
            <span className="hidden font-display text-lg text-[#d99a3d] md:inline">Singleplayer School</span>
            {(hasTimepiece || timeVisit) && <button onClick={activateTimepiece} className="rounded border border-[#7ba9a6] bg-[#243b3c]/90 px-2 py-1.5 text-xs text-[#cbeae1]">{timeVisit ? "Return · M" : "Timepiece · M"}</button>}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openPracticeWard("well")}
              className="flex items-center gap-1.5 rounded border border-[#6b5038] bg-[#2a1a16]/90 px-3 py-1.5 text-xs text-[#f0caa0] hover:bg-[#3d271f]"
            >
              <Wrench className="h-3.5 w-3.5 text-[#d99a3d]" /> Practice Any Ward
            </button>
            <button
              onClick={() => {
                ensureAudio();
                const m = !muted;
                getSettingsStore().update((draft) => { draft.audio.muted = m; });
                audioRef.current?.setMuted(m);
              }}
              title={muted ? "Unmute" : "Mute"}
              className="rounded border border-[#3a2733] bg-[#140d18]/80 px-2 py-1 text-[#9c8b7a] hover:text-[#d99a3d]"
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <button
              onClick={() => settingsDialogRef.current?.open()}
              className="rounded border border-[#3a2733] bg-[#140d18]/80 px-2 py-1 text-[#c9b8a4] hover:text-[#ffd98a]"
            >
              ⚙
            </button>
          </div>
        </div>

        {/* Guided Chapter Card */}
        <div className="w-[min(96vw,720px)] rounded-xl border border-[#d99a3d]/50 bg-[#160e18]/95 p-3.5 shadow-[0_12px_45px_rgba(0,0,0,0.7)] backdrop-blur sm:p-4">
          <div className="flex items-center justify-between border-b border-[#3a2733] pb-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono uppercase tracking-[0.2em] text-[#d99a3d]">{activeChap.title}</span>
              <span className="hidden text-[#8f7d6b] sm:inline">· {activeChap.summary}</span>
            </div>
            <div className="flex gap-1.5">
              {CHAPTERS.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setCurrentChapter(ch.id)}
                  title={ch.title}
                  className={`h-5 w-5 rounded text-[11px] font-mono transition-colors ${
                    currentChapter === ch.id
                      ? "bg-[#d99a3d] font-bold text-[#140d18]"
                      : completedChapters.includes(ch.id)
                      ? "border border-[#6b8e23] bg-[#1d2a1a] text-[#a8c98a]"
                      : "border border-[#3a2733] text-[#705f55]"
                  }`}
                >
                  {completedChapters.includes(ch.id) ? "✓" : ch.id}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-[#e9dfcf]">{activeChap.instruction}</p>
          <p className="mt-1 font-serif text-xs italic text-[#9c8b7a]">&ldquo;{activeChap.guideNote}&rdquo;</p>
        </div>
      </div>

      {timeVisit && <div data-testid="past-countdown" className="absolute right-3 top-48 z-20 rounded border border-[#83b9b4] bg-[#172c32]/95 px-3 py-2 text-xs text-[#d2eee5]">In the past · {Math.max(0, Math.ceil((timeVisit.endsAt - timeNow) / 1000))}s <button onClick={activateTimepiece} className="ml-2 underline">Return now</button></div>}

      {/* ---- Interactive Objectives Indicator & Wards Bar ---- */}
      <div className="absolute left-3 top-48 hidden w-56 rounded border border-[#3a2733]/70 bg-[#140d18]/80 p-3 text-xs backdrop-blur sm:block">
        <div className="mb-2 uppercase tracking-widest text-[#9c8b7a]">Tutorial Town Status</div>
        <div className="space-y-1.5 text-[#d8c9b4]">
          <div className="flex justify-between">
            <span>Repaired Wards:</span>
            <span className="font-mono text-[#a8c98a]">
              {tasks.filter((t) => t.done).length} / {tasks.length}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Carrying Kit:</span>
            <span className="font-mono text-[#d99a3d]">{hasSupply ? "YES (slow)" : "None"}</span>
          </div>
          <div className="flex justify-between">
            <span>Location:</span>
            <span data-testid="tutorial-location" className="font-mono text-[#c9b8a4]">{inside ? BUILDINGS.find((b) => b.id === inside)?.name : "The road"}</span>
          </div>
          <div className="flex justify-between">
            <span>Your position:</span>
            <span data-testid="tutorial-position" className="font-mono text-[#c9b8a4]">{Math.round(playerX)}</span>
          </div>
          <div className="flex justify-between">
            <span>Cart Position:</span>
            <span className="font-mono text-[#c9b8a4]">x={Math.round(cartX)}</span>
          </div>
          <div className="flex justify-between">
            <span>Iron Key:</span>
            <span className="font-mono text-[#e8b93c]">{hasKey ? "In Hand" : keyX !== null ? "On Road" : "Used"}</span>
          </div>
        </div>
      </div>

      {/* ---- On-Screen Touch / Keyboard Controls ---- */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-end justify-between gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4">
        {/* Left: Movement & Vigor */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Zap
              className={`h-3.5 w-3.5 ${
                stamina <= 0 ? "text-[#e06a5a]" : stamina < 0.3 ? "text-[#d99a3d]" : "text-[#a8c98a]"
              }`}
            />
            <div className="h-2 w-28 overflow-hidden rounded-full border border-[#3a2733] bg-[#140d18]/80">
              <div
                className={`h-full transition-[width] duration-300 ${
                  stamina <= 0 ? "bg-[#e06a5a]" : stamina < 0.3 ? "bg-[#d99a3d]" : "bg-[#6b8e23]"
                }`}
                style={{ width: `${Math.round(stamina * 100)}%` }}
              />
            </div>
            <span className={`text-[10px] ${exhausted ? "text-[#e06a5a]" : "text-[#9c8b7a]"}`}>
              {exhausted ? "spent — rest!" : "vigor"}
            </span>
            {hasSupply && <span className="rounded bg-[#3a2410] px-1 text-[9px] text-[#ffd98a]">hauling kit</span>}
          </div>

          <div className="flex gap-2">
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                keys.current.add("left");
              }}
              onPointerUp={() => keys.current.delete("left")}
              onPointerLeave={() => keys.current.delete("left")}
              className="h-14 w-14 rounded-full border border-[#3a2733] bg-[#140d18]/90 text-2xl text-[#d8c9b4] active:bg-[#3a2733]"
            >
              ◀
            </button>
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                keys.current.add("right");
              }}
              onPointerUp={() => keys.current.delete("right")}
              onPointerLeave={() => keys.current.delete("right")}
              className="h-14 w-14 rounded-full border border-[#3a2733] bg-[#140d18]/90 text-2xl text-[#d8c9b4] active:bg-[#3a2733]"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-end gap-2 sm:gap-3">
          {nearKeyedDoor && (
            <button onClick={() => handleBuilding("lock")} className="h-12 rounded-full border border-[#84624c] bg-[#33231f]/90 px-3 text-xs text-[#f2cf91]">{nearDoorState?.locked ? "Unlock" : "Lock"} (L)</button>
          )}
          {hasSupply ? (
            <button
              onClick={handleDropSupply}
              className="h-12 rounded-full border border-[#84624c] bg-[#33231f]/90 px-3 text-xs text-[#f2cf91] sm:h-14 sm:px-4 sm:text-sm"
            >
              Drop Kit (G)
            </button>
          ) : (
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                setCartHeld(true);
              }}
              onPointerUp={() => setCartHeld(false)}
              onPointerLeave={() => setCartHeld(false)}
              className="h-12 rounded-full border border-[#84624c] bg-[#33231f]/90 px-3 text-xs text-[#f2cf91] sm:h-14 sm:px-4 sm:text-sm"
            >
              Hold Push (Shift)
            </button>
          )}

          <div className="flex flex-col items-center gap-1">
            {actionHint && <span className="max-w-48 rounded bg-[#0d0810]/90 px-2 py-1 text-center text-xs text-[#ffd98a]">{actionHint}</span>}
            <button
              onClick={handleInteract}
              className="h-14 w-14 rounded-full border-2 border-[#d99a3d] bg-[#3a2410]/95 font-display text-xl text-[#ffd98a] shadow-[0_0_20px_rgba(217,154,61,0.3)] active:scale-95"
            >
              E
            </button>
            <span className="text-[10px] text-[#9c8b7a]">Interact</span>
          </div>

          <button
            onClick={handleHollowRuin}
            title="Practice Hollow Sabotage"
            className="h-12 rounded-full border border-[#4a1210] bg-[#2a0e0e]/90 px-3 text-xs text-[#ff8a7a] sm:h-14 sm:px-4 sm:text-sm"
          >
            Ruin (R)
          </button>
        </div>
      </div>

      {/* ---- Toast Alert ---- */}
      {toast && (
        <div className="absolute bottom-28 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-[#d99a3d]/60 bg-[#140d18]/95 px-5 py-2.5 text-center text-sm font-semibold text-[#ffd98a] shadow-2xl backdrop-blur">
          {toast}
        </div>
      )}

      {/* ---- Practice Ward Modal ---- */}
      {practiceModalOpen && practicePuzzle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur">
          <div className="w-[min(94vw,600px)] rounded-xl border border-[#d99a3d]/60 bg-[#160e18] p-5 shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#3a2733] pb-3">
              <div>
                <span className="font-mono text-xs uppercase text-[#d99a3d]">Free Practice Workbench</span>
                <h2 className="font-display text-3xl text-[#e9dfcf]">{WARD_JOBS[practiceKind].title}</h2>
              </div>
              <button
                onClick={() => setPracticeModalOpen(false)}
                className="rounded border border-[#3a2733] px-3 py-1 text-sm text-[#c9b8a4] hover:text-[#ffd98a]"
              >
                ✕ Close
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 border-b border-[#3a2733] pb-3">
              {(Object.keys(WARD_JOBS) as WardKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => openPracticeWard(k)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    practiceKind === k
                      ? "bg-[#d99a3d] font-bold text-[#140d18]"
                      : "border border-[#3a2733] bg-[#1d1420] text-[#c9b8a4] hover:border-[#d99a3d]"
                  }`}
                >
                  {WARD_JOBS[k].title.split("·")[0].trim()}
                </button>
              ))}
            </div>

            <p className="mt-3 text-sm text-[#c9b8a4]">{WARD_JOBS[practiceKind].instruction}</p>

            <div className="mt-4 flex justify-between text-xs text-[#9c8b7a]">
              <span>Progress: {Math.round(wardProgress(practicePuzzle) * 100)}%</span>
              <span>Moves: {practicePuzzle.moves}</span>
            </div>

            <div className="mt-4 flex justify-center">
              {wardSolved(practicePuzzle) ? (
                <div className="text-center">
                  <p className="font-display text-2xl text-[#a8c98a]">✓ Ward Solved Successfully!</p>
                  <button
                    onClick={() => openPracticeWard(practiceKind)}
                    className="mt-3 rounded border border-[#6b8e23] bg-[#1d2a1a] px-4 py-2 text-xs text-[#a8c98a]"
                  >
                    Reset & Practice Again
                  </button>
                </div>
              ) : (
                <div
                  className="w-full"
                  onClick={(event) => {
                    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-ward-move]");
                    if (button && !button.disabled) handlePracticeMove(Number(button.dataset.wardMove));
                  }}
                  dangerouslySetInnerHTML={{ __html: renderWardJob(wardView(practiceKind, WARD_JOBS[practiceKind].title, practicePuzzle, Math.max(0, practicePreviewUntil - practiceNow))) }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
