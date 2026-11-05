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

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="status" aria-live="polite" className="absolute bottom-32 left-1/2 sm:bottom-44 -translate-x-1/2 rounded bg-[#1c1210]/95 px-4 py-2 text-sm text-[#d99a3d]">{text}</div>
  );
}

/** Reading happens on the paper itself, in the world. This is only a quiet
 *  status chip (with the words for screen readers) — never a pop-out page. */
export function NoteReader({ note, onClose }: { note: { text: string; author: string }; onClose: () => void }) {
  return (
    <div data-testid="note-reader" role="status"
      className="hc-hud-item fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#8a6f4d]/70 bg-[#160f18]/95 px-4 py-2 text-sm text-[#e9dfcf] shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur">
      <span className="sr-only">{note.text} — pinned by {note.author}</span>
      <span aria-hidden className="whitespace-nowrap text-[#d99a3d]">Reading the pinned page</span>
      <span aria-hidden className="hidden whitespace-nowrap text-[#9c8b7a] sm:inline">the words are on the paper · Esc to look away</span>
      <button onClick={onClose} aria-label="Look away from the page"
        className="rounded-full border border-[#3a2733] px-2 py-0.5 text-xs text-[#c9b8a4] hover:border-[#d99a3d] hover:text-[#ffd98a]">✕</button>
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
            <p className="mx-auto mt-3 max-w-md px-6 text-lg text-[#c9a0a0]">Wear their faces. {keyLabel(controls.ability)} to strike, {keyLabel(controls.blackout)} to snuff, {keyLabel(controls.ruin)} to ruin a supplied or repaired ward.</p>
          </>
        ) : (
          <>
            <p className="font-display text-5xl sm:text-7xl text-[#a8c98a]">Townfolk</p>
            <p className="mx-auto mt-3 max-w-md px-6 text-lg text-[#b8c9a4]">Carry kits from the one cart to broken wards; press E to open each repair puzzle. Push together to move the cart faster.</p>
          </>
        )}
      </div>
    </div>
  );
}



