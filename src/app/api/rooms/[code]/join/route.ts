import { engine } from "@/server/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; playerId?: string; token?: string };

  const room = engine.get(code);
  if (!room) return Response.json({ error: "That town does not exist." }, { status: 404 });

  // reconnect with a stored identity
  if (body.playerId && body.token) {
    const snap = room.snapshot(body.playerId);
    if (snap) {
      const p = room.players.get(body.playerId);
      if (p && p.token === body.token) {
        p.lastSeen = Date.now();
        return Response.json({ code: room.code, playerId: p.id, token: p.token, name: p.name });
      }
    }
  }

  const used = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  let name = (body.name ?? "").trim().slice(0, 14) || "Stranger";
  if (used.has(name.toLowerCase())) name = `${name.slice(0, 11)}-${room.players.size + 1}`;
  const { id, token } = room.addPlayer(name);
  return Response.json({ code: room.code, playerId: id, token, name });
}
