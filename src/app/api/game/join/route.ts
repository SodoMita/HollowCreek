import { NextRequest, NextResponse } from "next/server";
import { joinRoom } from "@/game/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { code, playerId, name } = await req.json().catch(() => ({}));
  if (!code || !playerId) return NextResponse.json({ error: "code and playerId required" }, { status: 400 });
  const res = joinRoom(String(code), String(playerId), String(name ?? "Stranger"));
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}