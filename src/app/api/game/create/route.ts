import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "@/game/engine";
import { allow, clientKey } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!allow(`create:${clientKey(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many towns from one address. Wait a minute." }, { status: 429 });
  }
  const { playerId, name } = await req.json().catch(() => ({}));
  if (!playerId || typeof playerId !== "string" || playerId.length > 64) {
    return NextResponse.json({ error: "playerId required" }, { status: 400 });
  }
  const code = createRoom(playerId, String(name ?? "Stranger").slice(0, 14));
  return NextResponse.json({ code });
}