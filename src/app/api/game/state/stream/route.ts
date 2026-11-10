import { NextRequest } from "next/server";
import { loadRoom, onRoomEvent } from "@/game/engine";
import { nextFrame, slowDueIn } from "@/game/viewers";
import { admit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Server-push state stream (SSE). One full `{etag, now, snap}` frame on
 * connect, then `{etag, now, delta?, patch?}` frames carrying only what
 * changed (see src/game/wire.ts). A frame goes out right after every server
 * tick that changed something this viewer can see (TICK_RATE per second while
 * a neighbour walks) — no coalescing window, so a client that draws raw server
 * positions sees every tick. Slow values ride once a second; an idle town sends
 * only a `{now}` tick once a second. Heartbeat comments keep proxies from
 * idling the connection out; the client falls back to the long-poll on error.
 */
export async function GET(req: NextRequest) {
  const codeParam = req.nextUrl.searchParams.get("code") ?? "";
  const code = codeParam.length <= 8 ? codeParam.toUpperCase() : "";
  const playerId = (req.nextUrl.searchParams.get("playerId") ?? "").slice(0, 64);
  // Connections are few per soul (one open stream plus occasional reconnects).
  if (!admit(req, "stream", `${code}:${playerId}`, 30, 300)) {
    return new Response("Slow down.", { status: 429 });
  }
  const room = code ? await loadRoom(code) : undefined;
  if (!room) return new Response("No such town.", { status: 404 });

  let holds: string | null = null; // etag of what this client holds
  let clockAt = 0;
  let scheduled = false;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let closeStream: (() => void) | null = null;
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
      const push = (flush = false) => {
        if (closed) return;
        const t = Date.now();
        const r = nextFrame(room, playerId, holds, t, flush);
        if (!r) { send({ gone: true, now: t }); cleanup(); return; }
        if (r.frame) {
          holds = r.frame.etag ?? holds;
          clockAt = t;
          send(r.frame);
        } else if (t - clockAt >= CLOCK_MS) {
          clockAt = t;
          send({ now: r.snapNow });
        }
        // Held slow values go out on the beat even if the room sleeps.
        const due = slowDueIn(room, playerId, t);
        if (due > 0 && !trailing) trailing = setTimeout(() => { trailing = null; push(true); }, due);
      };
      // A tick emits once per room, but an input between ticks also emits
      // (markDirty). Batch multiple emits in one call stack into a single
      // microtask flush so chunks leave immediately without yielding to timers.
      const onEvent = () => {
        if (scheduled || closed) return;
        scheduled = true;
        queueMicrotask(() => { scheduled = false; push(); });
      };
      const unsub = onRoomEvent(code, onEvent);
      const hb = setInterval(heartbeat, 15_000);
      const clock = setInterval(() => push(), CLOCK_MS); // presence heartbeat + clock when the room is silent
      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        clearInterval(clock);
        if (trailing) { clearTimeout(trailing); trailing = null; }
        unsub();
        req.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* already closed */ }
      }
      closeStream = cleanup;
      req.signal.addEventListener("abort", cleanup);
      push(); // initial full snapshot immediately
    },
    cancel() { closeStream?.(); closed = true; },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "content-encoding": "identity",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
