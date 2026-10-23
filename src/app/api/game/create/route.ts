import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "@/game/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { playerId, name, creature } = await req.json().catch(() => ({}));
  if (!playerId || typeof playerId !== "string") {
    return NextResponse.json({ error: "playerId required" }, { status: 400 });
  }
  const code = createRoom(playerId, String(name ?? "Stranger"), typeof creature === "string" ? creature : undefined);
  return NextResponse.json({ code });
}