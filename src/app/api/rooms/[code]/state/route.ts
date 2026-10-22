import { engine } from "@/server/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Snapshot for one player - identical payload to the SSE stream. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const playerId = new URL(req.url).searchParams.get("playerId") ?? "";
  const room = engine.get(code);
  if (!room) return Response.json({ error: "no such room" }, { status: 404 });
  const snap = room.snapshot(playerId);
  if (!snap) return Response.json({ error: "no such player" }, { status: 404 });
  return Response.json(snap);
}
