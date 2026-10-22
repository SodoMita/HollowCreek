"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Renderer } from "@/game/render";
import { BELL_X } from "@/game/types";
import type { Snapshot } from "@/game/types";

function getPid(): string {
  let pid = localStorage.getItem("hc_pid");
  if (!pid) { pid = crypto.randomUUID(); localStorage.setItem("hc_pid", pid); }
  return pid;
}

export default function GameClient({ code }: { code: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [roleBanner, setRoleBanner] = useState<string | null>(null);

  const snapRef = useRef<Snapshot | null>(null);
  const chatOpenRef = useRef(false);
  const displayX = useRef(new Map<string, number>());
  const keys = useRef(new Set<string>());
  const lastDir = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const lastBell = useRef(0);
  const lastPhase = useRef<string>("lobby");
  const chatInputRef = useRef<HTMLInputElement>(null);
  chatOpenRef.current = chatOpen;

  const send = useCallback(async (payload: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/game/input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, playerId: getPid(), ...payload }),
      });
      const data = await res.json();
      if (!data.ok && data.error) {
        setToast(data.error);
        setTimeout(() => setToast(null), 2200);
      }
    } catch { /* network hiccup — next poll resyncs */ }
  }, [code]);

  const ringBell = useCallback(() => {
    try {
      if (!audioRef.current) audioRef.current = new AudioContext();
      const ctx = audioRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      for (let i = 0; i < 3; i++) {
        const t0 = ctx.currentTime + i * 0.9;
        for (const [f, g] of [[392, 0.22], [587, 0.1], [784, 0.05]] as const) {
          const o = ctx.createOscillator();
          const gain = ctx.createGain();
          o.type = "sine"; o.frequency.value = f;
          gain.gain.setValueAtTime(g, t0);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
          o.connect(gain).connect(ctx.destination);
          o.start(t0); o.stop(t0 + 1.7);
        }
      }
    } catch { /* audio unavailable */ }
  }, []);

  // ---- join + poll ----
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const name = localStorage.getItem("hc_name") || "Stranger";
      const res = await fetch("/api/game/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, playerId: getPid(), name }),
      });
      const data = await res.json();
      if (!alive) return;
      if (!res.ok || !data.ok) { setJoinError(data.error ?? "Could not enter the town."); return; }
      timer = setInterval(async () => {
        try {
          const r = await fetch(`/api/game/state?code=${code}&playerId=${getPid()}`);
          if (!r.ok) return;
          const s: Snapshot = await r.json();
          if (!alive) return;
          snapRef.current = s;
          setSnap(s);
          if (s.bellAt > lastBell.current) {
            if (lastBell.current !== 0 || Date.now() - s.bellAt < 4000) ringBell();
            lastBell.current = s.bellAt;
          }
          if (lastPhase.current === "lobby" && s.phase === "playing") {
            setRoleBanner(s.self.role === "hollow" ? "hollow" : "crew");
            setTimeout(() => setRoleBanner(null), 4500);
          }
          lastPhase.current = s.phase;
        } catch { /* retry next tick */ }
      }, 100);
    })();
    return () => { alive = false; if (timer) clearInterval(timer); void send({ dir: 0, interactHeld: false }); };
  }, [code, ringBell, send]);

  // ---- input: clients only ever send intent ----
  const computeDir = useCallback(() => {
    const k = keys.current;
    const d = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
    if (d !== lastDir.current) { lastDir.current = d; void send({ dir: d }); }
  }, [send]);

  useEffect(() => {
    const unlockAudio = () => {
      if (!audioRef.current) { try { audioRef.current = new AudioContext(); } catch { /* noop */ } }
    };
    const down = (e: KeyboardEvent) => {
      unlockAudio();
      if (chatOpenRef.current) {
        if (e.key === "Escape") { setChatOpen(false); }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") { keys.current.add("left"); computeDir(); e.preventDefault(); }
      else if (k === "arrowright" || k === "d") { keys.current.add("right"); computeDir(); e.preventDefault(); }
      else if (k === "e" && !e.repeat) { void send({ action: "interact", interactHeld: true }); }
      else if ((k === "q" || k === " ") && !e.repeat) { void send({ action: "ability" }); e.preventDefault(); }
      else if (k === "enter") { setChatOpen(true); setTimeout(() => chatInputRef.current?.focus(), 30); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") { keys.current.delete("left"); computeDir(); }
      else if (k === "arrowright" || k === "d") { keys.current.delete("right"); computeDir(); }
      else if (k === "e") { void send({ interactHeld: false }); }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", unlockAudio);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("pointerdown", unlockAudio); };
  }, [computeDir, send]);

  // ---- render loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const renderer = new Renderer();
    let raf = 0;
    let last = performance.now();
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const s = snapRef.current;
      if (!s) return;
      for (const p of s.players) {
        const cur = displayX.current.get(p.id);
        if (cur === undefined || Math.abs(cur - p.x) > 300) displayX.current.set(p.id, p.x);
        else displayX.current.set(p.id, cur + (p.x - cur) * Math.min(1, dt * 10));
      }
      renderer.render(ctx, window.innerWidth, window.innerHeight, s, displayX.current, nowMs / 1000, dt);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const holdMove = (dir: "left" | "right", on: boolean) => {
    if (on) keys.current.add(dir); else keys.current.delete(dir);
    computeDir();
  };

  const submitChat = () => {
    if (chatText.trim()) void send({ chat: chatText.trim() });
    setChatText("");
    setChatOpen(false);
  };

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
  const s = snap;
  const secsLeft = s?.meeting ? Math.max(0, Math.ceil((s.meeting.endsAt - s.now) / 1000)) : 0;
  const voteOptions = s ? [
    ...s.players.filter((p) => p.alive && !p.caged && p.id !== s.self.id).map((p) => ({ key: p.id, label: `Cage ${p.name}`, color: p.color })),
    ...s.players.filter((p) => p.caged).map((p) => ({ key: `free:${p.id}`, label: `Free ${p.name}`, color: "#7fb069" })),
    { key: "skip", label: "Abstain", color: "#7f8c8d" },
  ] : [];

  return (
    <main className="relative h-screen w-screen select-none overflow-hidden bg-[#0b0710]">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {!s && !joinError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="hc-title-flicker font-display text-3xl text-[#c9b8a4]">Walking the old road into town…</p>
        </div>
      )}

      {s && (
        <>
          {/* ---- top bar ---- */}
          <div className="absolute left-0 right-0 top-0 flex items-start justify-between gap-3 p-3 text-sm">
            <div className="rounded border border-[#3a2733]/70 bg-[#140d18]/80 px-3 py-2 backdrop-blur">
              <span className="font-display text-lg text-[#d99a3d]">Hollow Creek</span>
              <button
                onClick={() => { void navigator.clipboard?.writeText(s.code); setToast("Town code copied"); setTimeout(() => setToast(null), 1500); }}
                className="ml-3 rounded bg-[#2a1a26] px-2 py-0.5 font-mono tracking-[0.3em] text-[#e9dfcf] hover:bg-[#3a2733]"
                title="Copy town code"
              >{s.code}</button>
              <span className="ml-2 text-[#9c8b7a]">{s.playerCount} souls</span>
            </div>
            {s.phase !== "lobby" && (
              <div className="mt-1 hidden w-72 sm:block">
                <div className="mb-1 text-center text-xs uppercase tracking-widest text-[#9c8b7a]">Town wards restored</div>
                <div className="h-3 overflow-hidden rounded-full border border-[#3a2733] bg-[#140d18]/80">
                  <div className="h-full bg-gradient-to-r from-[#8f3b1f] to-[#d99a3d] transition-all duration-500" style={{ width: `${s.taskBar.total ? (100 * s.taskBar.done) / s.taskBar.total : 0}%` }} />
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className={`rounded px-3 py-1.5 font-display text-lg ${!s.self.alive ? "bg-[#2a2a3a]/80 text-[#9aa]" : s.self.role === "hollow" ? "bg-[#4a1210]/90 text-[#ff6a5a]" : "bg-[#1d2a1a]/80 text-[#a8c98a]"}`}>
                {!s.self.alive ? "Ghost" : s.self.role === "hollow" ? "The Hollow" : "Townfolk"}
                {s.self.caged && s.self.alive ? " · Caged" : ""}
              </span>
              <a href={`/chronicle/${s.code}`} target="_blank" className="rounded border border-[#3a2733] bg-[#140d18]/80 px-3 py-1.5 text-[#9c8b7a] hover:text-[#d99a3d]">Chronicle</a>
              <button onClick={() => router.push("/")} className="rounded border border-[#3a2733] bg-[#140d18]/80 px-3 py-1.5 text-[#9c8b7a] hover:text-[#e06a5a]">Leave</button>
            </div>
          </div>

          {/* ---- task list ---- */}
          {s.phase !== "lobby" && s.self.alive && s.tasks.length > 0 && (
            <div className="absolute left-3 top-20 w-60 rounded border border-[#3a2733]/60 bg-[#140d18]/70 p-3 text-xs backdrop-blur">
              <div className="mb-1.5 uppercase tracking-widest text-[#9c8b7a]">{s.self.role === "hollow" ? "Blend in (fake chores)" : "Your chores"}</div>
              {s.tasks.map((t) => (
                <div key={t.id} className={`flex items-center gap-2 py-0.5 ${t.done ? "text-[#6b8e5a] line-through" : "text-[#d8c9b4]"}`}>
                  <span>{t.done ? "✓" : "•"}</span><span>{t.name}</span>
                  {!t.done && t.progress > 0 && <span className="ml-auto text-[#d99a3d]">{Math.round(t.progress * 100)}%</span>}
                </div>
              ))}
            </div>
          )}

          {/* ---- meeting banner ---- */}
          {s.phase === "meeting" && s.meeting && (
            <div className="absolute left-1/2 top-16 w-[min(92vw,540px)] -translate-x-1/2 rounded border border-[#d99a3d]/40 bg-[#1c1210]/90 p-3 text-center backdrop-blur">
              <div className="font-display text-2xl text-[#d99a3d]" style={{ animation: "hc-bell-swing 1s ease-in-out infinite", display: "inline-block" }}>🔔</div>
              <div className="font-display text-xl text-[#e9dfcf]">{s.meeting.reason}</div>
              <div className="mt-1 text-sm text-[#9c8b7a]">
                {s.meeting.inArea ? <>Cast your verdict — <span className="text-[#d99a3d]">{secsLeft}s</span></> : <>Walk to the town square {me && me.x < BELL_X ? "→ east" : "← west"} — <span className="text-[#d99a3d]">{secsLeft}s</span></>}
              </div>
            </div>
          )}

          {/* ---- vote panel ---- */}
          {s.phase === "meeting" && s.meeting?.inArea && s.self.alive && (
            <div className="absolute right-3 top-32 max-h-[55vh] w-56 overflow-y-auto rounded border border-[#3a2733] bg-[#140d18]/90 p-3 backdrop-blur">
              <div className="mb-2 font-display text-xl text-[#e9dfcf]">The Verdict</div>
              <div className="flex flex-col gap-1.5">
                {voteOptions.map((o) => (
                  <button
                    key={o.key}
                    disabled={!!s.self.myVote}
                    onClick={() => send({ action: "vote", vote: o.key })}
                    className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition ${s.self.myVote === o.key ? "bg-[#8f3b1f] text-[#f3e6d0]" : s.self.myVote ? "bg-[#1d1420] text-[#6b5a55]" : "bg-[#1d1420] text-[#d8c9b4] hover:bg-[#2a1a26]"}`}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: o.color }} />
                    {o.label}
                  </button>
                ))}
              </div>
              {s.self.myVote && <p className="mt-2 text-xs text-[#9c8b7a]">Your verdict is cast. Wait for the toll.</p>}
              <p className="mt-2 text-xs text-[#6b5a55]">Most votes: caged in the square. Caged folk may still speak — free them by vote or iron key.</p>
            </div>
          )}

          {/* ---- event feed ---- */}
          <div className="pointer-events-none absolute bottom-32 left-3 w-[min(88vw,360px)] space-y-1 text-sm">
            {s.feed.slice(-5).map((f, i) => (
              <p key={f.at + "" + i} className="rounded bg-[#0d0810]/60 px-2 py-1 italic text-[#c9b8a4]" style={{ opacity: 0.45 + (i / 5) * 0.55 }}>{f.text}</p>
            ))}
          </div>

          {/* ---- status banners ---- */}
          {!s.self.alive && s.phase !== "ended" && (
            <div className="pointer-events-none absolute left-1/2 top-28 -translate-x-1/2 rounded bg-[#0d0810]/70 px-4 py-1.5 text-sm text-[#9aa]">
              You are dead. Drift as a ghost — only the dead can see and hear you.
            </div>
          )}
          {s.self.caged && s.self.alive && (
            <div className="pointer-events-none absolute left-1/2 top-28 -translate-x-1/2 rounded bg-[#1c1210]/80 px-4 py-1.5 text-sm text-[#d99a3d]">
              The iron is cold. You can still speak and vote — plead for the key.
            </div>
          )}

          {/* ---- bottom controls ---- */}
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between p-4">
            <div className="flex gap-3">
              {([["left", "◀"], ["right", "▶"]] as const).map(([d, glyph]) => (
                <button
                  key={d}
                  className="h-16 w-16 rounded-full border border-[#3a2733] bg-[#140d18]/80 text-2xl text-[#d8c9b4] backdrop-blur active:bg-[#3a2733]"
                  onPointerDown={(e) => { e.preventDefault(); holdMove(d, true); }}
                  onPointerUp={() => holdMove(d, false)}
                  onPointerLeave={() => holdMove(d, false)}
                  onContextMenu={(e) => e.preventDefault()}
                >{glyph}</button>
              ))}
            </div>
            <div className="flex items-end gap-3">
              <button
                onClick={() => { setChatOpen(true); setTimeout(() => chatInputRef.current?.focus(), 30); }}
                className="h-12 rounded-full border border-[#3a2733] bg-[#140d18]/80 px-4 text-sm text-[#d8c9b4] backdrop-blur hover:bg-[#2a1a26]"
              >💬 Speak</button>
              <div className="flex flex-col items-center gap-1">
                {s.hint && <span className="max-w-44 rounded bg-[#0d0810]/80 px-2 py-0.5 text-center text-xs text-[#d99a3d]">{s.hint}</span>}
                <button
                  onPointerDown={() => send({ action: "interact", interactHeld: true })}
                  onPointerUp={() => send({ interactHeld: false })}
                  onPointerLeave={() => send({ interactHeld: false })}
                  className={`h-16 w-16 rounded-full border-2 font-display text-lg backdrop-blur ${s.hint ? "border-[#d99a3d] bg-[#3a2410]/90 text-[#ffd98a]" : "border-[#3a2733] bg-[#140d18]/80 text-[#9c8b7a]"}`}
                >E</button>
              </div>
              <div className="flex flex-col items-center gap-1">
                {s.self.role === "hollow" && s.self.killCooldownMs > 0 && s.self.alive && (
                  <span className="rounded bg-[#0d0810]/80 px-2 py-0.5 text-xs text-[#ff6a5a]">{Math.ceil(s.self.killCooldownMs / 1000)}s</span>
                )}
                <button
                  onClick={() => send({ action: "ability" })}
                  disabled={!s.self.alive}
                  className={`h-16 w-16 rounded-full border-2 font-display text-base leading-tight backdrop-blur ${s.abilityReady ? (s.self.role === "hollow" ? "border-[#ff4a3a] bg-[#4a1210]/90 text-[#ff8a7a] shadow-[0_0_20px_rgba(255,60,40,0.4)]" : "border-[#d99a3d] bg-[#3a2410]/90 text-[#ffd98a]") : "border-[#3a2733] bg-[#140d18]/80 text-[#6b5a55]"}`}
                >{s.abilityLabel}</button>
              </div>
            </div>
          </div>

          {/* ---- chat ---- */}
          {chatOpen && (
            <div className="absolute bottom-24 left-1/2 w-[min(92vw,420px)] -translate-x-1/2">
              <input
                ref={chatInputRef}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitChat(); e.stopPropagation(); }}
                onBlur={submitChat}
                maxLength={120}
                placeholder={s.self.alive ? "Say something… (it appears above your head)" : "Whisper to the dead…"}
                className="w-full rounded-full border border-[#d99a3d]/50 bg-[#140d18]/95 px-5 py-3 text-[#e9dfcf] outline-none placeholder:text-[#6b5a55]"
              />
            </div>
          )}

          {/* ---- lobby overlay ---- */}
          {s.phase === "lobby" && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0b0710]/70 backdrop-blur-sm">
              <div className="hc-rise w-[min(92vw,440px)] rounded-lg border border-[#3a2733] bg-[#140d18]/95 p-6 text-center">
                <h2 className="font-display text-4xl text-[#e9dfcf]">Gathering at dusk</h2>
                <p className="mt-1 text-sm text-[#9c8b7a]">Share the town code with your fellow townsfolk</p>
                <div className="mt-3 font-mono text-5xl tracking-[0.4em] text-[#d99a3d]">{s.code}</div>
                <div className="mt-5 grid grid-cols-2 gap-2 text-left text-sm">
                  {s.players.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded bg-[#1d1420] px-3 py-2">
                      <span className="h-3.5 w-3.5 rounded-full" style={{ background: p.color }} />
                      <span className="truncate text-[#d8c9b4]">{p.name}</span>
                      {p.isHost && <span className="ml-auto text-xs text-[#d99a3d]">host</span>}
                    </div>
                  ))}
                </div>
                {s.self.id === s.hostId ? (
                  <button
                    onClick={() => send({ action: "start" })}
                    disabled={s.playerCount < 4}
                    className="mt-6 w-full rounded bg-[#8f3b1f] py-3 font-display text-2xl text-[#f3e6d0] hover:bg-[#a84a26] disabled:opacity-40"
                  >
                    {s.playerCount < 4 ? "Waiting for more souls… (min 4)" : "Let night fall"}
                  </button>
                ) : (
                  <p className="mt-6 text-[#9c8b7a]">Waiting for the host to let night fall…</p>
                )}
                <p className="mt-3 text-xs text-[#6b5a55]">4–10 players · 1–2 of you will be Hollow</p>
              </div>
            </div>
          )}

          {/* ---- role reveal ---- */}
          {roleBanner && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60">
              <div className="text-center">
                {roleBanner === "hollow" ? (
                  <>
                    <p className="font-display text-7xl text-[#ff4a3a] drop-shadow-[0_0_30px_rgba(255,60,40,0.6)]">You are Hollow</p>
                    <p className="mt-3 text-lg text-[#c9a0a0]">Wear their faces. Kill when none watch. Q to strike.</p>
                  </>
                ) : (
                  <>
                    <p className="font-display text-7xl text-[#a8c98a]">Townfolk</p>
                    <p className="mt-3 text-lg text-[#b8c9a4]">Finish your chores. Find the key. Trust no one.</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ---- end overlay ---- */}
          {s.phase === "ended" && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0b0710]/80 backdrop-blur-sm">
              <div className="hc-rise w-[min(92vw,480px)] rounded-lg border border-[#3a2733] bg-[#140d18]/95 p-8 text-center">
                <p className={`font-display text-6xl ${s.winner === "hollow" ? "text-[#ff4a3a]" : "text-[#a8c98a]"}`}>
                  {s.winner === "hollow" ? "The Hollow wins" : "The town survives"}
                </p>
                <p className="mt-4 text-lg italic text-[#c9b8a4]">{s.winReason}</p>
                <div className="mt-6 flex justify-center gap-3">
                  <button onClick={() => router.push("/")} className="rounded bg-[#8f3b1f] px-6 py-2.5 font-display text-xl text-[#f3e6d0] hover:bg-[#a84a26]">New town</button>
                  <a href={`/chronicle/${s.code}`} target="_blank" className="rounded border border-[#3a2733] px-6 py-2.5 font-display text-xl text-[#d99a3d] hover:bg-[#2a1a26]">Read the chronicle</a>
                </div>
              </div>
            </div>
          )}

          {toast && (
            <div className="absolute bottom-44 left-1/2 -translate-x-1/2 rounded bg-[#1c1210]/95 px-4 py-2 text-sm text-[#d99a3d]">{toast}</div>
          )}
        </>
      )}
    </main>
  );
}