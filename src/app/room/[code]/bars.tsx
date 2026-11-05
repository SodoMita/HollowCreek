"use client";

// Presentational HUD overlays for the room screen, split out of GameClient.
// All game logic stays in GameClient — these components only render + call back.

import Link from "next/link";
import type { VoiceCallbacks } from "./overlays";
import { useRouter } from "next/navigation";
import { BookOpen, DoorOpen, Flame, Mic, MicOff, ScrollText, Telescope, Trophy, Volume2, Zap } from "lucide-react";
import type { Snapshot } from "@/game/types";
import type { VoiceStatus } from "@/game/voice";
import { keyLabel, type GameSettings } from "@/game/settings";
import { BUILDINGS } from "@/game/buildings";
import { BELL_X } from "@/game/types";

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
  <div className="hc-panel min-w-0 px-2 py-1.5 sm:px-3 sm:py-2">
    <span className="hidden font-display text-lg text-[#d99a3d] md:inline">Hollow Creek</span>
    <button
      onClick={onCopyCode}
      className="rounded bg-[#2a1a26] px-2 py-0.5 font-mono tracking-[0.3em] text-[#e9dfcf] hover:bg-[#3a2733] focus-visible:outline-2 focus-visible:outline-[#d99a3d] md:ml-3"
      title="Copy town code"
      aria-label={`Copy town code ${s.code}`}
    >{s.code}</button>
    <span className="ml-2 hidden text-[#9c8b7a] sm:inline">{s.playerCount} souls</span>
    {me?.inside && <span className="ml-2 text-[#e2be83]">Inside {BUILDINGS.find((b) => b.id === me.inside)?.name}</span>}
    {(s.self.hasTimepiece || s.time?.mode === "past") && <button onClick={onTimepiece} className="hc-btn hc-btn-teal ml-2 px-2 py-1 text-xs">{s.time?.mode === "past" ? "Return · M" : "Timepiece · M"}</button>}
    {s.phase === "playing" && s.self.alive && (
      <button title="Pin a handwritten page to a wall or tree (inside a house: its interior wall)" aria-label="Pin page"
        onClick={onPinToggle}
        className="ml-2 rounded bg-[#4a3323] px-1.5 py-0.5 text-xs text-[#f2cf91] hover:bg-[#684327]">
        ✎<span className="hidden sm:inline"> Pin page</span>
      </button>
    )}
    {nearestNote && s.phase === "playing" && (
      <button title={`Raise the spyglass to the page pinned by ${nearestNote.author}`} aria-label="Spyglass" data-testid="read-note"
        onClick={() => onReadNote(nearestNote!)}
        className="hc-btn hc-btn-teal ml-2 px-1.5 py-0.5 text-xs">
        <Telescope className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Spyglass</span>
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
      <span className="sm:hidden">{!s.self.alive ? "Ghost" : s.self.role === "hollow" ? "Hollow" : "Townfolk"}</span>
      <span className="hidden sm:inline">{!s.self.alive ? "Ghost" : s.self.role === "hollow" ? "The Hollow" : "Townfolk"}</span>
      {s.self.caged && s.self.alive ? " · Caged" : ""}
    </span>
    <button
      onClick={onMute}
      title={muted ? "Unmute" : "Mute"}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      aria-pressed={muted}
      className="hc-btn hc-btn-ghost px-2 py-1 sm:py-1.5"
    >{muted ? "🔇" : "🔊"}</button>
    <button onClick={onToggleVoice} disabled={voiceStatus.starting} aria-label={voiceStatus.active ? "Leave proximity voice" : "Join proximity voice"}
      aria-pressed={voiceStatus.active} title={voiceStatus.active ? `Voice: ${voiceStatus.connected} connected (${voiceStatus.p2pCount} P2P, ${voiceStatus.relayCount} Relay) · ${voiceStatus.nearby} nearby · ${voiceStatus.speaking ? "Speaking" : "Listening"} · ${keyLabel(controls.talk)} to leave` : `Join proximity voice (${keyLabel(controls.talk)}) — asks for microphone permission`}
      className={`rounded border px-1.5 py-1 sm:py-1.5 ${voiceStatus.active ? (voiceStatus.speaking ? "border-[#ffd98a] bg-[#3a2a16] text-[#ffd98a]" : "border-[#6b8e5a] bg-[#1d2a1a]/90 text-[#b8d8a4]") : "border-[#3a2733] bg-[#140d18]/80 text-[#c9b8a4]"}`}>
      {voiceStatus.starting ? "…" : <Volume2 className={`h-4 w-4 ${voiceStatus.speaking ? "animate-pulse text-[#ffd98a]" : ""}`} />}
    </button>
    {voiceStatus.active && <button onClick={onToggleMic} aria-label={voiceStatus.muted ? "Unmute microphone" : "Mute microphone"}
      title={voiceStatus.muted ? "Unmute microphone" : "Mute microphone"}
      className="hc-btn hc-btn-ghost px-1.5 py-1 sm:py-1.5">
      {voiceStatus.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>}
    <button
      onClick={onSettings}
      title="Settings"
      aria-label="Settings"
      className="hc-btn hc-btn-ghost px-2 py-1 sm:py-1.5"
    >⚙</button>
    <button onClick={onLeave} disabled={leaving} aria-label="Back to towns" className="hc-btn hc-btn-ghost hc-btn-danger px-2 py-1 sm:px-3 sm:py-1.5"><span className="sm:hidden">←</span><span className="hidden sm:inline">Back</span></button>
  </div>
</div>
  );
}

export function BottomControls(props: {
  s: Snapshot;
  controls: GameSettings["controls"];
  nearbyKeyedDoor: boolean;
  nearbyDoorLocked: boolean | undefined;
  onMove: (dir: "left" | "right", on: boolean) => void;
  onPush: (on: boolean) => void;
  onDropKit: () => void;
  onChat: () => void;
  onDoorLock: () => void;
  onInteractDown: () => void;
  onInteractUp: () => void;
  onBlackout: () => void;
  onAbility: () => void;
}) {
  const { s, controls, nearbyKeyedDoor, nearbyDoorLocked,
    onMove, onPush, onDropKit, onChat, onDoorLock, onInteractDown, onInteractUp, onBlackout, onAbility } = props;
  return (
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
      <button onClick={onDropKit}
        className="hc-btn hc-btn-amber self-start px-2 py-1 text-[11px]">
        Drop kit · {keyLabel(controls.drop)}
      </button>
    ) : (
      <button onPointerDown={(e) => { e.preventDefault(); onPush(true); }}
        onPointerUp={() => onPush(false)}
        onPointerLeave={() => onPush(false)}
        onPointerCancel={() => onPush(false)}
        onContextMenu={(e) => e.preventDefault()}
        className="hc-btn hc-btn-amber self-start px-2 py-1 text-[11px]">
        Hold Push + ◀▶ {s.cartPushers > 0 ? `· ${s.cartPushers} pushing` : ""}
      </button>
    ))}
    <div className="flex gap-2 sm:gap-3">
    {([["left", "◀"], ["right", "▶"]] as const).map(([d, glyph]) => (
      <button
        key={d}
        className="h-[52px] w-[52px] rounded-full border border-[#3a2733] bg-[#140d18]/80 text-xl text-[#d8c9b4] backdrop-blur active:bg-[#3a2733] sm:h-16 sm:w-16 sm:text-2xl short:h-12 short:w-12"
        onPointerDown={(e) => { e.preventDefault(); onMove(d, true); }}
        onPointerUp={() => onMove(d, false)}
        onPointerLeave={() => onMove(d, false)}
        onPointerCancel={() => onMove(d, false)}
        onContextMenu={(e) => e.preventDefault()}
      >{glyph}</button>
    ))}
    </div>
  </div>
  <div className="flex items-end gap-2 sm:gap-3">
    <button
      onClick={onChat}
      className="hc-btn hc-btn-ghost h-11 rounded-full px-3 text-sm backdrop-blur sm:px-4"
    >💬<span className="hidden sm:inline"> Speak</span></button>
    {nearbyKeyedDoor && s.self.alive && !s.self.caged && (
      <button onClick={onDoorLock} className="hc-btn hc-btn-amber h-11 rounded-full px-3 text-xs" title="Lock or unlock with this house key">{nearbyDoorLocked ? "Unlock" : "Lock"} · L</button>
    )}
    <div className="flex flex-col items-center gap-1">
      {s.hint && <span className="hc-interaction-hint max-w-36 rounded bg-[#0d0810]/80 px-2 py-0.5 text-center text-xs text-[#d99a3d] sm:max-w-44">{s.hint}</span>}
      <button
        onPointerDown={(e) => { e.preventDefault(); onInteractDown(); }}
        onPointerUp={onInteractUp}
        onPointerLeave={onInteractUp}
        onPointerCancel={onInteractUp}
        className={`h-[52px] w-[52px] rounded-full border-2 font-display text-sm sm:h-16 sm:w-16 sm:text-base short:h-12 short:w-12 text-lg backdrop-blur ${s.hint ? "border-[#d99a3d] bg-[#3a2410]/90 text-[#ffd98a]" : "border-[#3a2733] bg-[#140d18]/80 text-[#9c8b7a]"}`}
      >{keyLabel(controls.interact)}</button>
    </div>
    {s.self.role === "hollow" && s.self.alive && s.phase === "playing" && (
      <div className="flex flex-col items-center gap-1">
        {s.self.blackoutCooldownMs > 0 && (
          <span className="rounded bg-[#0d0810]/80 px-2 py-0.5 text-xs tabular-nums text-[#9aa]">{Math.ceil(s.self.blackoutCooldownMs / 1000)}s</span>
        )}
        <button
          onClick={onBlackout}
          title="Snuff every lantern (F)"
          className={`h-[52px] w-[52px] rounded-full border-2 font-display text-sm sm:h-16 sm:w-16 sm:text-base short:h-12 short:w-12 text-base leading-tight backdrop-blur ${s.self.canBlackout ? "border-[#7a6ab0] bg-[#1a1430]/90 text-[#b0a0e0] shadow-[0_0_18px_rgba(120,100,200,0.35)]" : "border-[#3a2733] bg-[#140d18]/80 text-[#9a877f]"}`}
        >Snuff<br /><span className="text-[10px]">{keyLabel(controls.blackout)}</span></button>
      </div>
    )}
    <div className="flex flex-col items-center gap-1">
      {s.self.role === "hollow" && s.self.killCooldownMs > 0 && s.self.alive && (
        <span className="rounded bg-[#0d0810]/80 px-2 py-0.5 text-xs tabular-nums text-[#ff6a5a]">{Math.ceil(s.self.killCooldownMs / 1000)}s</span>
      )}
      <button
        onClick={onAbility}
        disabled={!s.self.alive}
        className={`h-[52px] w-[52px] rounded-full border-2 font-display text-sm sm:h-16 sm:w-16 sm:text-base short:h-12 short:w-12 text-base leading-tight backdrop-blur ${s.abilityReady ? (s.self.role === "hollow" ? "border-[#ff4a3a] bg-[#4a1210]/90 text-[#ff8a7a] shadow-[0_0_20px_rgba(255,60,40,0.4)]" : "border-[#d99a3d] bg-[#3a2410]/90 text-[#ffd98a]") : "border-[#3a2733] bg-[#140d18]/80 text-[#9a877f]"}`}
      >{s.abilityLabel}</button>
    </div>
  </div>
</div>
  );
}

