import { NextRequest, NextResponse } from "next/server";
import { readNetStats } from "@/game/netstats";
import { rooms } from "@/game/registry";
import { admit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Server timing diagnostics for the ?net=1 readout: tick interval spread,
 * tick work time, event-loop blocking and GC pauses over the last ~10 s.
 * Lets a stutter be attributed to the server instead of the network.
 */
export async function GET(req: NextRequest) {
  if (!admit(req, "netstats", "", 120, 1200)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }
  return NextResponse.json({ ...readNetStats(), rooms: rooms.size }, { headers: { "cache-control": "no-store" } });
}
