"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, DoorOpen, Flame, Mic, MicOff, ScrollText, Trophy, Volume2, Zap } from "lucide-react";
import { Renderer } from "@/game/render";
import { useGameStream } from "./useGameStream";
import { BUILDINGS, DOOR_REACH, doorX } from "@/game/buildings";
import { WardPanel } from "@/game/ward-ui";
import { TimePanel } from "@/game/time-ui";
import type { AudioDirector } from "@/game/audio";
import type { VoiceChat, VoiceStatus } from "@/game/voice";
import { SettingsStore, applyDocumentPreferences, createDefaultSettings, keyLabel, matchesControl, type BindableAction, type GameSettings } from "@/game/settings";
import { SettingsDialog } from "@/game/settings-ui";
import { BottomControls, ChatBox, EndOverlay, LobbyOverlay, MidHud, NoteReader, PinPanel, RoleBanner, Toast, TopBar } from "./hud";
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
  });
  const [tasksOpen, setTasksOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinText, setPinText] = useState("");
  const [noteFocus, setNoteFocus] = useState<{ id: string; x: number; author: string; text: string } | null>(null);
  const focusRef = useRef<number | null>(null);
  const noteOpenRef = useRef(false);
  const rendererRef = useRef<Renderer | null>(null);
  useEffect(() => { focusRef.current = noteFocus ? noteFocus.x : null; noteOpenRef.current = !!noteFocus; }, [noteFocus]);
  const [leaving, setLeaving] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(createDefaultSettings);

  const snapRef = useRef<Snapshot | null>(null);
  const chatOpenRef = useRef(false);
  const displayX = useRef(new Map<string, number>());
  const keys = useRef(new Set<string>());
  const lastDir = useRef(0);
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
  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  const send = useCallback(async (payload: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500); // hung POSTs must not pile up; next poll resyncs
    try {
      const res = await fetch("/api/game/input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, playerId: getPid(), ...payload }),
        signal: controller.signal,
      });
      const data = await res.json();
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

  useEffect(() => {
    const store = getSettingsStore();
    setSettings(store.value);
    setMuted(store.value.audio.muted);
    applyDocumentPreferences(store.value);
    const unsubscribe = store.subscribe((next) => {
      setSettings(next);
      setMuted(next.audio.muted);
      applyDocumentPreferences(next);
      voiceRef.current?.applyMix();
    });
    const dialog = new SettingsDialog(store, document.body, { onOpen: releaseInputs });
    settingsDialogRef.current = dialog;
    return () => {
      unsubscribe();
      dialog.destroy();
      settingsDialogRef.current = null;
      audioRef.current?.destroy();
      audioRef.current = null;
    };
  }, [getSettingsStore, releaseInputs]);

  const ensureAudio = useCallback(async () => {
    if (!audioRef.current) {
      audioInitRef.current ??= import("@/game/audio");
      const mod = await audioInitRef.current;
      if (!audioRef.current) audioRef.current = new mod.AudioDirector(getSettingsStore());
    }
    audioRef.current.start();
  }, [getSettingsStore]);

  // Shared repair panel: built once, never re-mounted on each 100ms state poll.
  useEffect(() => {
    const panel = new WardPanel(document.body, {
      move: (wardId, move) => { void send({ action: "ward_move", wardId, move }); },
      close: () => { void send({ action: "ward_cancel" }); },
      opened: () => releaseInputs(),
    });
    wardPanelRef.current = panel;
    return () => { panel.destroy(); wardPanelRef.current = null; };
  }, [releaseInputs, send]);

  useEffect(() => {
    const panel = new TimePanel(document.body, { travel: (targetAt) => { void send({ action: "time_travel", targetAt }); }, opened: releaseInputs });
    timePanelRef.current = panel;
    return () => { panel.destroy(); timePanelRef.current = null; };
  }, [releaseInputs, send]);

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
  useEffect(() => {
    const goodbye = () => { void voiceRef.current?.stop(); };
    window.addEventListener("pagehide", goodbye);
    return () => {
      window.removeEventListener("pagehide", goodbye);
      voiceInitRef.current?.then((v) => { v.destroy(); }).catch(() => {});
      voiceRef.current = null;
    };
  }, []);


  useGameStream({
    code, send, getPid, setJoinError, setSnap, setRoleBanner,
    snapRef, pendingInputRef, mainRef, wardPanelRef, timePanelRef, settingsDialogRef, noteOpenRef, audioRef, lastPhase, leavingRef,
  });

  // ---- input: clients only ever send intent ----
  const computeDir = useCallback(() => {
    const k = keys.current;
    const d = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
    if (d !== lastDir.current) { lastDir.current = d; void send({ dir: d }); }
  }, [send]);

  useEffect(() => {
    const unlockAudio = () => ensureAudio();
    const down = (e: KeyboardEvent) => {
      unlockAudio();
      if (settingsDialogRef.current?.isOpen || timePanelRef.current?.isOpen) return;
      if (wardPanelRef.current?.isOpen) {
        if (e.code === "Escape") { e.preventDefault(); void send({ action: "ward_cancel" }); }
        return; // Tab, Enter and Space belong to the focused puzzle buttons.
      }
      if (chatOpenRef.current) {
        if (e.key === "Escape") setChatOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
      const controls = getSettingsStore().value.controls;
      const bound = (action: BindableAction) => matchesControl(controls, action, e.code);
      if (bound("left")) { keys.current.add("left"); computeDir(); e.preventDefault(); }
      else if (bound("right")) { keys.current.add("right"); computeDir(); e.preventDefault(); }
      else if (e.code === "KeyM" && !e.repeat) { activateTimepiece(); e.preventDefault(); }
      else if (e.code === "KeyL" && !e.repeat) { void send({ action: "door_lock" }); e.preventDefault(); }
      else if (e.code === "KeyN" && !e.repeat) { setPinOpen((v) => !v); e.preventDefault(); }
      else if (bound("interact") && !e.repeat) { interactDown(); e.preventDefault(); }
      else if (bound("ability") && !e.repeat) { void send({ action: "ability" }); e.preventDefault(); }
      else if (bound("blackout") && !e.repeat) { void send({ action: "blackout" }); e.preventDefault(); }
      else if (bound("push") && !e.repeat) { void send({ cartHeld: true }); e.preventDefault(); }
      else if (bound("drop") && !e.repeat) { void send({ action: "drop_supply" }); e.preventDefault(); }
      else if (bound("ruin") && !e.repeat) { void send({ action: "sabotage" }); e.preventDefault(); }
      else if (bound("chat") && !e.repeat) { openChat(); e.preventDefault(); }
      else if (bound("talk") && !e.repeat) {
        void getVoice().then((voice) => { if (voice.current.active) voice.stop(); else void voice.start(); });
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (settingsDialogRef.current?.isOpen || timePanelRef.current?.isOpen || wardPanelRef.current?.isOpen) return;
      const controls = getSettingsStore().value.controls;
      if (matchesControl(controls, "left", e.code)) { keys.current.delete("left"); computeDir(); }
      else if (matchesControl(controls, "right", e.code)) { keys.current.delete("right"); computeDir(); }
      else if (matchesControl(controls, "interact", e.code)) interactUp();
      else if (matchesControl(controls, "push", e.code)) void send({ cartHeld: false });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("blur", releaseInputs);
    return () => {
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", unlockAudio); window.removeEventListener("blur", releaseInputs);
    };
  }, [computeDir, send, ensureAudio, getSettingsStore, getVoice, interactDown, interactUp, openChat, releaseInputs, activateTimepiece]);

  // ---- render loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const renderer = new Renderer();
    rendererRef.current = renderer;
    const store = getSettingsStore();
    renderer.setSettings(store.value);
    let raf = 0;
    let last = performance.now();
    // visualViewport: mobile URL bars otherwise clip the bottom controls
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
    const unsubscribe = store.subscribe((next) => { renderer.setSettings(next); resize(); });
    resize();
    // visualViewport fires continuously while the mobile URL bar animates — debounce
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { resizeTimer = null; resize(); }, 150);
    };
    window.addEventListener("resize", debouncedResize);
    window.visualViewport?.addEventListener("resize", debouncedResize);
    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const s = snapRef.current;
      if (!s) return;
      for (const p of s.players) {
        const cur = displayX.current.get(p.id);
        if (cur === undefined || Math.abs(cur - p.x) > 300) { displayX.current.set(p.id, p.x); continue; }
        if (p.id === s.self.id && s.phase === "playing" && !s.self.caged) {
          // Local prediction at the authoritative speed; the server poll only
          // corrects drift, so movement no longer lags behind the input.
          const spd = !s.self.alive ? GHOST_SPEED : s.self.hasSupply ? CARRY_SPEED : SPEED;
          const pred = cur + lastDir.current * spd * dt;
          displayX.current.set(p.id, Math.abs(p.x - pred) > 90 ? p.x : pred + (p.x - pred) * Math.min(1, dt * 25));
        } else {
          displayX.current.set(p.id, cur + (p.x - cur) * Math.min(1, dt * 16));
        }
      }
      renderer.setFocus(focusRef.current);
      renderer.render(ctx, vw(), vh(), s, displayX.current, nowMs / 1000, dt);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", debouncedResize);
      window.visualViewport?.removeEventListener("resize", debouncedResize);
    };
  }, [getSettingsStore]);

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

  const me = useMemo(() => snap?.players.find((p) => p.id === snap.self.id), [snap]);
  const nearestNote = useMemo(() => snap && me ? (snap.notes ?? [])
    .filter((n) => Math.abs(n.x - me.x) <= 150)
    .sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0] : undefined, [snap, me]);
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
          <TopBar s={s} me={me} nearestNote={nearestNote} muted={muted} leaving={leaving} voiceStatus={voiceStatus} controls={settings.controls}
            onCopyCode={() => { void navigator.clipboard?.writeText(s.code); setToast("Town code copied"); setTimeout(() => setToast(null), 1500); }}
            onTimepiece={activateTimepiece} onPinToggle={() => setPinOpen((v) => !v)} onReadNote={setNoteFocus}
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

          {noteFocus && <NoteReader note={noteFocus} onClose={() => setNoteFocus(null)} />}

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