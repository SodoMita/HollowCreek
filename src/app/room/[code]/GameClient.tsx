"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, DoorOpen, Flame, Mic, MicOff, ScrollText, Trophy, Volume2, Zap } from "lucide-react";
import { Renderer, ZOOM_MAX, ZOOM_READ } from "@/game/render";
import type { NetState } from "./useGameRender";
import { useGameStream } from "./useGameStream";
import { useGameInput } from "./useGameInput";
import { useGameRender } from "./useGameRender";
import { useGameOverlays } from "./useGameOverlays";
import { BUILDINGS, DOOR_REACH, doorX } from "@/game/buildings";
import { WardPanel } from "@/game/ward-ui";
import { TimePanel } from "@/game/time-ui";
import type { AudioDirector } from "@/game/audio";
import type { VoiceChat, VoiceStatus } from "@/game/voice";
import { SettingsStore, applyDocumentPreferences, createDefaultSettings, keyLabel, matchesControl, type BindableAction, type GameSettings } from "@/game/settings";
import { SettingsDialog } from "@/game/settings-ui";
import { NoteReader, RoleBanner, Toast } from "./hud";
import { Minimap } from "./minimap";
import { MidHud } from "./midhud";
import { BottomControls, TopBar } from "./bars";
import { ChatBox, PinPanel } from "./chat";
import { EndOverlay, LobbyOverlay } from "./overlays";
import { BELL_X, CARRY_SPEED, GHOST_SPEED, SPEED } from "@/game/types";
import type { Snapshot } from "@/game/types";

function getPid(): string {
  let pid = localStorage.getItem("hc_pid");
  if (!pid) { pid = crypto.randomUUID(); localStorage.setItem("hc_pid", pid); }
  return pid;
}

