import { engine } from "@/server/engine";
import { recorder } from "@/server/recorder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const rooms = engine.list();
  const stats = await recorder.stats();
  return Response.json({ rooms, stats });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const room = engine.createRoom();
  const { id, token } = room.addPlayer((body.name ?? "").trim() || "Stranger");
  return Response.json({ code: room.code, playerId: id, token });
}
