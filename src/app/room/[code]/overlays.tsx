"use client";

// Presentational HUD overlays for the room screen, split out of GameClient.
// All game logic stays in GameClient — these components only render + call back.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, DoorOpen, Flame, Mic, MicOff, ScrollText, Trophy, Volume2, Zap } from "lucide-react";
import type { Snapshot } from "@/game/types";
import type { VoiceStatus } from "@/game/voice";
import { keyLabel, type GameSettings } from "@/game/settings";
import { BUILDINGS } from "@/game/buildings";
import { BELL_X } from "@/game/types";

export type VoiceCallbacks = {
  onToggleVoice: () => void;
  onToggleMic: () => void;
  onResumePlayback: () => void;
};

export function LobbyOverlay(props: {
  s: Snapshot;
  leaving: boolean;
  voiceStatus: VoiceStatus;
  controls: GameSettings["controls"];
  onStart: () => void;
  onSettings: () => void;
  onLeave: () => void;
} & VoiceCallbacks) {
  const { s, leaving, voiceStatus, controls, onStart, onSettings, onLeave, onToggleVoice, onToggleMic, onResumePlayback } = props;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0b0710]/70 backdrop-blur-sm">
      <div className="hc-rise max-h-[88dvh] w-[min(92vw,440px)] overflow-y-auto rounded-lg border border-[#3a2733] bg-[#140d18]/95 p-4 text-center sm:p-6">
        <h2 className="font-display text-4xl text-[#e9dfcf]">{s.round > 0 ? `Night ${s.round + 1} approaches` : "Gathering at dusk"}</h2>
        <p className="mt-1 text-sm text-[#9c8b7a]">{s.round > 0 ? "The same souls, the same street — new roles when darkness falls" : "Share the town code with your fellow townsfolk"}</p>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-snug text-[#c9b8a4]">The wards are broken. Deliver a kit from the movable cart, then press E at the ward to play its repair puzzle. More hands push the cart faster. Cages hold suspects; repair every ward to win.</p>
        <div className="mt-3 font-mono text-5xl tracking-[0.4em] text-[#d99a3d]">{s.code}</div>
        <div className="mt-5 grid grid-cols-2 gap-2 text-left text-sm">
          {s.players.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded bg-[#1d1420] px-3 py-2">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0 truncate text-[#d8c9b4]">{p.name}</span>
              {p.isHost && <span className="ml-auto text-xs text-[#d99a3d]">host</span>}
            </div>
          ))}
        </div>
        {s.self.id === s.hostId ? (
          <button
            onClick={onStart}
            disabled={s.playerCount < 4}
            className="mt-6 w-full rounded bg-[#8f3b1f] py-3 font-display text-2xl text-[#f3e6d0] hover:bg-[#a84a26] disabled:opacity-40"
          >
            {s.playerCount < 4 ? "Waiting for more souls… (min 4)" : "Let night fall"}
          </button>
        ) : (
          <p className="mt-6 text-[#9c8b7a]">Waiting for the host to let night fall…</p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={onSettings} className="rounded border border-[#3a2733] px-3 py-1.5 text-sm text-[#c9b8a4] hover:border-[#c9762f] hover:text-[#ffd98a]">⚙ Settings</button>
          <Link href="/tutorial" className="flex items-center gap-1.5 rounded border border-[#3a2733] px-3 py-1.5 text-sm text-[#c9b8a4] hover:border-[#c9762f] hover:text-[#ffd98a]">
            <BookOpen className="h-3.5 w-3.5 text-[#d99a3d]" /> Tutorial
          </Link>
        </div>
        <button onClick={onLeave} disabled={leaving}
          className="mt-3 w-full rounded border border-[#84624c] px-4 py-2 text-sm text-[#e9dfcf] hover:bg-[#33231f] disabled:opacity-50">
          {leaving ? "Leaving…" : "← Back to towns"}
        </button>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button onClick={onToggleVoice} disabled={voiceStatus.starting}
            className="rounded border border-[#648262] px-3 py-2 text-sm text-[#b8d8a4] disabled:opacity-50">
            {voiceStatus.starting ? "Asking for microphone…" : voiceStatus.active ? "Leave voice chat" : "Join proximity voice"}
          </button>
          {voiceStatus.active && <button onClick={onToggleMic} className="rounded border border-[#3a2733] px-3 py-2 text-sm text-[#c9b8a4]">
            {voiceStatus.muted ? "Unmute mic" : "Mute mic"}
          </button>}
        </div>
        {voiceStatus.active && <p className="mt-2 text-xs text-[#9c8b7a]">{voiceStatus.connected} connected ({voiceStatus.p2pCount} P2P, {voiceStatus.relayCount} Server Relay) · {voiceStatus.nearby} in earshot. Farther voices fade; the dead hear only the dead.{voiceStatus.speaking ? " · ● Speaking" : ""}</p>}
        {voiceStatus.error && <p role="alert" className="mt-2 text-xs text-[#e29a84]">
          {voiceStatus.error}
          {voiceStatus.error.includes("Enable sound") && <button onClick={onResumePlayback} className="ml-2 underline">Enable sound</button>}
        </p>}
        <p className="mt-3 text-xs text-[#9a877f]">4–10 players · 1–2 of you will be Hollow</p>
      </div>
    </div>
  );
}