export default function GameClient({ code }: { code: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [roleBanner, setRoleBanner] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({
    active: false,
    starting: false,
    muted: false,
    nearby: 0,
    connected: 0,
    p2pCount: 0,
    relayCount: 0,
    mode: "idle",
    speaking: false,
    error: null,
    reconnecting: false,
  });
  const [tasksOpen, setTasksOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinText, setPinText] = useState("");
  const [noteFocus, setNoteFocus] = useState<{ id: string; x: number; author: string; text: string } | null>(null);
  const focusRef = useRef<number | null>(null);
  const noteOpenRef = useRef(false);
  const rendererRef = useRef<Renderer | null>(null);
  useEffect(() => { focusRef.current = noteFocus ? noteFocus.x : null; }, [noteFocus]);
  // The glass: a continuous zoom (mouse wheel, trackpad, pinch) with the
  // spyglass button / Z snapping between lowered and raised. `glassUp` is what
  // the HUD shows; the renderer reads the live value through the ref.
  const [glassUp, setGlassUp] = useState(false);
  useEffect(() => { noteOpenRef.current = glassUp; }, [glassUp]);
  const zoomRef = useRef(1);
  const applyZoom = useCallback((z: number) => {
    const clamped = Math.max(1, Math.min(ZOOM_MAX, z));
    zoomRef.current = clamped;
    rendererRef.current?.setViewZoom(clamped);
    setGlassUp((up) => (clamped > 1.05) !== up ? clamped > 1.05 : up);
    if (clamped <= 1.05) setNoteFocus(null);
  }, []);
  const lowerGlass = useCallback(() => applyZoom(1), [applyZoom]);
  /** Spyglass button / Z: raise to the reading zoom (aimed at a nearby page if there is one), or lower. */
  const toggleGlass = useCallback((page: { id: string; x: number; author: string; text: string } | null) => {
    if (zoomRef.current > 1.05) { lowerGlass(); return; }
    setNoteFocus(page);
    applyZoom(ZOOM_READ);
  }, [applyZoom, lowerGlass]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      applyZoom(zoomRef.current * step);
    };
    // Pinch: track two pointers on the canvas; the zoom follows the distance ratio.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart = 0, zoomStart = 1;
    const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { pinchStart = dist(); zoomStart = zoomRef.current; }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart > 0) applyZoom(zoomStart * dist() / pinchStart);
    };
    const onUp = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = 0; };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [applyZoom]);
  const [leaving, setLeaving] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(createDefaultSettings);

  const snapRef = useRef<Snapshot | null>(null);
  const chatOpenRef = useRef(false);
  const displayX = useRef(new Map<string, number>());
  const keys = useRef(new Set<string>());
  const lastDir = useRef(0);
  // Prediction bookkeeping: measured round trip, when the last positions
  // arrived, and our own recent steering, so the render loop can replay the
  // inputs the server has not acknowledged yet (see useGameRender).
  const netRef = useRef<NetState>({ rttMs: 150, arrival: 0, inputs: [] });
  const audioRef = useRef<AudioDirector | null>(null);
  const voiceRef = useRef<VoiceChat | null>(null);
  const audioInitRef = useRef<Promise<typeof import("@/game/audio")> | null>(null);
  const voiceInitRef = useRef<Promise<VoiceChat> | null>(null);
  const wardPanelRef = useRef<WardPanel | null>(null);
  const timePanelRef = useRef<TimePanel | null>(null);
  const settingsStoreRef = useRef<SettingsStore | null>(null);
  const settingsDialogRef = useRef<SettingsDialog | null>(null);
  const interactToggled = useRef(false);
  const lastPhase = useRef<string>("lobby");
  const leavingRef = useRef(false);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const pendingInputRef = useRef<Record<string, unknown> | null>(null); // last intent the server never got

  const send = useCallback(async (payload: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500); // hung POSTs must not pile up; next poll resyncs
    const sentAt = performance.now();
    try {
      const res = await fetch("/api/game/input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, playerId: getPid(), ...payload }),
        signal: controller.signal,
      });
      const data = await res.json();
      const rtt = Math.min(1500, Math.max(20, performance.now() - sentAt));
      netRef.current.rttMs = netRef.current.rttMs * 0.7 + rtt * 0.3;
      if (!data.ok && data.error) {
        setToast(data.error);
        setTimeout(() => setToast(null), 2200);
      }
    } catch { pendingInputRef.current = payload; } // dropped intent: re-sent after the next healthy poll
    finally { clearTimeout(timeout); }
  }, [code]);

  const getSettingsStore = useCallback(() => {
    if (!settingsStoreRef.current) settingsStoreRef.current = new SettingsStore();
    return settingsStoreRef.current;
  }, []);

  const stopInteract = useCallback(() => {
    interactToggled.current = false;
    void send({ interactHeld: false });
  }, [send]);

  const releaseInputs = useCallback(() => {
    keys.current.clear();
    lastDir.current = 0;
    interactToggled.current = false;
    void send({ dir: 0, interactHeld: false, cartHeld: false });
  }, [send]);

  const activateTimepiece = useCallback(() => {
    const current = snapRef.current;
    if (current?.time?.mode === "past") { void send({ action: "time_return" }); return; }
    if (current?.self.hasTimepiece && current.time) timePanelRef.current?.open(current.time);
  }, [send]);

  /** Free the seat before navigating, so the lobby and host update at once. */
  const leaveToTownList = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    voiceRef.current?.stop();
    const body = JSON.stringify({ code, playerId: getPid() });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const result = await fetch("/api/game/leave", {
        method: "POST", headers: { "content-type": "application/json" },
        body, keepalive: true, signal: controller.signal,
      });
      if (!result.ok) throw new Error("Leave request failed");
    } catch {
      try { navigator.sendBeacon("/api/game/leave", new Blob([body], { type: "application/json" })); }
      catch { /* still leave the page if the server is unreachable */ }
    } finally {
      clearTimeout(timeout);
      router.replace("/");
    }
  }, [code, router]);

  const interactDown = useCallback(() => {
    if (getSettingsStore().value.controls.interactMode === "toggle") {
      interactToggled.current = !interactToggled.current;
      void send({ action: "interact", interactHeld: interactToggled.current });
    } else void send({ action: "interact", interactHeld: true });
  }, [getSettingsStore, send]);

  const interactUp = useCallback(() => {
    if (getSettingsStore().value.controls.interactMode === "hold") stopInteract();
  }, [getSettingsStore, stopInteract]);

  const openChat = useCallback(() => {
    stopInteract();
    setChatOpen(true);
    // focus the field on desktop only — popping the keyboard on phones is hostile
    if (window.matchMedia("(pointer: fine)").matches) setTimeout(() => chatInputRef.current?.focus(), 30);
  }, [stopInteract]);


  const ensureAudio = useCallback(async () => {
    if (!audioRef.current) {
      audioInitRef.current ??= import("@/game/audio");
      const mod = await audioInitRef.current;
      if (!audioRef.current) audioRef.current = new mod.AudioDirector(getSettingsStore());
    }
    audioRef.current.start();
  }, [getSettingsStore]);

  // Shared repair panel: built once, never re-mounted on each 100ms state poll.


  // Voice is off by default and its module loads only on first use — the page
  // stays light until the player actually joins voice. Only then getUserMedia().
  const getVoice = useCallback((): Promise<VoiceChat> => {
    voiceInitRef.current ??= import("@/game/voice").then((mod) => {
      const v = new mod.VoiceChat({ baseUrl: () => "", roomCode: () => code,
        playerId: getPid, getSettings: () => getSettingsStore().value, onStatus: setVoiceStatus });
      voiceRef.current = v;
      return v;
    });
    return voiceInitRef.current;
  }, [code, getSettingsStore]);


  useGameOverlays({
    send, getSettingsStore, releaseInputs, ensureAudio, getVoice, setSettings, setMuted,
    chatOpen, chatOpenRef, settingsDialogRef, wardPanelRef, timePanelRef, voiceRef, voiceInitRef, audioRef,
  });

  useGameStream({
    code, send, getPid, setJoinError, setSnap, setRoleBanner,
    snapRef, pendingInputRef, mainRef, wardPanelRef, timePanelRef, settingsDialogRef, noteOpenRef, audioRef, lastPhase, leavingRef, netRef,
  });

  // ---- input: clients only ever send intent ----
  const computeDir = useCallback(() => {
    const k = keys.current;
    const d = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
    if (d !== lastDir.current) {
      lastDir.current = d;
      const log = netRef.current.inputs;
      log.push({ t: performance.now(), dir: d });
      if (log.length > 64) log.splice(0, log.length - 64);
      void send({ dir: d });
    }
  }, [send]);

  const me = useMemo(() => snap?.players.find((p) => p.id === snap.self.id), [snap]);
  const nearestNote = useMemo(() => snap && me ? (snap.notes ?? [])
    .filter((n) => Math.abs(n.x - me.x) <= 150)
    .sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0] : undefined, [snap, me]);

  useGameInput({
    send, keys, lastDir, computeDir, ensureAudio, releaseInputs, interactDown, interactUp, openChat, stopInteract,
    wardPanelRef, timePanelRef, settingsDialogRef, chatOpen, pinOpen, setChatOpen, setPinOpen, setPinText, activateTimepiece,
    chatOpenRef, noteOpenRef, closeNote: lowerGlass, toggleGlass: () => toggleGlass(nearestNote ?? null), getSettingsStore, getVoice,
  });

  useGameRender({ canvasRef, rendererRef, snapRef, displayX, focusRef, lastDir, netRef, getSettingsStore });

  const holdMove = (dir: "left" | "right", on: boolean) => {
    if (on) keys.current.add(dir); else keys.current.delete(dir);
    computeDir();
  };

  const submitChat = () => {
    if (chatText.trim()) void send({ chat: chatText.trim() });
    setChatText("");
    setChatOpen(false);
  };

  const toggleVoice = () => {
    if (voiceStatus.starting) return;
    void getVoice().then((voice) => {
      if (voiceStatus.active) voice.stop();
      else void voice.start();
    });
  };
  const toggleMic = () => { void getVoice().then((v) => v.setMuted(!voiceStatus.muted)); };

  // ------------------------------------------------------------------ UI ---

  const pinNote = async () => {
    const text = pinText.trim();
    if (!text) return;
    await send({ action: "pin_note", noteText: text });
    setPinText(""); setPinOpen(false);
  };
  const s = snap;
  const nearbyKeyedDoor = useMemo(() => me && s ? BUILDINGS.find((b) => Math.abs(doorX(b) - me.x) <= DOOR_REACH && s.self.doorKeys?.includes(b.id)) : undefined, [me, s]);
  const nearbyDoorLocked = useMemo(() => s?.doors?.find((d) => d.id === nearbyKeyedDoor?.id)?.locked, [s, nearbyKeyedDoor]);
  const secsLeft = s?.meeting ? Math.max(0, Math.ceil((s.meeting.endsAt - s.now) / 1000)) : 0;
  const voteOptions = useMemo(() => s ? [
    ...s.players.filter((p) => p.alive && !p.caged && p.id !== s.self.id).map((p) => ({ key: p.id, label: `Cage ${p.name}`, color: p.color })),
    ...s.players.filter((p) => p.caged).map((p) => ({ key: `free:${p.id}`, label: `Free ${p.name}`, color: "#7fb069" })),
    { key: "skip", label: "Abstain", color: "#7f8c8d" },
  ] : [], [s]);

  if (joinError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0b0710] px-6 text-center">
        <p className="font-display text-4xl text-[#e06a5a]">The road is closed</p>
        <p className="text-[#9c8b7a]">{joinError}</p>
        <button onClick={() => router.push("/")} className="rounded bg-[#8f3b1f] px-6 py-2.5 font-display text-xl text-[#f3e6d0] hover:bg-[#a84a26]">
          Turn back
        </button>
      </main>
    );
  }


  return (
    <main id="main" ref={mainRef} className="fixed inset-0 h-[100dvh] w-full select-none overflow-hidden bg-[#0b0710]" style={{ touchAction: "none" }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-[#8f3b1f] focus:px-3 focus:py-2 focus:text-[#f3e6d0]">Skip to the game</a>
      <canvas ref={canvasRef} className="absolute inset-0" />

      {!s && !joinError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="hc-title-flicker font-display text-3xl text-[#c9b8a4]">Walking the old road into town…</p>
        </div>
      )}

      {s && (
        <>
          <TopBar s={s} me={me} nearestNote={nearestNote} glassUp={glassUp} muted={muted} leaving={leaving} voiceStatus={voiceStatus} controls={settings.controls}
            onCopyCode={() => { void navigator.clipboard?.writeText(s.code); setToast("Town code copied"); setTimeout(() => setToast(null), 1500); }}
            onTimepiece={activateTimepiece} onPinToggle={() => setPinOpen((v) => !v)} onReadNote={toggleGlass}
            onDropKit={() => void send({ action: "drop_supply" })}
            onMute={() => { ensureAudio(); const m = !muted; getSettingsStore().update((draft) => { draft.audio.muted = m; }); audioRef.current?.setMuted(m); }}
            onToggleVoice={toggleVoice} onToggleMic={toggleMic}
            onSettings={() => settingsDialogRef.current?.open()} onLeave={() => void leaveToTownList()} />

          <MidHud s={s} controls={settings.controls} me={me} secsLeft={secsLeft} voteOptions={voteOptions} tasksOpen={tasksOpen} voiceStatus={voiceStatus}
            onTimepiece={activateTimepiece} onToggleTasks={() => setTasksOpen(!tasksOpen)}
            onVote={(key) => send({ action: "vote", vote: key })} onSabotage={() => void send({ action: "sabotage" })}
            onResumePlayback={() => void voiceRef.current?.resumePlayback()} />
          <BottomControls s={s} controls={settings.controls} nearbyKeyedDoor={!!nearbyKeyedDoor} nearbyDoorLocked={nearbyDoorLocked}
            onMove={holdMove} onPush={(on) => void send({ cartHeld: on })} onDropKit={() => void send({ action: "drop_supply" })}
            onChat={openChat} onDoorLock={() => void send({ action: "door_lock" })}
            onInteractDown={interactDown} onInteractUp={interactUp}
            onBlackout={() => send({ action: "blackout" })} onAbility={() => send({ action: "ability" })} />

          {/* ---- chat ---- */}
          {pinOpen && s.phase === "playing" && (
            <PinPanel text={pinText} onText={setPinText} onSubmit={() => void pinNote()} onCancel={() => { setPinOpen(false); setPinText(""); }} />
          )}

          {s.phase === "playing" && !glassUp && <Minimap s={s} me={me} />}
          {glassUp && <NoteReader note={noteFocus ?? { text: "", author: "" }} onClose={lowerGlass} />}

          {chatOpen && (
            <ChatBox alive={s.self.alive} text={chatText} onText={setChatText} onSubmit={submitChat} inputRef={chatInputRef} />
          )}

          {/* ---- lobby overlay ---- */}
          {s.phase === "lobby" && (
            <LobbyOverlay s={s} leaving={leaving} voiceStatus={voiceStatus} controls={settings.controls}
              onStart={() => send({ action: "start" })} onSettings={() => settingsDialogRef.current?.open()}
              onLeave={() => void leaveToTownList()} onToggleVoice={toggleVoice} onToggleMic={toggleMic}
              onResumePlayback={() => void voiceRef.current?.resumePlayback()} />
          )}

          {/* ---- role reveal ---- */}
          {roleBanner && <RoleBanner role={roleBanner} controls={settings.controls} />}

          {/* ---- end overlay ---- */}
          {s.phase === "ended" && (
            <EndOverlay s={s} voiceStatus={voiceStatus}
              onRestart={() => send({ action: "restart" })} onSettings={() => settingsDialogRef.current?.open()}
              onToggleVoice={toggleVoice} onToggleMic={toggleMic} onResumePlayback={() => void voiceRef.current?.resumePlayback()} />
          )}

          <Toast text={toast} />
        </>
      )}
    </main>
  );
}