"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, DoorOpen, Flame, Mic, MicOff, ScrollText, Trophy, Volume2, Zap } from "lucide-react";
import { Renderer } from "@/game/render";
import { BUILDINGS, DOOR_REACH, doorX } from "@/game/buildings";
import { WardPanel } from "@/game/ward-ui";
import { TimePanel } from "@/game/time-ui";
import type { AudioDirector } from "@/game/audio";
import type { VoiceChat, VoiceStatus } from "@/game/voice";
import { SettingsStore, applyDocumentPreferences, createDefaultSettings, keyLabel, matchesControl, type BindableAction, type GameSettings } from "@/game/settings";
import { SettingsDialog } from "@/game/settings-ui";
import { EndOverlay, LobbyOverlay, NoteReader, RoleBanner, Toast, TopBar } from "./hud";
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

  // ---- join + poll ----
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const name = localStorage.getItem("hc_name") || "Stranger";
      const doJoin = async (): Promise<boolean> => {
        try {
          const res = await fetch("/api/game/join", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code, playerId: getPid(), name }),
          });
          const data = await res.json();
          if (!alive) return false;
          if (!res.ok || !data.ok) { setJoinError(data.error ?? "Could not enter the town."); return false; }
          // the server may re-adopt a stale seat under our name — use its canonical id
          if (data.playerId && data.playerId !== getPid()) localStorage.setItem("hc_pid", data.playerId);
          return true;
        } catch { return false; }
      };
      if (!(await doJoin())) return;
      let inflight = false;
      let failures = 0;
      let delay = 100;
      let lastFp = "";
      let lastShownNow = 0;
      let lastRev = ""; // server fingerprint of the last state we hold
      let notFound = 0; // consecutive 404s — after 3, the server lost us (restart): re-join
      const tick = async () => {
        if (inflight) return; // never stack overlapping state fetches
        inflight = true;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const revParam = lastRev ? `&rev=${encodeURIComponent(lastRev)}` : "";
          const r = await fetch(`/api/game/state?code=${code}&playerId=${getPid()}${revParam}`, { signal: controller.signal });
          if (r.status === 304) { failures = 0; return; } // unchanged — skip the payload entirely
          if (r.status === 404) {
            failures++;
            if (++notFound >= 3) { notFound = 0; await doJoin(); } // server restarted — reclaim the seat
            return;
          }
          if (!r.ok) { failures++; return; }
          notFound = 0;
          const etag = r.headers.get("etag");
          if (etag) lastRev = etag;
          const s: Snapshot = await r.json();
          if (!alive) return;
          failures = 0;
          snapRef.current = s;
          if (pendingInputRef.current) { const retry = pendingInputRef.current; pendingInputRef.current = null; void send(retry); }
          mainRef.current?.toggleAttribute("inert", !!(wardPanelRef.current?.isOpen || timePanelRef.current?.isOpen || settingsDialogRef.current?.isOpen || noteOpenRef.current));
          if (timePanelRef.current?.isOpen && (!s.self.hasTimepiece || s.phase !== "playing")) timePanelRef.current.close();
          wardPanelRef.current?.update(s.minigame, s.self.stamina, s.self.exhausted);
          // Skip the React re-render when nothing but the clock changed (idle players cost ~nothing then).
          const fp = JSON.stringify({ ...s, now: 0 });
          if (fp !== lastFp || s.now - lastShownNow >= 900) {
            lastFp = fp; lastShownNow = s.now;
            setSnap(s);
          }
          audioRef.current?.update(s);
          if (lastPhase.current === "lobby" && s.phase === "playing") {
            setRoleBanner(s.self.role === "hollow" ? "hollow" : "crew");
            setTimeout(() => setRoleBanner(null), 4500);
          }
          lastPhase.current = s.phase;
        } catch { failures++; } // retry with backoff below
        finally { clearTimeout(timeout); inflight = false; }
      };
      timer = setInterval(() => {
        // adaptive: 100ms while healthy, up to 1s after repeated failures or when the tab is hidden
        const hidden = typeof document !== "undefined" && document.hidden;
        const base = failures >= 3 || hidden ? Math.min(1000 * 2 ** Math.min(Math.max(failures - 3, 0), 3), 8000) : 100;
        const want = Math.round(base * (0.8 + Math.random() * 0.4)); // jitter avoids thundering herd
        if (want !== delay) { delay = want; if (timer) clearInterval(timer); timer = setInterval(tick, delay); }
        void tick();
      }, 100);
      void tick();
    })();
    const bye = () => {
      if (leavingRef.current) return; // explicit leave already freed the seat
      try {
        navigator.sendBeacon(
          "/api/game/leave",
          new Blob([JSON.stringify({ code, playerId: getPid() })], { type: "application/json" })
        );
      } catch { /* noop */ }
    };
    window.addEventListener("pagehide", bye);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      window.removeEventListener("pagehide", bye);
      if (!leavingRef.current) void send({ dir: 0, interactHeld: false, cartHeld: false });
      bye();
    };
  }, [code, send]);

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

  const me = snap?.players.find((p) => p.id === snap.self.id);
  const nearestNote = snap && me ? (snap.notes ?? [])
    .filter((n) => Math.abs(n.x - me.x) <= 150)
    .sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0] : undefined;
  const pinNote = async () => {
    const text = pinText.trim();
    if (!text) return;
    await send({ action: "pin_note", noteText: text });
    setPinText(""); setPinOpen(false);
  };
  const s = snap;
  const nearbyKeyedDoor = me && s ? BUILDINGS.find((b) => Math.abs(doorX(b) - me.x) <= DOOR_REACH && s.self.doorKeys?.includes(b.id)) : undefined;
  const nearbyDoorLocked = s?.doors?.find((d) => d.id === nearbyKeyedDoor?.id)?.locked;
  const secsLeft = s?.meeting ? Math.max(0, Math.ceil((s.meeting.endsAt - s.now) / 1000)) : 0;
  const voteOptions = s ? [
    ...s.players.filter((p) => p.alive && !p.caged && p.id !== s.self.id).map((p) => ({ key: p.id, label: `Cage ${p.name}`, color: p.color })),
    ...s.players.filter((p) => p.caged).map((p) => ({ key: `free:${p.id}`, label: `Free ${p.name}`, color: "#7fb069" })),
    { key: "skip", label: "Abstain", color: "#7f8c8d" },
  ] : [];

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

          {s.phase !== "lobby" && voiceStatus.error && (
            <p role="alert" className="absolute right-2 top-12 z-20 max-w-[min(70vw,250px)] rounded border border-[#6e3433] bg-[#1c1216]/95 px-3 py-2 text-xs text-[#e29a84]">
              {voiceStatus.error}
              {voiceStatus.error.includes("Enable sound") && <button onClick={() => void voiceRef.current?.resumePlayback()} className="ml-2 underline">Enable sound</button>}
            </p>
          )}

          {s.time?.mode === "past" && <div data-testid="past-countdown" className="hc-hud-item absolute left-1/2 top-14 z-10 -translate-x-1/2 rounded border border-[#83b9b4]/70 bg-[#172c32]/95 px-4 py-2 text-center text-xs tabular-nums text-[#d2eee5] shadow-lg"><span className="font-semibold uppercase tracking-widest">In the past</span> · {Math.max(0, Math.ceil(((s.time.endsAt ?? s.now) - s.now) / 1000))}s remaining <button onClick={activateTimepiece} className="ml-2 underline">Return now</button></div>}

          {/* ---- task list ---- */}
          {s.phase !== "lobby" && s.self.alive && s.tasks.length > 0 && (
            <div className="hc-hud-item hc-hud-fade hc-task-list absolute left-2 top-12 w-56 max-w-[70vw] rounded border border-[#3a2733]/60 bg-[#140d18]/70 p-2.5 text-xs backdrop-blur sm:left-3 sm:top-20 sm:w-60 sm:p-3">
              <button onClick={() => setTasksOpen(!tasksOpen)} className="mb-1.5 flex w-full items-center justify-between uppercase tracking-widest text-[#9c8b7a]">
                <span>{s.self.role === "hollow" && s.time?.mode !== "past" ? "Town wards (pretend)" : "Town wards · shared"}</span>
                <span className="sm:hidden">{tasksOpen ? "▾" : "▸"}</span>
              </button>
              <div className={`${tasksOpen ? "block" : "hidden"} max-h-[26dvh] overflow-y-auto sm:block`}>
              {s.tasks.map((t) => (
                <div key={t.id} className={`flex items-center gap-2 py-0.5 ${t.done ? "text-[#6b8e5a] line-through" : "text-[#d8c9b4]"}`}>
                  <span>{t.done ? "✓" : t.delivered ? "▣" : "◇"}</span><span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {!t.done && (
                    <span className={`ml-auto shrink-0 ${t.delivered ? "text-[#a8c98a]" : "text-[#d99a3d]"}`}>
                      {t.delivered ? t.progress > 0 ? `${Math.round(t.progress * 100)}%` : "puzzle ready" : t.sabotaged ? "ruined" : "needs kit"}
                    </span>
                  )}
                </div>
              ))}
              </div>
            </div>
          )}

          {/* ---- meeting banner ---- */}
          {s.phase === "meeting" && s.meeting && (
            <div className="hc-hud-item hc-hud-fade absolute left-1/2 top-11 w-[min(94vw,540px)] -translate-x-1/2 rounded border border-[#d99a3d]/40 bg-[#1c1210]/90 p-2 text-center backdrop-blur sm:top-16 sm:p-3">
              <div className="hidden font-display text-2xl text-[#d99a3d] sm:block" style={{ animation: "hc-bell-swing 1s ease-in-out infinite", display: undefined }}>🔔</div>
              <div className="font-display text-base leading-tight text-[#e9dfcf] sm:text-xl">🔔 {s.meeting.reason}</div>
              <div className="mt-1 text-sm text-[#9c8b7a]">
                {s.meeting.inArea ? <>Cast your verdict — <span className="tabular-nums text-[#d99a3d]">{secsLeft}s</span></> : <>Walk to the town square {me && me.x < BELL_X ? "→ east" : "← west"} — <span className="tabular-nums text-[#d99a3d]">{secsLeft}s</span></>}
              </div>
            </div>
          )}

          {/* ---- vote panel ---- */}
          {s.phase === "meeting" && s.meeting?.inArea && s.self.alive && (
            <div className="hc-hud-item hc-hud-fade absolute right-2 top-28 max-h-[44dvh] w-44 overflow-y-auto rounded border border-[#3a2733] bg-[#140d18]/90 p-2 backdrop-blur sm:right-3 sm:top-32 sm:w-56 sm:max-h-[55dvh] sm:p-3">
              <div className="mb-2 font-display text-xl text-[#e9dfcf]">The Verdict</div>
              <div className="flex flex-col gap-1.5">
                {voteOptions.map((o) => (
                  <button
                    key={o.key}
                    disabled={!!s.self.myVote}
                    onClick={() => send({ action: "vote", vote: o.key })}
                    className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors ${s.self.myVote === o.key ? "bg-[#8f3b1f] text-[#f3e6d0]" : s.self.myVote ? "bg-[#1d1420] text-[#9a877f]" : "bg-[#1d1420] text-[#d8c9b4] hover:bg-[#2a1a26]"}`}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: o.color }} />
                    {o.label}
                  </button>
                ))}
              </div>
              {s.self.myVote && <p className="mt-2 text-xs text-[#9c8b7a]">Your verdict is cast. Wait for the toll.</p>}
              <p className="mt-2 text-xs text-[#9a877f]">Most votes: caged in the square. Caged folk may still speak — free them by vote or iron key.</p>
            </div>
          )}

          {/* ---- event feed ---- */}
          <div className="hc-hud-item hc-hud-fade hc-event-feed pointer-events-none absolute bottom-24 left-2 w-[min(70vw,360px)] space-y-1 text-xs sm:bottom-32 sm:left-3 sm:text-sm short:hidden">
            {s.feed.slice(-5).map((f, i) => (
              <p key={f.at + "" + i} className={`rounded bg-[#0d0810]/60 px-2 py-0.5 italic text-[#c9b8a4] sm:py-1 ${i < 3 ? "hidden sm:block" : ""}`} style={{ opacity: 0.45 + (i / 5) * 0.55 }}>{f.text}</p>
            ))}
          </div>

          {/* ---- status banners ---- */}
          {!s.self.alive && s.phase !== "ended" && (
            <div className="hc-hud-item hc-hud-fade pointer-events-none absolute left-1/2 top-[7.5rem] sm:top-28 max-w-[92vw] text-center -translate-x-1/2 rounded bg-[#0d0810]/70 px-4 py-1.5 text-sm text-[#9aa]">
              You are dead. Drift as a ghost — only the dead can see and hear you.
            </div>
          )}
          {s.self.caged && s.self.alive && (
            <div className="hc-hud-item hc-hud-fade pointer-events-none absolute left-1/2 top-[7.5rem] sm:top-28 max-w-[92vw] text-center -translate-x-1/2 rounded bg-[#1c1210]/80 px-4 py-1.5 text-sm text-[#d99a3d]">
              The iron is cold. You can still speak and vote — plead for the key.
            </div>
          )}

          {/* ---- Hollow sabotage, separate from kill and blackout ---- */}
          {s.self.role === "hollow" && s.self.alive && s.phase === "playing" && (
            <button onClick={() => void send({ action: "sabotage" })}
              disabled={!s.self.canSabotage}
              className={`absolute bottom-[calc(5.1rem+env(safe-area-inset-bottom))] right-2 z-10 rounded border px-3 py-1.5 text-xs backdrop-blur sm:right-4 ${s.self.canSabotage ? "border-[#d87762] bg-[#391519]/90 text-[#ffd0bf]" : "border-[#3a2733] bg-[#140d18]/80 text-[#9a8a8a]"}`}>
              Ruin · {keyLabel(settings.controls.ruin)}{s.self.sabotageCooldownMs > 0 ? <span className="tabular-nums">{` · ${Math.ceil(s.self.sabotageCooldownMs / 1000)}s`}</span> : ""}
            </button>
          )}

          {/* ---- bottom controls ---- */}
          <div className="hc-hud-item hc-hud-fade hc-touch-controls absolute bottom-0 left-0 right-0 flex items-end justify-between gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-col gap-1.5">
              {s.self.alive && s.phase !== "lobby" && (
                <div className="flex items-center gap-1.5" title="Vigor — work and deeds drain it; stand still to recover. Low vigor slows chores, zero halts them.">
                  <Zap className={`h-3.5 w-3.5 ${s.self.stamina <= 0 ? "text-[#e06a5a]" : s.self.stamina < 0.3 ? "text-[#d99a3d]" : "text-[#a8c98a]"}`} />
                  <div className="h-2 w-24 overflow-hidden rounded-full border border-[#3a2733] bg-[#140d18]/80 sm:w-28">
                    <div
                      className={`h-full transition-[width] duration-300 ${s.self.stamina <= 0 ? "bg-[#e06a5a]" : s.self.stamina < 0.3 ? "bg-[#d99a3d]" : "bg-[#6b8e23]"}`}
                      style={{ width: `${Math.round(s.self.stamina * 100)}%` }}
                    />
                  </div>
                  <span className={`text-[10px] ${s.self.exhausted ? "text-[#e06a5a]" : "text-[#9c8b7a]"}`}>{s.self.exhausted ? "spent — rest!" : "vigor"}</span>
                </div>
              )}
              {s.self.alive && !s.self.caged && s.phase === "playing" && (s.self.hasSupply ? (
                <button onClick={() => void send({ action: "drop_supply" })}
                  className="self-start rounded border border-[#84624c] bg-[#33231f]/90 px-2 py-1 text-[11px] text-[#f2cf91]">
                  Drop kit · {keyLabel(settings.controls.drop)}
                </button>
              ) : (
                <button onPointerDown={(e) => { e.preventDefault(); void send({ cartHeld: true }); }}
                  onPointerUp={() => void send({ cartHeld: false })}
                  onPointerLeave={() => void send({ cartHeld: false })}
                  onPointerCancel={() => void send({ cartHeld: false })}
                  onContextMenu={(e) => e.preventDefault()}
                  className="self-start rounded border border-[#84624c] bg-[#33231f]/90 px-2 py-1 text-[11px] text-[#f2cf91]">
                  Hold Push + ◀▶ {s.cartPushers > 0 ? `· ${s.cartPushers} pushing` : ""}
                </button>
              ))}
              <div className="flex gap-2 sm:gap-3">
              {([["left", "◀"], ["right", "▶"]] as const).map(([d, glyph]) => (
                <button
                  key={d}
                  className="h-[52px] w-[52px] rounded-full border border-[#3a2733] bg-[#140d18]/80 text-xl text-[#d8c9b4] backdrop-blur active:bg-[#3a2733] sm:h-16 sm:w-16 sm:text-2xl short:h-12 short:w-12"
                  onPointerDown={(e) => { e.preventDefault(); holdMove(d, true); }}
                  onPointerUp={() => holdMove(d, false)}
                  onPointerLeave={() => holdMove(d, false)}
                  onPointerCancel={() => holdMove(d, false)}
                  onContextMenu={(e) => e.preventDefault()}
                >{glyph}</button>
              ))}
              </div>
            </div>
            <div className="flex items-end gap-2 sm:gap-3">
              <button
                onClick={openChat}
                className="h-11 rounded-full border border-[#3a2733] bg-[#140d18]/80 px-3 text-sm text-[#d8c9b4] backdrop-blur hover:bg-[#2a1a26] sm:px-4"
              >💬<span className="hidden sm:inline"> Speak</span></button>
              {nearbyKeyedDoor && s.self.alive && !s.self.caged && (
                <button onClick={() => void send({ action: "door_lock" })} className="h-11 rounded-full border border-[#84624c] bg-[#33231f]/90 px-3 text-xs text-[#f2cf91]" title="Lock or unlock with this house key">{nearbyDoorLocked ? "Unlock" : "Lock"} · L</button>
              )}
              <div className="flex flex-col items-center gap-1">
                {s.hint && <span className="hc-interaction-hint max-w-36 rounded bg-[#0d0810]/80 px-2 py-0.5 text-center text-xs text-[#d99a3d] sm:max-w-44">{s.hint}</span>}
                <button
                  onPointerDown={(e) => { e.preventDefault(); interactDown(); }}
                  onPointerUp={interactUp}
                  onPointerLeave={interactUp}
                  onPointerCancel={interactUp}
                  className={`h-[52px] w-[52px] rounded-full border-2 font-display text-sm sm:h-16 sm:w-16 sm:text-base short:h-12 short:w-12 text-lg backdrop-blur ${s.hint ? "border-[#d99a3d] bg-[#3a2410]/90 text-[#ffd98a]" : "border-[#3a2733] bg-[#140d18]/80 text-[#9c8b7a]"}`}
                >{keyLabel(settings.controls.interact)}</button>
              </div>
              {s.self.role === "hollow" && s.self.alive && s.phase === "playing" && (
                <div className="flex flex-col items-center gap-1">
                  {s.self.blackoutCooldownMs > 0 && (
                    <span className="rounded bg-[#0d0810]/80 px-2 py-0.5 text-xs tabular-nums text-[#9aa]">{Math.ceil(s.self.blackoutCooldownMs / 1000)}s</span>
                  )}
                  <button
                    onClick={() => send({ action: "blackout" })}
                    title="Snuff every lantern (F)"
                    className={`h-[52px] w-[52px] rounded-full border-2 font-display text-sm sm:h-16 sm:w-16 sm:text-base short:h-12 short:w-12 text-base leading-tight backdrop-blur ${s.self.canBlackout ? "border-[#7a6ab0] bg-[#1a1430]/90 text-[#b0a0e0] shadow-[0_0_18px_rgba(120,100,200,0.35)]" : "border-[#3a2733] bg-[#140d18]/80 text-[#9a877f]"}`}
                  >Snuff<br /><span className="text-[10px]">{keyLabel(settings.controls.blackout)}</span></button>
                </div>
              )}
              <div className="flex flex-col items-center gap-1">
                {s.self.role === "hollow" && s.self.killCooldownMs > 0 && s.self.alive && (
                  <span className="rounded bg-[#0d0810]/80 px-2 py-0.5 text-xs tabular-nums text-[#ff6a5a]">{Math.ceil(s.self.killCooldownMs / 1000)}s</span>
                )}
                <button
                  onClick={() => send({ action: "ability" })}
                  disabled={!s.self.alive}
                  className={`h-[52px] w-[52px] rounded-full border-2 font-display text-sm sm:h-16 sm:w-16 sm:text-base short:h-12 short:w-12 text-base leading-tight backdrop-blur ${s.abilityReady ? (s.self.role === "hollow" ? "border-[#ff4a3a] bg-[#4a1210]/90 text-[#ff8a7a] shadow-[0_0_20px_rgba(255,60,40,0.4)]" : "border-[#d99a3d] bg-[#3a2410]/90 text-[#ffd98a]") : "border-[#3a2733] bg-[#140d18]/80 text-[#9a877f]"}`}
                >{s.abilityLabel}</button>
              </div>
            </div>
          </div>

          {/* ---- chat ---- */}
          {pinOpen && s.phase === "playing" && (
            <div className="hc-hud-item absolute bottom-20 left-1/2 w-[min(92vw,420px)] -translate-x-1/2 rounded-lg border border-[#6e5638]/60 bg-[#140d18]/95 p-3 sm:bottom-24" data-testid="pin-note-panel">
              <div className="mb-1.5 text-xs uppercase tracking-widest text-[#9c8b7a]">Pin a page to a wall or tree — inside a house it goes on the interior wall</div>
              <textarea
                value={pinText}
                onChange={(e) => setPinText(e.target.value.slice(0, 200))}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void pinNote(); } e.stopPropagation(); }}
                maxLength={200}
                rows={4}
                placeholder="Write your note… (max 200 characters)"
                aria-label="Write the page to pin"
                className="w-full resize-none rounded border border-[#d99a3d]/40 bg-[#1d1420] px-3 py-2 text-sm text-[#e9dfcf] placeholder:text-[#9a877f] focus-visible:outline-2 focus-visible:outline-[#d99a3d]"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-[#9a877f]">{pinText.trim().length}/200</span>
                <div className="flex gap-2">
                  <button onClick={() => { setPinOpen(false); setPinText(""); }} className="rounded border border-[#3a2733] px-3 py-1.5 text-xs text-[#9c8b7a] hover:text-[#e9dfcf]">Cancel</button>
                  <button onClick={() => void pinNote()} disabled={!pinText.trim()} data-testid="pin-note-submit"
                    className="rounded bg-[#8f3b1f] px-3 py-1.5 text-xs text-[#f3e6d0] hover:bg-[#a84a26] disabled:opacity-50">Pin page</button>
                </div>
              </div>
            </div>
          )}

          {noteFocus && <NoteReader note={noteFocus} onClose={() => setNoteFocus(null)} />}

          {chatOpen && (
            <div className="hc-hud-item absolute bottom-20 left-1/2 w-[min(92vw,420px)] sm:bottom-24 -translate-x-1/2">
              <input
                ref={chatInputRef}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitChat(); e.stopPropagation(); }}
                onBlur={submitChat}
                maxLength={120}
                placeholder={s.self.alive ? "Say something… (it appears above your head)" : "Whisper to the dead…"}
                aria-label="Chat message"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-full border border-[#d99a3d]/50 bg-[#140d18]/95 px-5 py-3 text-[#e9dfcf] placeholder:text-[#9a877f] focus-visible:outline-2 focus-visible:outline-[#d99a3d]"
              />
            </div>
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