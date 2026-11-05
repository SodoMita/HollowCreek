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
    <div role="status" aria-live="polite" className="hc-toast absolute bottom-32 left-1/2 sm:bottom-44 -translate-x-1/2">{text}</div>
  );
}

export function NoteReader({ note, onClose }: { note: { text: string; author: string }; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0b0710]/60 backdrop-blur-[2px]" onClick={onClose}>
      <div data-testid="note-reader" onClick={(e) => e.stopPropagation()}
        className="hc-rise w-[min(92vw,460px)] -rotate-1 rounded-sm border border-[#6e5638] bg-[#f4ead2] p-5 text-[#2c2118] shadow-2xl sm:p-7">
        <div className="mb-2 flex items-center justify-between">
          <span className="hc-eyebrow text-[#6e5638]">Pinned page</span>
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



