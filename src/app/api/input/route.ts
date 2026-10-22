import { engine } from "@/server/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Client -> server input. The client never sends positions, only intent.
 * The server owns every position, cooldown and outcome.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    code?: string;
    playerId?: string;
    token?: string;
    action?: unknown;
  } | null;

  if (!body?.code || !body.playerId || !body.token || !body.action) {
    return Response.json({ error: "Malformed input." }, { status: 400 });
  }
  const room = engine.get(body.code);
  if (!room) return Response.json({ error: "That town does not exist." }, { status: 404 });

  const err = room.handle(body.playerId, body.token, body.action as never);
  if (err) return Response.json({ error: err }, { status: 200 });
  return Response.json({ ok: true });
}