export function EndOverlay(props: {
  s: Snapshot;
  voiceStatus: VoiceStatus;
  onRestart: () => void;
  onSettings: () => void;
} & VoiceCallbacks) {
  const { s, voiceStatus, onRestart, onSettings, onToggleVoice, onToggleMic } = props;
  const router = useRouter();
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0b0710]/80 backdrop-blur-sm">
      <div className="hc-rise max-h-[88dvh] w-[min(94vw,640px)] overflow-y-auto rounded-lg border border-[#3a2733] bg-[#140d18]/95 p-4 text-center sm:p-7">
        <p className={`font-display text-4xl sm:text-6xl ${s.winner === "hollow" ? "text-[#ff4a3a]" : "text-[#a8c98a]"}`}>
          {s.winner === "hollow" ? "The Hollow wins" : "The town survives"}
        </p>
        <p className="mt-4 text-lg italic text-[#c9b8a4]">{s.winReason}</p>
        {s.results && (
          <section className="mt-5 text-left" aria-label="Match results">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-[#c9b8a4]">
              <span>Who was who · this match</span>
              <span className="font-mono normal-case tracking-normal text-[#9c8b7a]">
                {Math.floor(s.results.durationSec / 60)}m {String(s.results.durationSec % 60).padStart(2, "0")}s
              </span>
            </div>
            <div className="max-h-[43dvh] space-y-2 overflow-y-auto pr-1">
              {s.results.players.map((player) => {
                const st = player.stats;
                const labels: [string, number][] = [
                  ["Repaired", st.repairs], ["Kits", st.kitsDelivered], ["Kills", st.kills], ["Deaths", st.deaths],
                  ["Jailed", st.timesCaged], ["Unlocked", st.cagesOpened], ["Votes", st.votes], ["Reports", st.reports],
                  ["Ruins", st.ruins], ["Bells", st.bells], ["Snuffs", st.blackouts], ["Steps", st.distance],
                ];
                return (
                  <div key={player.id} className="rounded border border-[#3a2733] bg-[#1d1420] p-2.5">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="h-3 w-3 rounded-full" style={{ background: player.color }} />
                      <strong className="text-[#e9dfcf]">{player.name}</strong>
                      <span className={`ml-auto rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${player.role === "hollow" ? "bg-[#4a1210] text-[#ff8a7a]" : "bg-[#1d2a1a] text-[#a8c98a]"}`}>
                        {player.role === "hollow" ? "Hollow" : "Townfolk"}
                      </span>
                      <span className="text-[10px] text-[#9c8b7a]">{!player.alive ? "dead" : player.caged ? "jailed" : "free"}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-x-2 gap-y-1 text-[10px] tabular-nums text-[#9c8b7a] sm:text-xs">
                      {labels.map(([label, value]) => <span key={label}>{label} <b className="text-[#e9dfcf]">{value}</b></span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button onClick={onToggleVoice} disabled={voiceStatus.starting} className="rounded border border-[#648262] px-3 py-2 text-sm text-[#b8d8a4] disabled:opacity-50">
            {voiceStatus.starting ? "Opening mic…" : voiceStatus.active ? "Leave voice" : "Join proximity voice"}
          </button>
          {voiceStatus.active && <button onClick={onToggleMic} className="rounded border border-[#3a2733] px-3 py-2 text-sm text-[#c9b8a4]">{voiceStatus.muted ? "Unmute mic" : "Mute mic"}</button>}
        </div>
        {s.self.id === s.hostId ? (
          <button
            onClick={onRestart}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded bg-[#8f3b1f] py-3 font-display text-2xl text-[#f3e6d0] transition-colors hover:bg-[#a84a26]"
          >
            <Flame className="h-5 w-5" /> Gather the same souls again
          </button>
        ) : (
          <p className="mt-6 rounded border border-[#3a2733] bg-[#0d0810]/60 py-3 text-sm text-[#9c8b7a]">
            The lantern-bearer may gather this town for another night…
          </p>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-3">
          <button onClick={onSettings} className="rounded border border-[#3a2733] px-4 py-2 text-sm text-[#c9b8a4] hover:border-[#c9762f] hover:text-[#ffd98a]">⚙ Settings</button>
          <button onClick={() => router.push("/")} className="flex items-center gap-2 rounded border border-[#3a2733] px-5 py-2 font-display text-lg text-[#c9b8a4] hover:bg-[#2a1a26]"><DoorOpen className="h-4 w-4" /> Other towns</button>
          <a href={`/chronicle/${s.code}`} target="_blank" className="flex items-center gap-2 rounded border border-[#3a2733] px-5 py-2 font-display text-lg text-[#d99a3d] hover:bg-[#2a1a26]"><ScrollText className="h-4 w-4" /> Chronicle</a>
          <a href="/stats" target="_blank" className="flex items-center gap-2 rounded border border-[#3a2733] px-5 py-2 font-display text-lg text-[#c9b8a4] hover:bg-[#2a1a26]"><Trophy className="h-4 w-4" /> Records</a>
        </div>
      </div>
    </div>
  );
}

