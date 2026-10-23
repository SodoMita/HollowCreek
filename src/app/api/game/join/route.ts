import { NextRequest, NextResponse } from "next/server";
import { joinRoom, loadRoom } from "@/game/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { code, playerId, name, creature } = await req.json().catch(() => ({}));
  if (!code || !playerId) return NextResponse.json({ ok: false, error: "code and playerId required" }, { status: 400 });
  const room = await loadRoom(String(code));
  if (!room) return NextResponse.json({ ok: false, error: "No such town. Check the code." }, { status: 404 });
  const res = joinRoom(
    String(code),
    String(playerId),
    String(name ?? "Stranger"),
    typeof creature === "string" ? creature : undefined
  );
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
