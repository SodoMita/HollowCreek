import { NextRequest, NextResponse } from "next/server";
import { getRoom, handleInput, loadRoom, roomNow } from "@/game/engine";
import { ix } from "@/game/types";
import { admit } from "@/server/rate-limit";
import type { InputBody } from "@/game/types";

export const dynamic = "force-dynamic";
const OK_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

export async function POST(req: NextRequest) {
  const { code, ...body } = (await req.json().catch(() => ({}))) as InputBody & { code?: string };
  const normCode = code && String(code).length <= 8 ? String(code).toUpperCase() : "";
  // Limit per soul (town + player) so a shared address never throttles a whole household.
  const soul = `${normCode}:${String(body.playerId ?? "").slice(0, 64)}`;
  // A spent movement/action window must never prevent release. This separate,
  // still per-soul/per-address bounded lane cannot execute an action or chat.
  const releaseOnly = body.dir === 0 && !body.action && !body.chat;
  if (!admit(req, releaseOnly ? "stop" : "input", soul, 1800, 18000)) {
    return NextResponse.json({ ok: false, error: "Slow down." }, { status: 429 });
  }
  const room = normCode ? (getRoom(normCode) ?? await loadRoom(normCode)) : undefined;
  if (!room) return NextResponse.json({ ok: false, error: "No such town." }, { status: 404 });
  const res = handleInput(room, body);
  if (res.ok) {
    const p = room.players.get(String(body.playerId ?? ""));
    const payload: Record<string, unknown> = {
      ok: true,
      stale: res.stale ?? false,
      at: roomNow(room),
    };
    if (p) {
      payload.x = ix(p.x);
      payload.drawX = Math.round((p.x + (p.subX ?? 0)) * 1000) / 1000;
      payload.facing = p.facing;
      payload.inside = p.inside;
    }
    return NextResponse.json(payload, { status: 200, headers: OK_HEADERS });
  }
  return NextResponse.json(res, { status: 400 });
}