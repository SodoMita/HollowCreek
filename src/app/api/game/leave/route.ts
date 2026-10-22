import { NextRequest, NextResponse } from "next/server";
import { leaveRoom } from "@/game/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // sendBeacon posts a Blob; fall back to text parsing
  const raw = await req.text().catch(() => "");
  let body: { code?: string; playerId?: string } = {};
  try { body = JSON.parse(raw); } catch { /* empty */ }
  if (!body.code || !body.playerId) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json(leaveRoom(String(body.code), String(body.playerId)));
}