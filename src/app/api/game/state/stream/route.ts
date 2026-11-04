import { NextRequest } from "next/server";
import { loadRoom, onRoomEvent, roomEtag, snapshot } from "@/game/engine";
import { allow, clientKey } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Server-push state stream (SSE). Holds the connection open and sends a fresh
 * snapshot only when the room fingerprint changed — replaces the 100ms poll
 * for clients that support EventSource. Heartbeats keep proxies from idling
 * the connection out; the client falls back to polling on any error.
 */
export async function GET(req: NextRequest) {
  if (!allow(`stream:${clientKey(req)}`, 20, 60_000)) {
    return new Response("Slow down.", { status: 429 });
  }
  const codeParam = req.nextUrl.searchParams.get("code") ?? "";
  const code = codeParam.length <= 8 ? codeParam.toUpperCase() : "";
  const playerId = (req.nextUrl.searchParams.get("playerId") ?? "").slice(0, 64);
  const room = code ? await loadRoom(code) : undefined;
  if (!room) return new Response("No such town.", { status: 404 });

  let lastEtag = "";
  let closed = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* closed */ }
      };
      const heartbeat = () => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(":hb\n\n")); } catch { /* closed */ }
      };
      const push = () => {
        const snap = snapshot(room, playerId);
        if (!snap) { send({ gone: true }); cleanup(); return; }
        const etag = roomEtag(room, playerId, snap);
        if (etag !== lastEtag) {
          lastEtag = etag;
          send({ etag, snap });
        }
      };
      const unsub = onRoomEvent(code, push);
      const hb = setInterval(heartbeat, 15_000);
      const tick = setInterval(push, 250); // also covers time-derived fields between room events
      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        clearInterval(tick);
        unsub();
        try { controller.close(); } catch { /* already closed */ }
      }
      req.signal.addEventListener("abort", cleanup);
      push(); // initial snapshot immediately
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
