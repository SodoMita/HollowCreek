import { NextRequest, NextResponse } from "next/server";
import { getRoom, snapshot } from "@/game/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") ?? "";
  const playerId = req.nextUrl.searchParams.get("playerId") ?? "";
  const room = getRoom(code);
  if (!room) return NextResponse.json({ error: "No such town." }, { status: 404 });
  const snap = snapshot(room, playerId);
  if (!snap) return NextResponse.json({ error: "Unknown soul." }, { status: 404 });
  return NextResponse.json(snap);
}