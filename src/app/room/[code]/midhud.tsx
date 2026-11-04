"use client";

// Presentational HUD overlays for the room screen, split out of GameClient.
// All game logic stays in GameClient — these components only render + call back.

import Link from "next/link";
import type { VoiceCallbacks } from "./overlays";
import { useRouter } from "next/navigation";
import { BookOpen, DoorOpen, Flame, Mic, MicOff, ScrollText, Trophy, Volume2, Zap } from "lucide-react";
import type { Snapshot } from "@/game/types";
import type { VoiceStatus } from "@/game/voice";
import { keyLabel, type GameSettings } from "@/game/settings";
import { BUILDINGS } from "@/game/buildings";
import { BELL_X } from "@/game/types";

export function MidHud(props: {
  s: Snapshot;
  controls: GameSettings["controls"];
  me: Snapshot["players"][number] | undefined;
  secsLeft: number;
  voteOptions: { key: string; label: string; color: string }[];
  tasksOpen: boolean;
  voiceStatus: VoiceStatus;
  onTimepiece: () => void;
  onToggleTasks: () => void;
  onVote: (key: string) => void;
  onSabotage: () => void;
  onResumePlayback: () => void;
}) {
  const { s, controls, me, secsLeft, voteOptions, tasksOpen, voiceStatus, onTimepiece, onToggleTasks, onVote, onSabotage, onResumePlayback } = props;
  return (
    <>
{s.phase !== "lobby" && voiceStatus.error && (
  <p role="alert" className="absolute right-2 top-12 z-20 max-w-[min(70vw,250px)] rounded border border-[#6e3433] bg-[#1c1216]/95 px-3 py-2 text-xs text-[#e29a84]">
    {voiceStatus.error}
    {voiceStatus.error.includes("Enable sound") && <button onClick={onResumePlayback} className="ml-2 underline">Enable sound</button>}
  </p>
)}

{s.time?.mode === "past" && <div data-testid="past-countdown" className="hc-hud-item absolute left-1/2 top-14 z-10 -translate-x-1/2 rounded border border-[#83b9b4]/70 bg-[#172c32]/95 px-4 py-2 text-center text-xs tabular-nums text-[#d2eee5] shadow-lg"><span className="font-semibold uppercase tracking-widest">In the past</span> · {Math.max(0, Math.ceil(((s.time.endsAt ?? s.now) - s.now) / 1000))}s remaining <button onClick={onTimepiece} className="ml-2 underline">Return now</button></div>}

{/* ---- task list ---- */}
{s.phase !== "lobby" && s.self.alive && s.tasks.length > 0 && (
  <div className="hc-hud-item hc-hud-fade hc-task-list absolute left-2 top-12 w-56 max-w-[70vw] rounded border border-[#3a2733]/60 bg-[#140d18]/70 p-2.5 text-xs backdrop-blur sm:left-3 sm:top-20 sm:w-60 sm:p-3">
    <button onClick={onToggleTasks} className="mb-1.5 flex w-full items-center justify-between uppercase tracking-widest text-[#9c8b7a]">
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
          onClick={() => onVote(o.key)}
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
  <button onClick={onSabotage}
    disabled={!s.self.canSabotage}
    className={`absolute bottom-[calc(5.1rem+env(safe-area-inset-bottom))] right-2 z-10 rounded border px-3 py-1.5 text-xs backdrop-blur sm:right-4 ${s.self.canSabotage ? "border-[#d87762] bg-[#391519]/90 text-[#ffd0bf]" : "border-[#3a2733] bg-[#140d18]/80 text-[#9a8a8a]"}`}>
    Ruin · {keyLabel(controls.ruin)}{s.self.sabotageCooldownMs > 0 ? <span className="tabular-nums">{` · ${Math.ceil(s.self.sabotageCooldownMs / 1000)}s`}</span> : ""}
  </button>
)}

    </>
  );
}

