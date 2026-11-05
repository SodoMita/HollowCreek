import { NextRequest } from "next/server";
import { loadRoom, onRoomEvent, roomEtag, snapshot } from "@/game/engine";
import { allow, clientKey } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Server-push state stream (SSE). Holds the connection open and sends frames
 * only when the room fingerprint changed — replaces the 100ms poll for
 * clients that support EventSource. Frames: `{etag, snap}` once on connect,
 * then `{etag, delta}` with only the changed top-level fields (the client
 * merges), and `{clock}` once a second while nothing else moves. Heartbeats
 * keep proxies from idling the connection out; the client falls back to
 * polling on any error.
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
  let lastSent: Record<string, unknown> | null = null; // what this viewer holds, for deltas
  let lastFrameAt = 0;
  let lastClockAt = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const encoder = new TextEncoder();
  const FRAME_MS = 100; // at most 10 frames/s per viewer; the client interpolates
  const CLOCK_MS = 1000; // an idle town only sends its clock, once a second

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
      // Room events fire every 50 ms tick; coalesce them so a viewer gets at
      // most one frame per FRAME_MS, and that frame carries only the top-level
      // fields that changed since the previous one (`now` always rides along).
      const push = () => {
        if (closed) return;
        const t = Date.now();
        if (t - lastFrameAt < FRAME_MS) {
          if (!trailing) trailing = setTimeout(() => { trailing = null; push(); }, FRAME_MS - (t - lastFrameAt));
          return;
        }
        const snap = snapshot(room, playerId); // also the presence heartbeat
        if (!snap) { send({ gone: true }); cleanup(); return; }
        const etag = roomEtag(room, playerId, snap);
        if (etag === lastEtag && lastSent) {
          if (t - lastClockAt >= CLOCK_MS) { lastClockAt = t; send({ clock: snap.now }); }
          return;
        }
        lastFrameAt = t;
        lastClockAt = t;
        const next = snap as unknown as Record<string, unknown>;
        if (!lastSent) {
          send({ etag, snap });
        } else {
          const delta: Record<string, unknown> = {};
          for (const key of new Set([...Object.keys(lastSent), ...Object.keys(next)])) {
            if (key === "now") continue;
            const a = lastSent[key], b = next[key];
            if (a === b) continue;
            if (JSON.stringify(a) !== JSON.stringify(b)) delta[key] = b === undefined ? null : b;
          }
          delta.now = snap.now;
          send({ etag, delta });
        }
        lastSent = next;
        lastEtag = etag;
      };
      const unsub = onRoomEvent(code, push);
      const hb = setInterval(heartbeat, 15_000);
      const tick = setInterval(push, 250); // covers time-derived fields and presence between room events
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
