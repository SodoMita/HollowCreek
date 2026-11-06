import { NextRequest } from "next/server";
import { loadRoom, onRoomEvent, roomEtag, snapshot } from "@/game/engine";
import { roomNow } from "@/game/chronicle";
import { compactSnapshot, deltaCompact, type WireSnapshot } from "@/game/wire";
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

  const compact = req.nextUrl.searchParams.get("c") === "1";
  let feedSince = 0; // per-connection feed cursor: each line crosses the wire once
  let lastEtag = "";
  let lastCompact: WireSnapshot | null = null; // previous frame, for delta encoding
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
        if (etag === lastEtag) return; // nothing meaningful changed — send nothing
        lastEtag = etag;
        if (compact) {
          const frame = compactSnapshot(snap, feedSince);
          feedSince = snap.feed.length ? snap.feed[snap.feed.length - 1].at : feedSince;
          // First frame is whole; afterwards only the keys that actually moved.
          if (lastCompact) send({ etag, delta: deltaCompact(lastCompact, frame) });
          else send({ etag, snap: frame });
          lastCompact = frame;
        } else send({ etag, snap });
      };
      // Room events fire at the 20Hz tick; coalesce pushes to <=10Hz.
      let queued = false;
      const schedule = () => {
        if (queued || closed) return;
        queued = true;
        setTimeout(() => { queued = false; push(); }, 100);
      };
      const unsub = onRoomEvent(code, schedule);
      const hb = setInterval(heartbeat, 15_000);
      const tick = setInterval(push, 100); // time-derived fields between room events
      // The clock is the only thing an idle town owes the client: once a second.
      const clock = setInterval(() => send({ clock: roomNow(room) }), 1000);
      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        clearInterval(tick);
        clearInterval(clock);
        unsub();
        try { controller.close(); } catch { /* already closed */ }
      }
      req.signal.addEventListener("abort", cleanup);
      push(); // initial snapshot immediately
      send({ clock: roomNow(room) });
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
