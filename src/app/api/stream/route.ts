import { engine } from "@/server/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-sent events: authoritative snapshots pushed ~20x per second. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.toUpperCase() ?? "";
  const playerId = url.searchParams.get("playerId") ?? "";
  const room = engine.get(code);
  if (!room || !playerId || !room.players.has(playerId)) {
    return new Response("gone", { status: 404 });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        room.subscribers.delete(sub);
        room.onUnsubscribe(playerId);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const sub = { playerId, write, lastEventId: 0, close };
      room.subscribers.add(sub);
      room.onSubscribe(playerId);
      write(`retry: 1200\n\n`);
      heartbeat = setInterval(() => write(`: ping\n\n`), 15000);
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
