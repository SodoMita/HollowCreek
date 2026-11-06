import { NextRequest, NextResponse } from "next/server";
import { loadRoom, roomEtag, snapshot } from "@/game/engine";
import { nextFrame, waitForFrame } from "@/game/viewers";
import { allow, clientKey } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

const WAIT_MS = 900; // a long-poll returns within this even when nothing changes

/**
 * Viewer state. Plain `GET ?code&playerId` returns the full snapshot (304 when
 * `rev` matches). With `delta=1` the answer is a wire frame (src/game/wire.ts):
 * a full snapshot when the server does not know what this client holds,
 * otherwise only the changed fields. With `wait=1` the request is held for
 * up to WAIT_MS until there is something worth sending — one request per
 * second when idle, an immediate answer when something moves.
 */
export async function GET(req: NextRequest) {
  if (!allow(`state:${clientKey(req)}`, 1200, 60_000)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }
  const sp = req.nextUrl.searchParams;
  const codeParam = sp.get("code") ?? "";
  const code = codeParam.length <= 8 ? codeParam.toUpperCase() : "";
  const playerId = (sp.get("playerId") ?? "").slice(0, 64);
  const rev = sp.get("rev");
  const wantDelta = sp.get("delta") === "1";
  const wait = sp.get("wait") === "1";
  const room = await loadRoom(code);
  if (!room) return NextResponse.json({ error: "No such town." }, { status: 404 });

  if (wantDelta) {
    const now = Date.now();
    let r = nextFrame(room, playerId, rev, now);
    if (!r) return NextResponse.json({ error: "Unknown soul." }, { status: 404 });
    if (!r.frame && wait) {
      const frame = await waitForFrame(room, playerId, rev, WAIT_MS, req.signal);
      r = frame ? { frame, snapNow: frame.now } : r;
    }
    const headers = { "cache-control": "no-store", etag: r.frame?.etag ?? rev ?? "" };
    if (!r.frame) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json(r.frame, { headers });
  }

  const snap = snapshot(room, playerId);
  if (!snap) return NextResponse.json({ error: "Unknown soul." }, { status: 404 });
  const etag = roomEtag(room, playerId, snap);
  const headers = { etag, "cache-control": "no-store" };
  // Idle towns answer 304 — the client already has this exact state.
  if (rev === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json(snap, { headers });
}
