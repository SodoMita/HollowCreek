import { NextRequest, NextResponse } from "next/server";
import { loadRoom, snapshot } from "@/game/engine";

export const dynamic = "force-dynamic";

// Cheap fingerprint of a snapshot. `now` is the wall clock and the only field
// that changes on an idle town, so it is excluded from the hash.
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") ?? "";
  const playerId = req.nextUrl.searchParams.get("playerId") ?? "";
  const room = await loadRoom(code);
  if (!room) return NextResponse.json({ error: "No such town." }, { status: 404 });
  const snap = snapshot(room, playerId);
  if (!snap) return NextResponse.json({ error: "Unknown soul." }, { status: 404 });
  const etag = `"${fnv1a(JSON.stringify({ ...snap, now: 0 }))}"`;
  const headers = { etag, "cache-control": "no-store" };
  // Idle towns answer 304 — the client already has this exact state.
  if (req.nextUrl.searchParams.get("rev") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json(snap, { headers });
}