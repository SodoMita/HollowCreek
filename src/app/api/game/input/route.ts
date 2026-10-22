import { NextRequest, NextResponse } from "next/server";
import { handleInput, loadRoom } from "@/game/engine";
import type { InputBody } from "@/game/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { code, ...body } = (await req.json().catch(() => ({}))) as InputBody & { code?: string };
  const room = code ? await loadRoom(String(code)) : undefined;
  if (!room) return NextResponse.json({ ok: false, error: "No such town." }, { status: 404 });
  const res = handleInput(room, body);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}