import { NextRequest } from "next/server";
import { loadRoom, onRoomEvent } from "@/game/engine";
import { FRAME_MS, createViewerCursor, nextFrame, slowDueIn } from "@/game/viewers";
import { admit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** Each connection owns its baseline. Never queue a history of stale frames for a slow socket. */
export async function GET(req: NextRequest) {
  const codeParam = req.nextUrl.searchParams.get("code") ?? "";
  const code = codeParam.length <= 8 ? codeParam.toUpperCase() : "";
  const playerId = (req.nextUrl.searchParams.get("playerId") ?? "").slice(0, 64);
  if (!admit(req, "stream", `${code}:${playerId}`, 30, 300)) return new Response("Slow down.", { status: 429 });
  const room = code ? await loadRoom(code) : undefined;
  if (!room || !room.players.has(playerId)) return new Response("No such town or soul.", { status: 404 });

  const cursor = createViewerCursor(req.nextUrl.searchParams.get("format") === "2");
  const encoder = new TextEncoder();
  let closed = false, dirty = false, queued = false, clockAt = 0;
  let holds: string | null = null;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (closed) return;
    closed = true; clearTimeout(slowTimer); clearTimeout(frameTimer); clearInterval(heartbeat); unsubscribe();
    req.signal.removeEventListener("abort", cleanup);
    try { controller?.close(); } catch { /* consumer already cancelled */ }
  };
  const push = () => {
    queued = false;
    if (closed) return;
    if ((controller.desiredSize ?? 0) <= 0) { dirty = true; return; }
    dirty = false;
    const now = Date.now();
    const result = nextFrame(room, playerId, holds, now, false, cursor, FRAME_MS);
    if (!result) { cleanup(); return; }
    const frame = result.frame ?? (now - clockAt >= 1000 ? { now: result.snapNow } : null);
    if (frame) {
      holds = result.frame?.etag ?? holds;
      clockAt = now;
      try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)); }
      catch { cleanup(); return; }
    }
    const due = slowDueIn(room, playerId, now, cursor);
    if (!slowTimer && due > 0) slowTimer = setTimeout(() => { slowTimer = undefined; push(); }, due);
    // A frame held back by the refresh gate must still go out on the next slot.
    if (result.deferred && !frameTimer) frameTimer = setTimeout(() => { frameTimer = undefined; push(); }, FRAME_MS);
  };
  const requestPush = () => {
    dirty = true;
    if (closed || queued) return;
    queued = true; queueMicrotask(push);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(ctl) {
      controller = ctl;
      unsubscribe = onRoomEvent(code, requestPush);
      heartbeat = setInterval(requestPush, 250);
      req.signal.addEventListener("abort", cleanup, { once: true });
      if (req.signal.aborted) cleanup(); else push();
    },
    pull() { if (dirty) requestPush(); },
    cancel() { cleanup(); },
  }, { highWaterMark: 1 });
  return new Response(stream, { headers: {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-store, no-transform",
    "content-encoding": "identity", connection: "keep-alive", "x-accel-buffering": "no",
  } });
}
