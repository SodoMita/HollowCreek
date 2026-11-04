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

export function PinPanel(props: {
  text: string;
  onText: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { text, onText, onSubmit, onCancel } = props;
  return (

  <div className="hc-hud-item absolute bottom-20 left-1/2 w-[min(92vw,420px)] -translate-x-1/2 rounded-lg border border-[#6e5638]/60 bg-[#140d18]/95 p-3 sm:bottom-24" data-testid="pin-note-panel">
    <div className="mb-1.5 text-xs uppercase tracking-widest text-[#9c8b7a]">Pin a page to a wall or tree — inside a house it goes on the interior wall</div>
    <textarea
      value={text}
      onChange={(e) => onText(e.target.value.slice(0, 200))}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } e.stopPropagation(); }}
      maxLength={200}
      rows={4}
      placeholder="Write your note… (max 200 characters)"
      aria-label="Write the page to pin"
      className="w-full resize-none rounded border border-[#d99a3d]/40 bg-[#1d1420] px-3 py-2 text-sm text-[#e9dfcf] placeholder:text-[#9a877f] focus-visible:outline-2 focus-visible:outline-[#d99a3d]"
    />
    <div className="mt-2 flex items-center justify-between">
      <span className="text-[11px] text-[#9a877f]">{text.trim().length}/200</span>
      <div className="flex gap-2">
        <button onClick={onCancel} className="rounded border border-[#3a2733] px-3 py-1.5 text-xs text-[#9c8b7a] hover:text-[#e9dfcf]">Cancel</button>
        <button onClick={onSubmit} disabled={!text.trim()} data-testid="pin-note-submit"
          className="rounded bg-[#8f3b1f] px-3 py-1.5 text-xs text-[#f3e6d0] hover:bg-[#a84a26] disabled:opacity-50">Pin page</button>
      </div>
    </div>
  </div>

  );
}

export function ChatBox(props: {
  alive: boolean;
  text: string;
  onText: (v: string) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { alive, text, onText, onSubmit, inputRef } = props;
  return (

  <div className="hc-hud-item absolute bottom-20 left-1/2 w-[min(92vw,420px)] sm:bottom-24 -translate-x-1/2">
    <input
      ref={inputRef}
      value={text}
      onChange={(e) => onText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); e.stopPropagation(); }}
      onBlur={onSubmit}
      maxLength={120}
      placeholder={alive ? "Say something… (it appears above your head)" : "Whisper to the dead…"}
      aria-label="Chat message"
      autoComplete="off"
      spellCheck={false}
      className="w-full rounded-full border border-[#d99a3d]/50 bg-[#140d18]/95 px-5 py-3 text-[#e9dfcf] placeholder:text-[#9a877f] focus-visible:outline-2 focus-visible:outline-[#d99a3d]"
    />
  </div>

  );
}
