"use client";

// Presentational HUD overlays for the room screen, split out of GameClient.
// All game logic stays in GameClient — these components only render + call back.

import { Telescope } from "lucide-react";
import { keyLabel, type GameSettings } from "@/game/settings";

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="status" aria-live="polite" className="hc-toast absolute bottom-32 left-1/2 sm:bottom-44 -translate-x-1/2">{text}</div>
  );
}

export function NoteReader({ note, onClose }: { note: { text: string; author: string }; onClose: () => void }) {
  // The raised glass. Nothing is drawn over the page itself — it is read on the
  // canvas — but the glass must be easy to lower on every device: any key, a
  // tap on the scene, or the "Lower the glass" button that sits above the
  // touch controls. The move/interact buttons stay usable underneath.
  // Keyboard handling (any key lowers the glass) lives in useGameInput, which
  // owns the game's keydown; a second listener here raced it on the Z key.
  return (
    <>
      <div className="absolute inset-x-0 top-0 bottom-28 z-20 sm:bottom-32" onClick={onClose} data-testid="note-reader" role="button"
        aria-label={note.author ? `Page pinned by ${note.author}: ${note.text}. Tap to lower the spyglass.` : "Spyglass raised. Tap to lower it."}>
        {/* The words and the author are on the paper in-world; this line carries
            them for assistive tech (and for scripts/smoke-time-room-ui.mjs). */}
        <span className="sr-only">{note.text}{note.author ? ` — pinned by ${note.author}` : ""}</span>
      </div>
      <button type="button" onClick={onClose} data-testid="lower-glass"
        className="hc-btn hc-btn-teal absolute bottom-[max(7.5rem,calc(env(safe-area-inset-bottom)+7rem))] left-1/2 z-30 -translate-x-1/2 px-4 py-2 text-sm shadow-lg sm:bottom-[max(8.5rem,calc(env(safe-area-inset-bottom)+8rem))]">
        <Telescope className="h-4 w-4" /> Lower the glass
      </button>
    </>
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



