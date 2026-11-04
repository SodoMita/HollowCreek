"use client";

// Presentational HUD overlays for the room screen, split out of GameClient.
// All game logic stays in GameClient — these components only render + call back.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, DoorOpen, Flame, Mic, MicOff, ScrollText, Trophy, Volume2 } from "lucide-react";
import type { Snapshot } from "@/game/types";
import type { VoiceStatus } from "@/game/voice";
import { keyLabel, type GameSettings } from "@/game/settings";
import { BUILDINGS } from "@/game/buildings";

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="status" aria-live="polite" className="absolute bottom-32 left-1/2 sm:bottom-44 -translate-x-1/2 rounded bg-[#1c1210]/95 px-4 py-2 text-sm text-[#d99a3d]">{text}</div>
  );
}

export function NoteReader({ note, onClose }: { note: { text: string; author: string }; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0b0710]/60 backdrop-blur-[2px]" onClick={onClose}>
      <div data-testid="note-reader" onClick={(e) => e.stopPropagation()}
        className="hc-rise w-[min(92vw,460px)] -rotate-1 rounded-sm border border-[#6e5638] bg-[#f4ead2] p-5 text-[#2c2118] shadow-2xl sm:p-7">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-[0.25em] text-[#6e5638]">Pinned page</span>
          <button onClick={onClose} aria-label="Close page" className="rounded px-2 py-0.5 text-[#6e5638] hover:bg-[#e0d2b2]">✕</button>
        </div>
        <p className="whitespace-pre-wrap break-words font-display text-lg leading-relaxed sm:text-xl">{note.text}</p>
        <p className="mt-3 text-right text-xs italic text-[#6e5638]">— pinned by {note.author}</p>
        <p className="mt-2 text-center text-[11px] text-[#6e5638]">zoomed in · click anywhere to put it back</p>
      </div>
    </div>
  );
}

export function RoleBanner({ role, controls }: { role: string; controls: GameSettings["controls"] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60">
      <div className="text-center">
        {role === "hollow" ? (
          <>
            <p className="font-display text-5xl sm:text-7xl text-[#ff4a3a] drop-shadow-[0_0_30px_rgba(255,60,40,0.6)]">You are Hollow</p>
            <p className="mt-3 text-lg text-[#c9a0a0]">Wear their faces. {keyLabel(controls.ability)} to strike, {keyLabel(controls.blackout)} to snuff, {keyLabel(controls.ruin)} to ruin a supplied or repaired ward.</p>
          </>
        ) : (
          <>
            <p className="font-display text-5xl sm:text-7xl text-[#a8c98a]">Townfolk</p>
            <p className="mt-3 text-lg text-[#b8c9a4]">Carry kits from the one cart to broken wards; press E to open each repair puzzle. Push together to move the cart faster.</p>
          </>
        )}
      </div>
    </div>
  );
}

