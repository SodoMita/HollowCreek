import { NextRequest, NextResponse } from "next/server";
import { postVoiceSignal, takeVoiceSignals } from "@/game/engine";

export const dynamic = "force-dynamic";

/** Poll sealed signalling envelopes addressed to one player. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") ?? "";
  const playerId = req.nextUrl.searchParams.get("playerId") ?? "";
  const since = Number(req.nextUrl.searchParams.get("since") ?? "0") || 0;
  const res = takeVoiceSignals(code, playerId, since);
  return NextResponse.json(res, { status: res.ok ? 200 : 404 });
}

/** Relay one WebRTC envelope (offer / answer / ICE) to a town member. */
export async function POST(req: NextRequest) {
  const { code, playerId, to, kind, payload } = await req.json().catch(() => ({}));
  if (typeof code !== "string" || typeof playerId !== "string") {
    return NextResponse.json({ ok: false, error: "code and playerId required" }, { status: 400 });
  }
  const res = postVoiceSignal(code, playerId, String(to ?? ""), String(kind ?? ""), String(payload ?? ""));
  const status = res.ok ? 200 : res.error === "No such town." ? 404 : 400;
  return NextResponse.json(res, { status });
}
