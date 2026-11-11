import { NextResponse } from "next/server";
import { rooms } from "@/game/registry";
import { tickStats } from "@/game/tick";

export const dynamic = "force-dynamic";

/**
 * Server tick health for diagnosing stutter during development.
 * Read-only, aggregate counts only: no positions, names, roles or chat.
 * `late` counts ticks whose interval exceeded 1.75x the target, and `work` is the
 * time the tick loop itself spent, so a hold can be attributed to the server
 * (late tick / long work) instead of the network.
 */
export function GET() {
  const active = [...rooms.values()].filter((room) => room.players.size > 0);
  return NextResponse.json(
    {
      ok: true,
      tick: tickStats(),
      rooms: {
        live: active.length,
        playing: active.filter((room) => room.phase === "playing" || room.phase === "meeting").length,
        souls: active.reduce((sum, room) => sum + room.players.size, 0),
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