type VoiceCallbacks = {
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

export function TopBar(props: {
  s: Snapshot;
  me: Snapshot["players"][number] | undefined;
  nearestNote: { id: string; x: number; author: string; text: string } | undefined;
  muted: boolean;
  leaving: boolean;
  voiceStatus: VoiceStatus;
  controls: GameSettings["controls"];
  onCopyCode: () => void;
  onTimepiece: () => void;
  onPinToggle: () => void;
  onReadNote: (note: { id: string; x: number; author: string; text: string }) => void;
  onDropKit: () => void;
  onMute: () => void;
  onToggleVoice: () => void;
  onToggleMic: () => void;
  onSettings: () => void;
  onLeave: () => void;
}) {
  const { s, me, nearestNote, muted, leaving, voiceStatus, controls,
    onCopyCode, onTimepiece, onPinToggle, onReadNote, onDropKit, onMute,
    onToggleVoice, onToggleMic, onSettings, onLeave } = props;
  return (
<div className="hc-hud-item hc-hud-fade absolute left-0 right-0 top-0 flex items-start justify-between gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-xs sm:gap-3 sm:p-3 sm:text-sm">
  <div className="min-w-0 rounded border border-[#3a2733]/70 bg-[#140d18]/80 px-2 py-1.5 backdrop-blur sm:px-3 sm:py-2">
    <span className="hidden font-display text-lg text-[#d99a3d] md:inline">Hollow Creek</span>
    <button
      onClick={onCopyCode}
      className="rounded bg-[#2a1a26] px-2 py-0.5 font-mono tracking-[0.3em] text-[#e9dfcf] hover:bg-[#3a2733] focus-visible:outline-2 focus-visible:outline-[#d99a3d] md:ml-3"
      title="Copy town code"
      aria-label={`Copy town code ${s.code}`}
    >{s.code}</button>
    <span className="ml-2 hidden text-[#9c8b7a] sm:inline">{s.playerCount} souls</span>
    {me?.inside && <span className="ml-2 text-[#e2be83]">Inside {BUILDINGS.find((b) => b.id === me.inside)?.name}</span>}
    {(s.self.hasTimepiece || s.time?.mode === "past") && <button onClick={onTimepiece} className="ml-2 rounded border border-[#7ba9a6] bg-[#243b3c]/90 px-2 py-1 text-xs text-[#cbeae1]">{s.time?.mode === "past" ? "Return · M" : "Timepiece · M"}</button>}
    {s.phase === "playing" && s.self.alive && (
      <button title="Pin a handwritten page to a wall or tree (inside a house: its interior wall)" aria-label="Pin page"
        onClick={onPinToggle}
        className="ml-2 rounded bg-[#4a3323] px-1.5 py-0.5 text-xs text-[#f2cf91] hover:bg-[#684327]">
        ✎<span className="hidden sm:inline"> Pin page</span>
      </button>
    )}
    {nearestNote && s.phase === "playing" && (
      <button title={`Read the page pinned by ${nearestNote.author}`} aria-label="Read page" data-testid="read-note"
        onClick={() => onReadNote(nearestNote!)}
        className="ml-2 rounded border border-[#d99a3d]/60 bg-[#243b3c]/90 px-1.5 py-0.5 text-xs text-[#cbeae1] hover:bg-[#2f4a4b]">
        📖<span className="hidden sm:inline"> Read page</span>
      </button>
    )}
    {s.phase === "playing" && s.self.alive && s.self.hasSupply && (
      <button title="Drop repair kit for another player" aria-label="Drop repair kit"
        onClick={onDropKit}
        className="ml-2 rounded bg-[#4a3323] px-1.5 py-0.5 text-xs text-[#f2cf91] hover:bg-[#684327]">
        ▣<span className="hidden sm:inline"> Drop kit · {keyLabel(controls.drop)}</span>
      </button>
    )}
  </div>
  {s.phase !== "lobby" && (
    <div className="mt-1 hidden w-72 sm:block">
      <div className="mb-1 text-center text-xs uppercase tracking-widest text-[#9c8b7a]">Town wards restored</div>
      <div className="h-3 overflow-hidden rounded-full border border-[#3a2733] bg-[#140d18]/80">
        <div className="h-full bg-gradient-to-r from-[#8f3b1f] to-[#d99a3d] transition-[width] duration-500" style={{ width: `${s.taskBar.total ? (100 * s.taskBar.done) / s.taskBar.total : 0}%` }} />
      </div>
    </div>
  )}
  <div className="flex shrink-0 items-center gap-1 sm:gap-2">
    <span className={`rounded px-1 py-1 font-display text-xs sm:px-3 sm:py-1.5 sm:text-lg ${!s.self.alive ? "bg-[#2a2a3a]/80 text-[#9aa]" : s.self.role === "hollow" ? "bg-[#4a1210]/90 text-[#ff6a5a]" : "bg-[#1d2a1a]/80 text-[#a8c98a]"}`}>
      <span className="sm:hidden">{!s.self.alive ? "Ghost" : s.self.role === "hollow" ? "Hollow" : "Crew"}</span>
      <span className="hidden sm:inline">{!s.self.alive ? "Ghost" : s.self.role === "hollow" ? "The Hollow" : "Townfolk"}</span>
      {s.self.caged && s.self.alive ? " · Caged" : ""}
    </span>
    <button
      onClick={onMute}
      title={muted ? "Unmute" : "Mute"}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      aria-pressed={muted}
      className="rounded border border-[#3a2733] bg-[#140d18]/80 px-2 py-1 text-[#9c8b7a] hover:text-[#d99a3d] focus-visible:outline-2 focus-visible:outline-[#d99a3d] sm:py-1.5"
    >{muted ? "🔇" : "🔊"}</button>
    <button onClick={onToggleVoice} disabled={voiceStatus.starting} aria-label={voiceStatus.active ? "Leave proximity voice" : "Join proximity voice"}
      aria-pressed={voiceStatus.active} title={voiceStatus.active ? `Voice: ${voiceStatus.connected} connected (${voiceStatus.p2pCount} P2P, ${voiceStatus.relayCount} Relay) · ${voiceStatus.nearby} nearby · ${voiceStatus.speaking ? "Speaking" : "Listening"} · ${keyLabel(controls.talk)} to leave` : `Join proximity voice (${keyLabel(controls.talk)}) — asks for microphone permission`}
      className={`rounded border px-1.5 py-1 sm:py-1.5 ${voiceStatus.active ? (voiceStatus.speaking ? "border-[#ffd98a] bg-[#3a2a16] text-[#ffd98a]" : "border-[#6b8e5a] bg-[#1d2a1a]/90 text-[#b8d8a4]") : "border-[#3a2733] bg-[#140d18]/80 text-[#c9b8a4]"}`}>
      {voiceStatus.starting ? "…" : <Volume2 className={`h-4 w-4 ${voiceStatus.speaking ? "animate-pulse text-[#ffd98a]" : ""}`} />}
    </button>
    {voiceStatus.active && <button onClick={onToggleMic} aria-label={voiceStatus.muted ? "Unmute microphone" : "Mute microphone"}
      title={voiceStatus.muted ? "Unmute microphone" : "Mute microphone"}
      className="rounded border border-[#3a2733] bg-[#140d18]/80 px-1.5 py-1 text-[#c9b8a4] sm:py-1.5">
      {voiceStatus.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>}
    <button
      onClick={onSettings}
      title="Settings"
      aria-label="Settings"
      className="rounded border border-[#3a2733] bg-[#140d18]/80 px-2 py-1 text-[#c9b8a4] hover:border-[#c9762f] hover:text-[#ffd98a] sm:py-1.5"
    >⚙</button>
    <button onClick={onLeave} disabled={leaving} aria-label="Back to towns" className="rounded border border-[#3a2733] bg-[#140d18]/80 px-2 py-1 text-[#9c8b7a] hover:text-[#e06a5a] disabled:opacity-50 sm:px-3 sm:py-1.5"><span className="sm:hidden">←</span><span className="hidden sm:inline">Back</span></button>
  </div>
</div>
  );
}
