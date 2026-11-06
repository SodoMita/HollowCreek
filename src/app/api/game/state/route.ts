import { NextRequest, NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { loadRoom, roomEtag, snapshot } from "@/game/engine";
import { compactSnapshot, deltaCompact, type WireSnapshot } from "@/game/wire";
import { allow, clientKey } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

// Per-player last compact frame, so pollers can ask for a delta (prev=<etag>).
// Idle towns quantise to a stable etag, so the delta is usually empty.
const lastFrames = new Map<string, { etag: string; frame: WireSnapshot }>();

export async function GET(req: NextRequest) {
  if (!allow(`state:${clientKey(req)}`, 2400, 60_000)) {
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
  // c=1: the compact wire format — reconstructible fields never cross the network
  const compact = req.nextUrl.searchParams.get("c") === "1";
  let payload: unknown = snap;
  if (compact) {
    const frame = compactSnapshot(snap, Number(req.nextUrl.searchParams.get("f") ?? 0) || 0);
    const prev = req.nextUrl.searchParams.get("prev") ?? "";
    const cached = lastFrames.get(playerId);
    payload = prev && cached && cached.etag === prev
      ? { etag, delta: deltaCompact(cached.frame, frame) }
      : { ...frame, etag };
    if (lastFrames.size > 128) lastFrames.clear();
    lastFrames.set(playerId, { etag, frame });
  }
  const body = JSON.stringify(payload);
  // Route handlers bypass Next's compressor, so gzip the hot path by hand:
  // a warm poll is ~500 bytes on the wire instead of ~4700.
  if ((req.headers.get("accept-encoding") ?? "").includes("gzip")) {
    return new NextResponse(gzipSync(body, { level: 1 }), {
      headers: { ...headers, "content-type": "application/json", "content-encoding": "gzip", vary: "accept-encoding" },
    });
  }
  return new NextResponse(body, { headers: { ...headers, "content-type": "application/json" } });
}