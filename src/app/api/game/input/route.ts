import { NextRequest, NextResponse } from "next/server";
import { handleInput, loadRoom } from "@/game/engine";
import { allow, clientKey } from "@/server/rate-limit";
import type { InputBody } from "@/game/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!allow(`input:${clientKey(req)}`, 600, 60_000)) {
    return NextResponse.json({ ok: false, error: "Slow down." }, { status: 429 });
  }
  const { code, ...body } = (await req.json().catch(() => ({}))) as InputBody & { code?: string };
  const room = code && String(code).length <= 8 ? await loadRoom(String(code).toUpperCase()) : undefined;
  if (!room) return NextResponse.json({ ok: false, error: "No such town." }, { status: 404 });
  const res = handleInput(room, body);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}