import { NextRequest, NextResponse } from "next/server";
import { joinRoom, loadRoom } from "@/game/engine";
import { allow, clientKey } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!allow(`join:${clientKey(req)}`, 90, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many joins from one address. Wait a minute." }, { status: 429 });
  }
  const { code, playerId, name } = await req.json().catch(() => ({}));
  if (!code || typeof code !== "string" || code.length > 8) return NextResponse.json({ error: "code required" }, { status: 400 });
  if (!playerId || typeof playerId !== "string" || playerId.length > 64) return NextResponse.json({ error: "playerId required" }, { status: 400 });
  const room = await loadRoom(code.toUpperCase());
  if (!room) return NextResponse.json({ error: "No such town. Check the code." }, { status: 404 });
  const res = joinRoom(code, playerId, String(name ?? "Stranger").slice(0, 14));
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}