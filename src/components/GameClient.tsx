"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import WorldScene, { type RenderPlayer } from "./WorldScene";
import AudioDirector from "./AudioDirector";
import { BASE_SPEED, WORLD_WIDTH } from "@/lib/world";
import type { Bubble, Snapshot } from "@/lib/game-types";
import { setMuted, sfx, startScore, unlockAudio } from "@/lib/audio";

type Identity = { playerId: string; token: string; name: string };

const LS_NAME = "hollow.name";

export default function GameClient({ code }: { code: string }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [muted, setMutedState] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [vp, setVp] = useState({ w: 1200, h: 700 });

  const dirRef = useRef<0 | 1 | -1>(0);
  const selfXRef = useRef(0);
  const othersRef = useRef<Map<string, number>>(new Map());
  const lastEventRef = useRef(0);
  const snapRef = useRef<Snapshot | null>(null);
  const [, force] = useState(0);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  snapRef.current = snap;

  // -------------------------------------------------- viewport (dvh accurate)
  useEffect(() => {
    const measure = () => {
      const vv = window.visualViewport;
      setVp({
        w: Math.round(vv?.width ?? window.innerWidth),
        h: Math.round(vv?.height ?? window.innerHeight),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  // ------------------------------------------------------------------- join
  useEffect(() => {
    const stored = localStorage.getItem(`hollow.room.${code}`);
    setNameInput(localStorage.getItem(LS_NAME) ?? "");
    if (!stored) return;
    try {
      const id = JSON.parse(stored) as Identity;
      void join(id.name, id.playerId, id.token);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const join = useCallback(
    async (name: string, playerId?: string, token?: string) => {
      setJoining(true);
      setError(null);
      try {
        const res = await fetch(`/api/rooms/${code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, playerId, token }),
        });
        const data = (await res.json()) as Identity & { error?: string };
        if (!res.ok || data.error) {
          setError(data.error ?? "Could not enter the town.");
          localStorage.removeItem(`hollow.room.${code}`);
          return;
        }
        localStorage.setItem(LS_NAME, name);
        localStorage.setItem(
          `hollow.room.${code}`,
          JSON.stringify({ playerId: data.playerId, token: data.token, name: data.name ?? name }),
        );
        setIdentity({ playerId: data.playerId, token: data.token, name: data.name ?? name });
      } catch {
        setError("The fog swallowed the road. Retry.");
      } finally {
        setJoining(false);
      }
    },
    [code],
  );

  // ------------------------------------------------------------------ stream
  useEffect(() => {
    if (!identity) return;
    const es = new EventSource(`/api/stream?code=${code}&playerId=${identity.playerId}`);
    es.onmessage = (ev) => {
      const s = JSON.parse(ev.data) as Snapshot;
      handleEvents(s);
      setSnap(s);
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setTimeout(() => {
          void join(identity.name, identity.playerId, identity.token);
        }, 900);
      }
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, code]);

  const handleEvents = (s: Snapshot) => {
    for (const e of s.events) {
      if (e.id <= lastEventRef.current) continue;
      lastEventRef.current = e.id;
      if (e.type === "bell") {
        sfx.bell();
        setShake(1);
        setFlash("rgba(255,196,80,0.22)");
        setTimeout(() => setFlash(null), 500);
      } else if (e.type === "kill") {
        sfx.kill();
        setShake(1);
        setFlash("rgba(160,20,20,0.4)");
        setTimeout(() => setFlash(null), 420);
      } else if (e.type === "report") sfx.report();
      else if (e.type === "snuff") sfx.snuff();
      else if (e.type === "flare") sfx.flare();
      else if (e.type === "cage") {
        sfx.cage();
        setShake(0.7);
      } else if (e.type === "free") sfx.free();
      else if (e.type === "task") sfx.task();
      else if (e.type === "end") sfx.end(e.winner);
    }
  };

  useEffect(() => {
    if (!shake) return;
    const t = setTimeout(() => setShake(0), 420);
    return () => clearTimeout(t);
  }, [shake]);

  // ------------------------------------------------------------------ input
  const send = useCallback(
    (action: Record<string, unknown>) => {
      if (!identity) return;
      void fetch("/api/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, playerId: identity.playerId, token: identity.token, action }),
      })
        .then((r) => r.json())
        .then((d: { error?: string }) => {
          if (d?.error) {
            setToast(d.error);
            setTimeout(() => setToast(null), 1600);
          }
        })
        .catch(() => undefined);
    },
    [code, identity],
  );

  // the caged cannot walk; ghosts can
  const canControl = !!snap && snap.phase === "playing" && !snap.you.caged;

  const primary = () => {
    if (!snap) return;
    if (snap.you.role === "impostor") send({ type: "kill" });
    else send({ type: "flare" });
  };

  const setDir = useCallback(
    (d: 0 | 1 | -1) => {
      if (dirRef.current === d) return;
      dirRef.current = d;
      send({ type: "move", dir: d });
      if (d !== 0) send({ type: "face", dir: d });
    },
    [send],
  );

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (chatOpen) return;
      const k = e.key.toLowerCase();
      if (["a", "arrowleft"].includes(k)) setDir(-1);
      else if (["d", "arrowright"].includes(k)) setDir(1);
      else if (k === "e") send({ type: "interactStart" });
      else if (k === " ") {
        e.preventDefault();
        primary();
      } else if (k === "r") send({ type: "report" });
      else if (k === "q") send({ type: "hedge", dir: dirRef.current || 1 });
      else if (k === "f") send({ type: "snuff" });
      else if (k === "t" || k === "enter") {
        e.preventDefault();
        setChatOpen(true);
        setTimeout(() => chatInputRef.current?.focus(), 30);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (chatOpen) return;
      const k = e.key.toLowerCase();
      if (["a", "arrowleft"].includes(k) && dirRef.current === -1) setDir(0);
      else if (["d", "arrowright"].includes(k) && dirRef.current === 1) setDir(0);
      else if (k === "e") send({ type: "interactStop" });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen, send, setDir, snap]);

  useEffect(() => {
    const iv = setInterval(() => send({ type: "move", dir: dirRef.current }), 400);
    return () => clearInterval(iv);
  }, [send]);

  // ------------------------------------------------------------------- loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      acc += dt;
      const s = snapRef.current;
      if (s) {
        const target = s.you.x;
        const canMove = s.phase === "playing" && !s.you.caged;
        if (canMove && dirRef.current !== 0) {
          selfXRef.current += dirRef.current * BASE_SPEED * dt;
        } else {
          selfXRef.current += (target - selfXRef.current) * Math.min(1, dt * 9);
        }
        if (Math.abs(selfXRef.current - target) > 260) selfXRef.current = target;
        selfXRef.current = Math.max(40, Math.min(WORLD_WIDTH - 40, selfXRef.current));
        for (const p of s.players) {
          if (p.isYou) continue;
          const cur = othersRef.current.get(p.id) ?? p.x;
          othersRef.current.set(p.id, cur + (p.x - cur) * Math.min(1, dt * 11));
        }
      }
      if (acc > 1 / 32) {
        acc = 0;
        force((n) => n + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const startAudio = () => {
    unlockAudio();
    startScore();
  };

  // ------------------------------------------------------------------ render
  if (!identity) {
    return (
      <main className="fixed inset-0 grid place-items-center overflow-hidden bg-[#05070c] px-5 py-6">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: "url(/images/title.jpg)",
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "saturate(0.7) brightness(0.6)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#05070c] via-[#05070c99] to-transparent" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startAudio();
            void join(nameInput.trim() || "Stranger");
          }}
          className="relative z-10 flex max-h-full w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-[#3a2b1c] bg-[#0b0d13ee] p-6 shadow-2xl backdrop-blur"
        >
          <p className="text-[11px] uppercase tracking-[0.4em] text-[#c98a3c]">Room {code}</p>
          <h1 className="mt-3 text-3xl font-semibold text-[#efe3d0]">Hollow Creek</h1>
          <p className="mt-2 text-sm text-[#9d9285]">
            Something is walking through the leaves. Say your name and step into town.
          </p>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            maxLength={14}
            placeholder="Your name"
            className="mt-5 w-full rounded-lg border border-[#3a2b1c] bg-[#141118] px-4 py-3 text-[#efe3d0] outline-none focus:border-[#c98a3c]"
          />
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={joining}
            className="mt-4 w-full rounded-lg bg-[#8a4a1c] px-4 py-3 font-semibold text-[#fff1dd] transition hover:bg-[#a55a25] disabled:opacity-50"
          >
            {joining ? "Opening the gate…" : "Enter the town"}
          </button>
          <Link
            href="/"
            className="mt-4 block text-center text-xs text-[#7d7468] hover:text-[#c98a3c]"
          >
            ← back to the crossroads
          </Link>
        </form>
      </main>
    );
  }

  if (!snap) {
    return (
      <main className="fixed inset-0 grid place-items-center bg-[#05070c] text-[#9d9285]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full bg-[#c98a3c]/30" />
          <p className="text-xs uppercase tracking-widest">Walking into Hollow Creek…</p>
          {error && <p className="mt-3 text-red-400">{error}</p>}
        </div>
      </main>
    );
  }

  const viewW = vp.w;
  const selfX = selfXRef.current;
  const camX = Math.max(0, Math.min(Math.max(0, WORLD_WIDTH - viewW), selfX - viewW / 2));

  const renderPlayers: RenderPlayer[] = snap.players.map((p) => ({
    ...p,
    rx: p.isYou ? selfX : (othersRef.current.get(p.id) ?? p.x),
    bubbles: snap.bubbles.filter((b: Bubble) => b.playerId === p.id),
  }));

  return (
    <main
      className="fixed inset-0 select-none overflow-hidden bg-black text-[#efe3d0]"
      style={{ height: "100dvh", touchAction: "none" }}
    >
      <WorldScene
        snap={snap}
        selfX={selfX}
        camX={camX}
        viewW={vp.w}
        viewH={vp.h}
        players={renderPlayers}
        dark={snap.you.dark}
      />
      <Leaves />
      <AudioDirector snap={snap} />

      {flash && <div className="pointer-events-none absolute inset-0 z-40" style={{ background: flash }} />}

      <Hud
        snap={snap}
        vp={vp}
        muted={muted}
        onMute={() => {
          const m = !muted;
          setMutedState(m);
          setMuted(m);
        }}
        onInteractDown={() => send({ type: "interactStart" })}
        onInteractUp={() => send({ type: "interactStop" })}
        onReport={() => send({ type: "report" })}
        onPrimary={primary}
        onSnuff={() => send({ type: "snuff" })}
        onHedge={(d) => send({ type: "hedge", dir: d })}
        onSetDir={setDir}
        dir={dirRef.current}
        canControl={canControl}
        chatOpen={chatOpen}
      />

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-50 max-w-[80vw] -translate-x-1/2 rounded-lg border border-[#7a3b2a] bg-[#1a0d0bee] px-4 py-2 text-center text-sm text-[#ffb9a0]">
          {toast}
        </div>
      )}

      {chatOpen ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (chatText.trim()) send({ type: "say", text: chatText.trim() });
            setChatText("");
            setChatOpen(false);
          }}
          className="absolute inset-x-2 z-50 mx-auto flex max-w-md flex-col gap-2 rounded-xl border border-[#3a2b1c] bg-[#0b0d13f2] p-2"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}
        >
          <input
            ref={chatInputRef}
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setChatOpen(false);
                setChatText("");
              }
            }}
            maxLength={120}
            autoFocus
            placeholder={snap.you.alive ? "Speak — they will hear you nearby…" : "Whisper as a ghost…"}
            className="w-full rounded-lg bg-[#141118] px-3 py-2 text-sm outline-none"
          />
          <div className="flex gap-2">
            <button type="submit" className="flex-1 rounded-lg bg-[#8a4a1c] px-3 py-2 text-sm font-semibold">
              Say it
            </button>
            <button
              type="button"
              onClick={() => {
                setChatOpen(false);
                setChatText("");
              }}
              className="rounded-lg border border-[#3a2b1c] px-3 py-2 text-sm text-[#9d9285]"
            >
              Shut up
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => {
            setChatOpen(true);
            setTimeout(() => chatInputRef.current?.focus(), 30);
          }}
          className="absolute left-1/2 z-40 -translate-x-1/2 rounded-full border border-[#3a2b1c] bg-[#0b0d13cc] px-3 py-1 text-[10px] uppercase tracking-widest text-[#9d9285] backdrop-blur hover:text-[#c98a3c]"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}
        >
          speak
        </button>
      )}

      {(snap.phase === "lobby" || snap.phase === "ended") && (
        <LobbyOverlay snap={snap} onStart={() => send({ type: "start" })} />
      )}
      {snap.phase === "meeting" && (
        <MeetingOverlay snap={snap} onVote={(t) => send({ type: "vote", target: t })} />
      )}
    </main>
  );
}

function Leaves() {
  const leaves = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: -(i * 1.37) % 14,
        dur: 9 + ((i * 13) % 9),
        size: 8 + ((i * 7) % 9),
        char: ["🍂", "🍁", "🍂"][i % 3],
        drift: ((i % 5) - 2) * 40,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {leaves.map((l, i) => (
        <span
          key={i}
          className="absolute anim-leaf"
          style={
            {
              left: `${l.left}%`,
              fontSize: l.size,
              animationDelay: `${l.delay}s`,
              animationDuration: `${l.dur}s`,
              "--drift": `${l.drift}px`,
            } as React.CSSProperties
          }
        >
          {l.char}
        </span>
      ))}
    </div>
  );
}

function Hud({
  snap,
  vp,
  muted,
  onMute,
  onInteractDown,
  onInteractUp,
  onReport,
  onPrimary,
  onSnuff,
  onHedge,
  onSetDir,
  dir,
  canControl,
  chatOpen,
}: {
  snap: Snapshot;
  vp: { w: number; h: number };
  muted: boolean;
  onMute: () => void;
  onInteractDown: () => void;
  onInteractUp: () => void;
  onReport: () => void;
  onPrimary: () => void;
  onSnuff: () => void;
  onHedge: (d: 1 | -1) => void;
  onSetDir: (d: 0 | 1 | -1) => void;
  dir: 0 | 1 | -1;
  canControl: boolean;
  chatOpen: boolean;
}) {
  const [sheet, setSheet] = useState<"none" | "tasks" | "log">("none");
  const you = snap.you;
  const isImpostor = you.role === "impostor";
  const bodyNear = snap.bodies.some((b) => Math.abs(b.x - you.x) < 130 && !b.found);
  const secondsLeft = snap.phaseEndsAt
    ? Math.max(0, Math.ceil((snap.phaseEndsAt - snap.now) / 1000))
    : null;
  // compact: phones in portrait, short landscape windows, anything cramped
  const compact = vp.h < 620 || vp.w < 780;
  const tiny = vp.w < 420;
  const safeBottom = "calc(env(safe-area-inset-bottom, 0px) + 8px)";

  return (
    <>
      {/* town chore progress: a hairline that never takes layout space */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-[3px] bg-[#1a1410]">
        <div
          className="h-full bg-gradient-to-r from-[#8a4a1c] to-[#e2a04a] transition-all"
          style={{ width: `${Math.round(snap.taskProgress * 100)}%` }}
        />
      </div>

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-[3px] z-40 flex items-start justify-between gap-2 p-2">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-lg border border-[#3a2b1c] bg-[#0b0d13cc] px-2 py-1.5 backdrop-blur">
          <span className="font-mono text-sm tracking-widest text-[#c98a3c]">{snap.code}</span>
          <span className="hidden text-[10px] uppercase tracking-widest text-[#7d7468] sm:inline">
            · {snap.phase === "meeting" ? snap.meeting?.stage : snap.phase}
          </span>
          {secondsLeft !== null && snap.phase !== "playing" && (
            <span className="rounded bg-[#1c1410] px-1.5 font-mono text-[11px] text-[#ffb9a0]">
              {secondsLeft}s
            </span>
          )}
          <span className="whitespace-nowrap text-[10px] text-[#7d7468]">
            {snap.aliveCrew}🧑·{snap.aliveImpostors}/{snap.totalImpostors}🩸
          </span>
          {!you.connected && (
            <span className="animate-pulse text-[10px] text-[#ffb9a0]">reconnecting…</span>
          )}
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setSheet(sheet === "tasks" ? "none" : "tasks")}
            className="rounded-lg border border-[#3a2b1c] bg-[#0b0d13cc] px-2 py-1.5 text-[11px] text-[#9d9285] backdrop-blur"
            title="your chores"
          >
            {you.tasksDone}/{you.tasksTotal}
          </button>
          {compact && (
            <button
              onClick={() => setSheet(sheet === "log" ? "none" : "log")}
              className="rounded-lg border border-[#3a2b1c] bg-[#0b0d13cc] px-2 py-1.5 text-[11px] text-[#9d9285] backdrop-blur"
              title="town log"
            >
              📜
            </button>
          )}
          <div
            className="rounded-lg border px-2 py-1.5 text-[11px] backdrop-blur"
            style={{
              borderColor: isImpostor ? "#7a1f1f" : "#3a2b1c",
              background: isImpostor ? "#1a0b0bcc" : "#0b0d13cc",
              color: isImpostor ? "#ff9d8a" : "#9d9285",
            }}
          >
            {you.ghost ? "👻" : isImpostor ? "🩸" : "🕯️"}
            {you.caged ? " ⛓️" : ""}
            {you.hasKey ? " 🗝️" : ""}
          </div>
          {!compact && (
            <Link
              href={`/chronicle/${snap.code}`}
              target="_blank"
              className="rounded-lg border border-[#3a2b1c] bg-[#0b0d13cc] px-2 py-1.5 text-[11px] text-[#9d9285] backdrop-blur"
            >
              📖
            </Link>
          )}
          <button
            onClick={onMute}
            className="rounded-lg border border-[#3a2b1c] bg-[#0b0d13cc] px-2 py-1.5 text-[11px] text-[#9d9285] backdrop-blur"
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>

      {/* side panels (wide screens only) */}
      {!compact && (
        <>
          <div className="pointer-events-none absolute left-2 top-14 z-40 w-60 rounded-xl border border-[#3a2b1c] bg-[#0b0d13aa] p-3 backdrop-blur">
            <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-[#c98a3c]">
              {isImpostor ? "your chores (a lie)" : "your chores"}
            </div>
            <ul className="space-y-1.5">
              {you.tasks.length === 0 && <li className="text-xs text-[#7d7468]">Nothing to do.</li>}
              {you.tasks.map((t) => (
                <li key={t.id} className="text-[11px] leading-tight">
                  <div className={t.done ? "text-[#5f7d4a] line-through" : "text-[#d8cdbc]"}>
                    {t.icon} {t.name}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-[#6c6357]">{t.where}</div>
                  {t.active && (
                    <div className="mt-1 h-1 overflow-hidden rounded bg-[#241a14]">
                      <div className="h-full bg-[#e2a04a]" style={{ width: `${Math.round(t.progress * 100)}%` }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="pointer-events-none absolute right-2 top-14 z-40 w-72 rounded-xl border border-[#3a2b1c] bg-[#0b0d13aa] p-3 backdrop-blur">
            <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-[#c98a3c]">
              what the town knows
            </div>
            <ul className="space-y-1">
              {snap.log.slice(-6).map((l) => (
                <li key={l.id} className="text-[11px] leading-snug text-[#a2988a]">
                  {l.text}
                </li>
              ))}
            </ul>
          </div>

          {/* minimap strip */}
          <div className="pointer-events-none absolute left-1/2 z-40 hidden -translate-x-1/2 md:block" style={{ bottom: safeBottom }}>
            <div className="relative h-2 w-[min(520px,60vw)] rounded-full bg-[#1a1410]">
              {snap.players.map((p) => (
                <span
                  key={p.id}
                  className="absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full"
                  style={{
                    left: `${(p.x / WORLD_WIDTH) * 100}%`,
                    background: p.isYou ? "#ffd68a" : p.ghost ? "#4b6b8a" : "#6b5a3e",
                  }}
                />
              ))}
              <span
                className="absolute -top-1 h-4 w-1 rounded bg-[#c98a3c]"
                style={{ left: `${(4300 / WORLD_WIDTH) * 100}%` }}
              />
            </div>
          </div>
        </>
      )}

      {/* compact sheet */}
      {sheet !== "none" && (
        <div
          className="absolute inset-x-2 top-12 z-50 max-h-[60dvh] overflow-y-auto rounded-xl border border-[#3a2b1c] bg-[#0b0d13f5] p-3 backdrop-blur"
          onClick={() => setSheet("none")}
        >
          {sheet === "tasks" ? (
            <>
              <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-[#c98a3c]">
                {isImpostor ? "your chores (a lie)" : "your chores"}
              </div>
              <ul className="space-y-2">
                {you.tasks.map((t) => (
                  <li key={t.id} className="text-xs">
                    <div className={t.done ? "text-[#5f7d4a] line-through" : "text-[#d8cdbc]"}>
                      {t.icon} {t.name}
                    </div>
                    <div className="text-[9px] uppercase tracking-widest text-[#6c6357]">
                      {t.where}
                      {t.active ? ` · ${Math.round(t.progress * 100)}%` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-[#c98a3c]">
                what the town knows
              </div>
              <ul className="space-y-1">
                {snap.log.slice(-10).map((l) => (
                  <li key={l.id} className="text-[11px] leading-snug text-[#a2988a]">
                    {l.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-3 text-center text-[10px] uppercase tracking-widest text-[#6c6357]">
            tap to close
          </div>
        </div>
      )}

      {/* prompt */}
      {you.prompt && !chatOpen && (
        <div
          className="pointer-events-none absolute left-1/2 z-40 w-[min(320px,86vw)] -translate-x-1/2 rounded-xl border border-[#c98a3c] bg-[#0b0d13dd] px-4 py-2 text-center backdrop-blur"
          style={{ bottom: `calc(${safeBottom} + ${compact ? 96 : 116}px)` }}
        >
          <div className="text-xs text-[#efe3d0]">{you.prompt.label}</div>
          {you.prompt.progress > 0 && (
            <div className="mx-auto mt-1.5 h-1 w-full overflow-hidden rounded bg-[#241a14]">
              <div className="h-full bg-[#e2a04a]" style={{ width: `${Math.round(you.prompt.progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* controls */}
      <div
        className="absolute inset-x-0 z-40 flex items-end justify-between gap-2 px-2"
        style={{ bottom: safeBottom }}
      >
        <div className="flex shrink-0 gap-1.5">
          <MoveBtn
            label="◀"
            active={dir === -1}
            size={compact ? 56 : 64}
            onPress={() => onSetDir(-1)}
            onRelease={() => onSetDir(0)}
            disabled={!canControl}
          />
          <MoveBtn
            label="▶"
            active={dir === 1}
            size={compact ? 56 : 64}
            onPress={() => onSetDir(1)}
            onRelease={() => onSetDir(0)}
            disabled={!canControl}
          />
        </div>
        <div className="flex max-w-[70vw] flex-wrap items-end justify-end gap-1.5">
          {bodyNear && you.alive && (
            <ActionBtn label="Report" hint="R" tone="danger" onClick={onReport} compact={compact} />
          )}
          {you.prompt && you.alive && !you.caged && (
            <ActionBtn
              label={you.prompt.kind === "task" ? "Do it" : "Use key"}
              hint="E"
              tone="gold"
              onClick={onInteractDown}
              onRelease={onInteractUp}
              compact={compact}
            />
          )}
          {isImpostor && you.alive && !you.caged && (
            <>
              <ActionBtn
                label="Kill"
                hint="␣"
                tone="danger"
                cooldown={you.cooldowns.kill}
                onClick={onPrimary}
                compact={compact}
              />
              <ActionBtn
                label="Snuff"
                hint="F"
                tone="dark"
                cooldown={you.cooldowns.snuff}
                onClick={onSnuff}
                compact={compact}
              />
              <ActionBtn
                label="Hedge"
                hint="Q"
                tone="dark"
                cooldown={you.cooldowns.hedge}
                onClick={() => onHedge(dir || 1)}
                compact={compact}
              />
            </>
          )}
          {!isImpostor && you.alive && !you.caged && (
            <ActionBtn
              label="Flare"
              hint="␣"
              tone="gold"
              cooldown={you.cooldowns.flare}
              onClick={onPrimary}
              compact={compact}
            />
          )}
          {tiny && (
            <span className="w-0" aria-hidden />
          )}
        </div>
      </div>
    </>
  );
}

function MoveBtn({
  label,
  active,
  onPress,
  onRelease,
  disabled,
  size,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onRelease: () => void;
  disabled?: boolean;
  size: number;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        if (!disabled) onPress();
      }}
      onPointerUp={onRelease}
      onPointerLeave={onRelease}
      onPointerCancel={onRelease}
      onContextMenu={(e) => e.preventDefault()}
      className={`shrink-0 touch-none rounded-2xl border text-xl backdrop-blur transition ${
        active ? "border-[#c98a3c] bg-[#8a4a1c]" : "border-[#3a2b1c] bg-[#0b0d13cc]"
      } ${disabled ? "opacity-30" : ""}`}
      style={{ width: size, height: size }}
    >
      {label}
    </button>
  );
}

function ActionBtn({
  label,
  hint,
  tone,
  onClick,
  onRelease,
  cooldown = 0,
  compact,
}: {
  label: string;
  hint: string;
  tone: "danger" | "gold" | "dark";
  onClick: () => void;
  onRelease?: () => void;
  cooldown?: number;
  compact: boolean;
}) {
  const ready = cooldown <= 0;
  const tones = {
    danger: "border-[#7a1f1f] bg-[#230c0c] text-[#ff9d8a]",
    gold: "border-[#8a4a1c] bg-[#241609] text-[#ffd68a]",
    dark: "border-[#2b3038] bg-[#101318] text-[#9fb0c4]",
  };
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      onPointerUp={onRelease}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative shrink-0 touch-none overflow-hidden rounded-2xl border font-semibold uppercase backdrop-blur transition active:scale-95 ${tones[tone]} ${
        ready ? "" : "opacity-60"
      } ${compact ? "px-2.5 py-2 text-[10px]" : "px-3 py-3 text-xs"}`}
      style={{ minWidth: compact ? 58 : 86 }}
    >
      <span className="relative z-10">{label}</span>
      {!compact && <span className="relative z-10 ml-1 opacity-60">[{hint}]</span>}
      {!ready && (
        <span className="absolute inset-0 z-0 flex items-center justify-center bg-black/60 font-mono text-sm">
          {Math.ceil(cooldown / 1000)}s
        </span>
      )}
    </button>
  );
}

function LobbyOverlay({ snap, onStart }: { snap: Snapshot; onStart: () => void }) {
  const ended = snap.phase === "ended";
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm">
      <div className="my-auto max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-[#3a2b1c] bg-[#0b0d13f2] p-5">
        {ended ? (
          <>
            <p className="text-[11px] uppercase tracking-[0.4em] text-[#c98a3c]">dawn</p>
            <h2 className="mt-2 text-2xl font-semibold">
              {snap.winner === "crew" ? "The town survived." : "They were among us."}
            </h2>
            <p className="mt-2 text-sm text-[#9d9285]">{snap.endText}</p>
            <ul className="mt-4 space-y-1">
              {snap.players.map((p) => (
                <li key={p.id} className="flex justify-between text-sm">
                  <span style={{ color: p.color }}>
                    {p.name}
                    {!p.connected ? " (lost)" : ""}
                  </span>
                  <span className="text-[#9d9285]">
                    {p.role === "impostor" ? "🩸 one of them" : "🕯️ townsperson"}
                    {p.alive ? "" : " · dead"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="text-[11px] uppercase tracking-[0.4em] text-[#c98a3c]">the crossroads</p>
            <h2 className="mt-2 text-2xl font-semibold">Hollow Creek, late October</h2>
            <p className="mt-2 text-sm text-[#9d9285]">
              {snap.players.length} in town. Share the code{" "}
              <span className="font-mono text-[#c98a3c]">{snap.code}</span> with everyone in the room.
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-1">
              {snap.players.map((p) => (
                <li key={p.id} className="text-sm" style={{ color: p.color }}>
                  {p.name}
                  {p.isYou ? " (you)" : ""}
                  {p.isHost ? " 🕯️" : ""}
                  {!p.connected ? " …" : ""}
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-xl border border-[#2a2119] bg-[#0e1016] p-3 text-xs leading-relaxed text-[#8b7f6d]">
              <b className="text-[#c98a3c]">How the night works.</b> Walk with <b>A/D</b> or the arrows.
              Hold <b>E</b> to do a chore. Press <b>T</b> to speak — words float out of your head and
              only those nearby hear you. Find a body? Press <b>R</b>: the bell rings and everyone
              walks themselves to the cages in Harvest Square. Whoever the town votes for is locked in
              a cage — caged folk can still talk, and can be freed by a later vote or by the iron key
              hidden somewhere in town. One of you is not human.
            </div>
          </>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {snap.you.isHost ? (
            <button
              onClick={onStart}
              className="flex-1 rounded-lg bg-[#8a4a1c] px-4 py-3 font-semibold text-[#fff1dd] hover:bg-[#a55a25]"
            >
              {ended ? "Return to the square" : "Begin the night"}
            </button>
          ) : (
            <div className="flex-1 rounded-lg border border-[#2a2119] px-4 py-3 text-center text-sm text-[#7d7468]">
              waiting for the host…
            </div>
          )}
          <a
            href={`/chronicle/${snap.code}`}
            target="_blank"
            className="rounded-lg border border-[#3a2b1c] px-4 py-3 text-sm text-[#9d9285] hover:text-[#c98a3c]"
          >
            chronicle
          </a>
        </div>
      </div>
    </div>
  );
}

function MeetingOverlay({ snap, onVote }: { snap: Snapshot; onVote: (t: string) => void }) {
  const m = snap.meeting;
  if (!m) return null;
  const seconds = Math.max(0, Math.ceil((m.endsAt - snap.now) / 1000));
  const votesFor = (id: string) => Object.values(m.votes).filter((v) => v === id).length;
  const voted = new Set(Object.keys(m.votes));

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center p-2">
      <div className="pointer-events-auto max-h-[68dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#8a4a1c] bg-[#0b0d13f5] p-4 shadow-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.35em] text-[#c98a3c]">
              {m.stage === "travel"
                ? "the bell tolls — walk to the cages"
                : m.stage === "discuss"
                  ? "the square falls silent"
                  : m.stage === "vote"
                    ? "point your finger"
                    : "the cage door"}
            </p>
            <h2 className="mt-1 truncate text-base font-semibold text-[#efe3d0]">{m.reason}</h2>
          </div>
          <div className="shrink-0 font-mono text-xl text-[#ffb9a0]">{seconds}s</div>
        </div>

        {m.outcome && (
          <div className="mt-3 rounded-xl border border-[#8a4a1c] bg-[#241609] p-3 text-center text-sm text-[#ffd68a]">
            {m.outcome}
          </div>
        )}

        {m.stage !== "reveal" && !m.outcome && (
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {m.options.map((o) => {
              const n = votesFor(o.id);
              const isMe = o.id === snap.you.id;
              const myVote = m.myVote === o.id;
              return (
                <button
                  key={o.id}
                  disabled={m.stage !== "vote" || !snap.you.alive || !!m.myVote}
                  onClick={() => onVote(o.id)}
                  className={`rounded-xl border px-2.5 py-2 text-left text-xs transition disabled:cursor-not-allowed ${
                    myVote
                      ? "border-[#c98a3c] bg-[#241609]"
                      : "border-[#2a2119] bg-[#0e1016] hover:border-[#8a4a1c]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate" style={{ color: o.color }}>
                      {o.name}
                      {o.caged ? " ⛓️" : ""}
                      {isMe ? " (you)" : ""}
                    </span>
                    {n > 0 && <span className="font-mono text-[11px] text-[#ffb9a0]">{n}</span>}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-[#6c6357]">
                    {voted.has(o.id) ? "voted" : "…"}
                  </div>
                </button>
              );
            })}
            <button
              disabled={m.stage !== "vote" || !snap.you.alive || !!m.myVote}
              onClick={() => onVote("skip")}
              className={`rounded-xl border px-2.5 py-2 text-xs transition disabled:cursor-not-allowed ${
                m.myVote === "skip"
                  ? "border-[#c98a3c] bg-[#241609]"
                  : "border-[#2a2119] bg-[#0e1016] hover:border-[#8a4a1c]"
              }`}
            >
              Abstain
              <div className="text-[9px] uppercase tracking-widest text-[#6c6357]">
                {votesFor("skip")} votes
              </div>
            </button>
          </div>
        )}

        {m.stage === "vote" && !snap.you.alive && (
          <p className="mt-2 text-xs text-[#7d7468]">The dead watch, and cannot point.</p>
        )}
        {m.stage === "travel" && (
          <p className="mt-2 text-xs text-[#9d9285]">
            You are walking to Harvest Square on your own two feet. Nobody can run from this.
          </p>
        )}
      </div>
    </div>
  );
}
