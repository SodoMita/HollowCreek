// Test-only ordered HTTP/SSE link. One queue/timer per response; seeded jitter,
// explicit close cleanup, optional bandwidth limit and one forced SSE disconnect.
import http from "node:http";
import https from "node:https";

export async function latencyProxy(target, { delayMs = 0, jitterMs = 0, seed = 42, bytesPerSec = Infinity, disconnectAfterMs = 0, blockSse = false } = {}) {
  const url = new URL(target);
  let rng = seed >>> 0;
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const delay = () => Math.max(0, delayMs + (random() * 2 - 1) * jitterMs);
  const sockets = new Set();
  let severed = false;
  const stats = { requests: 0, inputRequests: 0, activeStreams: 0, maxActiveStreams: 0, bytes: 0, apiBytes: 0 };
  const agent = url.protocol === "https:" ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true });
  const server = http.createServer((req, res) => {
    stats.requests++;
    if (blockSse && req.url?.includes("/state/stream")) { res.writeHead(503).end("SSE blocked by test"); return; }
    if (req.url?.includes("/input")) stats.inputRequests++;
    const isApi = req.url?.startsWith("/api/");
    const isStream = req.url?.includes("/state/stream");
    const chunks = [];
    const queue = [];
    const timers = new Set();
    let upstream;
    let reader;
    let closed = false, ended = false, sending = false, tail = 0;
    const later = (fn, ms) => {
      const timer = setTimeout(() => { timers.delete(timer); if (!closed) fn(); }, Math.max(0, ms));
      timers.add(timer);
    };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      queue.length = 0;
      if (isStream && reader) stats.activeStreams--;
      reader?.destroy();
      upstream?.destroy();
    };
    res.once("close", cleanup);
    req.once("aborted", cleanup);
    req.on("data", (chunk) => chunks.push(chunk));
    const pump = () => {
      if (sending || closed) return;
      if (!queue.length) { if (ended) res.end(); return; }
      sending = true;
      later(() => {
        sending = false;
        const item = queue.shift();
        if (!item) return;
        stats.bytes += item.chunk.length;
        if (isApi) stats.apiBytes += item.chunk.length;
        if (queue.length < 256) reader?.resume();
        if (res.write(item.chunk)) pump();
        else res.once("drain", pump);
      }, queue[0].at - performance.now());
    };
    req.on("end", () => {
      later(() => {
        const transport = url.protocol === "https:" ? https : http;
        const headers = { ...req.headers, host: url.host, "accept-encoding": "identity" };
        delete headers.connection;
        upstream = transport.request(new URL(req.url, url), { method: req.method, headers, agent }, (up) => {
          reader = up;
          if (isStream) {
            stats.activeStreams++;
            stats.maxActiveStreams = Math.max(stats.maxActiveStreams, stats.activeStreams);
          }
          res.writeHead(up.statusCode ?? 502, { ...up.headers, "cache-control": "no-store" });
          if (isStream) res.flushHeaders();
          if (isStream && disconnectAfterMs > 0 && !severed) {
            severed = true;
            later(() => res.destroy(), disconnectAfterMs);
          }
          up.on("data", (chunk) => {
            const now = performance.now();
            // A later byte may never overtake an earlier byte on the same TCP connection.
            const cost = Number.isFinite(bytesPerSec) ? chunk.length * 1000 / bytesPerSec : 0;
            tail = Math.max(tail, now + (isApi ? delay() : 0)) + cost;
            queue.push({ chunk, at: tail });
            if (queue.length > 512) up.pause();
            pump();
          });
          res.on("drain", () => { if (queue.length < 256) up.resume(); });
          up.on("end", () => { ended = true; pump(); });
          up.on("error", () => res.destroy());
        });
        upstream.on("error", () => { if (!closed) { res.statusCode = 502; res.end(); } });
        upstream.end(Buffer.concat(chunks));
      }, isApi ? delay() : 0);
    });
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`, stats,
    async close() { for (const socket of sockets) socket.destroy(); agent.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}
