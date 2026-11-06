import { NextRequest } from "next/server";
import { loadRoom, onRoomEvent } from "@/game/engine";
import { FRAME_MS, nextFrame, slowDueIn } from "@/game/viewers";
import { allow, clientKey } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Server-push state stream (SSE). One full `{etag, now, snap}` frame on
 * connect, then `{etag, now, delta?, patch?}` frames carrying only what
 * changed (see src/game/wire.ts), at most ten a second. Slow values ride once
 * a second; an idle town sends only a `{now}` tick once a second. Heartbeat
 * comments keep proxies from idling the connection out; the client falls
 * back to the long-poll on any error.
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

  let holds: string | null = null; // etag of what this client holds
  let computedAt = 0;
  let clockAt = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const encoder = new TextEncoder();
  const CLOCK_MS = 1000;

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
      const later = (ms: number) => {
        if (trailing || closed) return;
        trailing = setTimeout(() => { trailing = null; push(); }, Math.max(1, ms));
      };
      // Room events fire every 50 ms tick; snapshots are computed at most
      // once per FRAME_MS per viewer, and only the diff goes down the wire.
      const push = () => {
        if (closed) return;
        const t = Date.now();
        if (t - computedAt < FRAME_MS) { later(FRAME_MS - (t - computedAt)); return; }
        computedAt = t;
        const r = nextFrame(room, playerId, holds, t);
        if (!r) { send({ gone: true, now: t }); cleanup(); return; }
        if (r.frame) {
          holds = r.frame.etag ?? holds;
          clockAt = t;
          send(r.frame);
        } else if (t - clockAt >= CLOCK_MS) {
          clockAt = t;
          send({ now: r.snapNow });
        }
        const due = slowDueIn(room, playerId, t);
        if (due > 0) later(due); // held slow values go out on the beat even if the room sleeps
      };
      const unsub = onRoomEvent(code, push);
      const hb = setInterval(heartbeat, 15_000);
      const tick = setInterval(push, 250); // presence heartbeat + clock between room events
      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        clearInterval(tick);
        if (trailing) clearTimeout(trailing);
        unsub();
        try { controller.close(); } catch { /* already closed */ }
      }
      req.signal.addEventListener("abort", cleanup);
      push(); // initial full snapshot immediately
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
