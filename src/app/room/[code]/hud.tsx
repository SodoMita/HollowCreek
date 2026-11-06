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
  // Nothing is drawn here: the page is read on the canvas through the spyglass.
  // This is only an invisible click-catcher (click or Esc lowers the glass),
  // with the page text for screen readers.
  return (
    <div className="absolute inset-0 z-20" onClick={onClose} data-testid="note-reader" role="button"
      aria-label={note.author ? `Page pinned by ${note.author}: ${note.text}. Click to lower the spyglass.` : "Spyglass raised. Click to lower it."}>
      <span className="sr-only">{note.text}</span>
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



