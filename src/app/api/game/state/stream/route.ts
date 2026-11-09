import { NextRequest } from "next/server";
import { loadRoom, onRoomEvent } from "@/game/engine";
import { FRAME_MS, nextFrame, slowDueIn } from "@/game/viewers";
import { admit } from "@/server/rate-limit";

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
  let computedAt = 0;
  let clockAt = 0;
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
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
      const scheduleCoalesce = (ms: number) => {
        if (coalesceTimer || closed) return;
        coalesceTimer = setTimeout(() => { coalesceTimer = null; push(true); }, Math.max(1, ms));
      };
      const scheduleSlow = (ms: number) => {
        if (slowTimer || closed) return;
        slowTimer = setTimeout(() => { slowTimer = null; push(false); }, Math.max(1, ms));
      };
      // Coalesce sub-3ms bursts without delaying any 8ms server tick or blocking
      // fast position frames behind the 1s slow-value timer.
      const COALESCE_MS = Math.min(3, FRAME_MS);
      const push = (isEvent = true) => {
        if (closed) return;
        const t = Date.now();
        if (isEvent && t - computedAt < COALESCE_MS) { scheduleCoalesce(COALESCE_MS - (t - computedAt)); return; }
        const r = nextFrame(room, playerId, holds, t);
        if (!r) { send({ gone: true, now: t }); cleanup(); return; }
        if (r.frame) {
          holds = r.frame.etag ?? holds;
          computedAt = t;
          clockAt = t;
          send(r.frame);
        } else if (t - clockAt >= CLOCK_MS) {
          clockAt = t;
          send({ now: r.snapNow });
        }
        const due = slowDueIn(room, playerId, t);
        if (due > 0) scheduleSlow(due); // held slow values go out on the beat even if the room sleeps
      };
      const unsub = onRoomEvent(code, () => push(true));
      const hb = setInterval(heartbeat, 15_000);
      const tick = setInterval(() => push(false), 250); // presence heartbeat + clock between room events
      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        clearInterval(tick);
        if (coalesceTimer) clearTimeout(coalesceTimer);
        if (slowTimer) clearTimeout(slowTimer);
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
      "cache-control": "no-cache, no-store, no-transform",
      "content-encoding": "identity",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
