import { NextRequest, NextResponse } from "next/server";
import { loadRoom, roomEtag, snapshot } from "@/game/engine";
import { allow, clientKey } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!allow(`state:${clientKey(req)}`, 1200, 60_000)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }
  const codeParam = req.nextUrl.searchParams.get("code") ?? "";
  const code = codeParam.length <= 8 ? codeParam.toUpperCase() : "";
  const playerId = (req.nextUrl.searchParams.get("playerId") ?? "").slice(0, 64);
  const room = await loadRoom(code);
  if (!room) return NextResponse.json({ error: "No such town." }, { status: 404 });
  const snap = snapshot(room, playerId);
  if (!snap) return NextResponse.json({ error: "Unknown soul." }, { status: 404 });
  const etag = roomEtag(room, playerId, snap);
  const headers = { etag, "cache-control": "no-store" };
  // Idle towns answer 304 — the client already has this exact state.
  if (req.nextUrl.searchParams.get("rev") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json(snap, { headers });
}