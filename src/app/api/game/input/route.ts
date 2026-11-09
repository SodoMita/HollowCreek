import { NextRequest, NextResponse } from "next/server";
import { getRoom, handleInput, loadRoom } from "@/game/engine";
import { admit } from "@/server/rate-limit";
import type { InputBody } from "@/game/types";

export const dynamic = "force-dynamic";
const OK_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

export async function POST(req: NextRequest) {
  const { code, ...body } = (await req.json().catch(() => ({}))) as InputBody & { code?: string };
  const normCode = code && String(code).length <= 8 ? String(code).toUpperCase() : "";
  // Limit per soul (town + player) so a shared address never throttles a whole household.
  const soul = `${normCode}:${String(body.playerId ?? "").slice(0, 64)}`;
  if (!admit(req, "input", soul, 1800, 18000)) {
    return NextResponse.json({ ok: false, error: "Slow down." }, { status: 429 });
  }
  const room = normCode ? (getRoom(normCode) ?? await loadRoom(normCode)) : undefined;
  if (!room) return NextResponse.json({ ok: false, error: "No such town." }, { status: 404 });
  const res = handleInput(room, body);
  if (res.ok) return new Response('{"ok":true}', { status: 200, headers: OK_HEADERS });
  return NextResponse.json(res, { status: 400 });
}