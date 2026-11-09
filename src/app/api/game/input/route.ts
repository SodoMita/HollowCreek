import { NextRequest, NextResponse } from "next/server";
import { handleInput, loadRoom } from "@/game/engine";
import { admit } from "@/server/rate-limit";
import type { InputBody } from "@/game/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { code, ...body } = (await req.json().catch(() => ({}))) as InputBody & { code?: string };
  // Limit per soul (town + player) so a shared address never throttles a whole household.
  const soul = `${String(code ?? "").slice(0, 8).toUpperCase()}:${String(body.playerId ?? "").slice(0, 64)}`;
  if (!admit(req, "input", soul, 1800, 18000)) {
    return NextResponse.json({ ok: false, error: "Slow down." }, { status: 429 });
  }
  const room = code && String(code).length <= 8 ? await loadRoom(String(code).toUpperCase()) : undefined;
  if (!room) return NextResponse.json({ ok: false, error: "No such town." }, { status: 404 });
  const res = handleInput(room, body);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}