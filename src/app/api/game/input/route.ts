import { NextRequest, NextResponse } from "next/server";
import { getRoom, handleInput, loadRoom } from "@/game/engine";
import { roomNow } from "@/game/chronicle";
import { ix } from "@/game/types";
import { admit } from "@/server/rate-limit";
import type { InputBody } from "@/game/types";

export const dynamic = "force-dynamic";

// Newest-wins guard for steering that arrives out of order. With two requests
// in flight (the client no longer queues a keypress behind the previous one) a
// slow first request can land after a fast second and would otherwise overwrite
// the newer direction. Kept here rather than in the game state: replay never
// sees it, so recorded nights stay byte-identical.
const lastSeq = new Map<string, number>();

export async function POST(req: NextRequest) {
  const { code, ...body } = (await req.json().catch(() => ({}))) as InputBody & { code?: string };
  // Limit per soul (town + player) so a shared address never throttles a whole household.
  const normCode = code && String(code).length <= 8 ? String(code).toUpperCase() : "";
  const soul = `${normCode}:${String(body.playerId ?? "").slice(0, 64)}`;
  // 30 inputs/s per soul: a steering change per keypress plus held-action toggles, never a dropped key.
  if (!admit(req, "input", soul, 1800, 12000)) {
    return NextResponse.json({ ok: false, error: "Slow down." }, { status: 429 });
  }
  const seq = typeof body.seq === "number" && Number.isFinite(body.seq) ? body.seq : null;
  if (seq !== null) {
    const seen = lastSeq.get(soul);
    if (seen !== undefined && seq < seen) {
      // A stale steering packet: acknowledge without applying it.
      return NextResponse.json({ ok: true, stale: true }, { status: 200 });
    }
    lastSeq.set(soul, seq);
    if (lastSeq.size > 4096) lastSeq.clear();
  }
  const room = normCode ? (getRoom(normCode) ?? await loadRoom(normCode)) : undefined;
  if (!room) return NextResponse.json({ ok: false, error: "No such town." }, { status: 404 });
  const res = handleInput(room, body);
  // A handler that falls off the end returns undefined; `NextResponse.json`
  // would then send an empty body and the client would throw on `res.json()`
  // instead of reporting the rejected action.
  const payload = { ...(res ?? { ok: false, error: "Nothing to do." }) } as Record<string, unknown>;
  if (payload.ok) {
    // Answer with the acting soul's position as of *this* input. Without it the
    // client learns the consequence only when the next stream frame arrives, so
    // every keypress costs a round trip PLUS a wait for the stream — the single
    // largest source of input lag in a client that does not predict.
    const soul = room.players.get(String(body.playerId ?? ""));
    if (soul) {
      payload.x = ix(soul.x);
      payload.facing = soul.facing;
      payload.inside = soul.inside;
      payload.at = roomNow(room);
    }
  }
  return NextResponse.json(payload, { status: payload.ok ? 200 : 400 });
}