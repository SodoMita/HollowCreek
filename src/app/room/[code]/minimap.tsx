"use client";

// The creek strip: a read-only sense of the whole valley under the top bar.
// Only what the snapshot already reveals is drawn — vision filtering happens
// on the server, so this can never leak a hidden player.
import { WORLD_MIN, WORLD_MAX } from "@/game/buildings";
import { BELL_X, MEETING_FROM, MEETING_TO } from "@/game/types";
import type { Snapshot } from "@/game/types";

const pct = (x: number) => ((x - WORLD_MIN) / (WORLD_MAX - WORLD_MIN)) * 100;

export function Minimap({ s, me }: { s: Snapshot; me: Snapshot["players"][number] | undefined }) {
  const selfX = me?.x;
  const past = s.time?.mode === "past";
  return (
    <div
      aria-hidden
      className={`hc-hud-item hc-hud-fade pointer-events-none absolute left-1/2 z-10 w-[min(92vw,540px)] -translate-x-1/2 ${past ? "hidden sm:top-[6.9rem] sm:block" : "top-[3.1rem] sm:top-[4.2rem]"}`}
    >
      <div className="relative h-7 overflow-hidden rounded-full border border-[#3a2733]/70 bg-[#0d0810]/70 backdrop-blur-sm">
        {/* the road */}
        <div className="absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-[#3f7a72]/60 via-[#84624c]/70 to-[#c07a2f]/60" />
        {/* meeting square */}
        <div
          className={`absolute top-0 h-full ${s.phase === "meeting" ? "bg-[#d99a3d]/25" : "bg-[#d99a3d]/8"}`}
          style={{ left: `${pct(MEETING_FROM)}%`, width: `${pct(MEETING_TO) - pct(MEETING_FROM)}%` }}
        />
        {/* your lantern reach */}
        {typeof selfX === "number" && s.visionRadius < 1500 && (
          <div
            className="absolute top-0 h-full bg-gradient-to-r from-transparent via-[#ffd98a]/12 to-transparent"
            style={{ left: `${pct(selfX - s.visionRadius)}%`, width: `${pct(selfX + s.visionRadius) - pct(selfX - s.visionRadius)}%` }}
          />
        )}
        {/* wards */}
        {s.tasks.map((t) => (
          <span
            key={t.id}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${t.inside ? "h-2 w-2 rotate-45" : "h-2 w-2 rounded-full"} ${
              t.done ? "bg-[#6b8e5a]" : t.sabotaged ? "bg-[#e06a5a]" : t.delivered ? "bg-[#ffd98a] shadow-[0_0_5px_rgba(255,217,138,.8)]" : "bg-[#8a6f4d]"
            }`}
            style={{ left: `${pct(t.x)}%` }}
          />
        ))}
        {/* the meeting bell, engraved in brass like the rest of the rail */}
        <svg viewBox="0 0 10 10" className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-[58%]" style={{ left: `${pct(BELL_X)}%` }} aria-hidden>
          <path d="M5 1.2c-1.9 0-2.7 1.5-2.7 3.1 0 1.5-.6 2.2-1.1 2.7h7.6c-.5-.5-1.1-1.2-1.1-2.7 0-1.6-.8-3.1-2.7-3.1Z" fill="#d99a3d" />
          <circle cx="5" cy="8.2" r="0.9" fill="#d99a3d" />
        </svg>
        {/* cart */}
        <span className="absolute top-1/2 h-1.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-[#e2be83] bg-[#4a3323]" style={{ left: `${pct(s.cartX)}%` }} />
        {/* cages */}
        {s.cages.map((c) => (
          <span key={c.x} className={`absolute top-1/2 h-2 w-1 -translate-x-1/2 -translate-y-1/2 rounded-[1px] ${c.occupant ? "bg-[#c9b8a4]" : "bg-[#4a4552]"}`} style={{ left: `${pct(c.x)}%` }} />
        ))}
        {/* visible souls (server-filtered) */}
        {s.players.map((p) => p.id === s.self.id ? null : (
          <span
            key={p.id}
            className={`absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${!p.alive ? "opacity-40" : ""}`}
            style={{ left: `${pct(p.x)}%`, background: p.color }}
          />
        ))}
        {/* you */}
        {typeof selfX === "number" && (
          <span
            className="absolute top-1/2 h-0 w-0 -translate-x-1/2 -translate-y-[86%] border-x-[4px] border-t-[6px] border-x-transparent border-t-[#ffd98a] drop-shadow-[0_0_4px_rgba(255,217,138,.9)]"
            style={{ left: `${pct(selfX)}%` }}
          />
        )}
      </div>
    </div>
  );
}
