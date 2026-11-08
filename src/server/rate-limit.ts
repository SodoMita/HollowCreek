// Tiny in-memory token bucket per key. Serverless restarts reset it, which is
// fine — this exists to stop a script hammering create/join, not to be perfect.
//
// Game traffic is limited per SOUL (player) first, with a generous per-IP
// backstop. Many real players share one address (a household, a school, a
// carrier NAT, or a proxy that forwards no client IP), so a per-IP-only limit
// would throttle innocent people for each other's polling.

interface Bucket { tokens: number; resetAt: number }
const buckets = new Map<string, Bucket>();
const SWEEP_EVERY = 500;
let seen = 0;

function sweep(now: number) {
  if (++seen % SWEEP_EVERY !== 0) return;
  for (const [key, b] of buckets) {
    if (now > b.resetAt + 60_000) buckets.delete(key);
  }
}

/** @returns true when the request is allowed */
export function allow(key: string, capacity: number, refillMs: number): boolean {
  const now = Date.now();
  sweep(now);
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { tokens: capacity - 1, resetAt: now + refillMs };
    buckets.set(key, b);
    return true;
  }
  if (b.tokens > 0) {
    b.tokens -= 1;
    return true;
  }
  return false;
}

/** Per-IP key from the request. "unknown" means no proxy header was forwarded. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || "unknown";
  return ip;
}

/**
 * Admit a game request: the soul's own bucket (`perSoul` per minute) and the
 * address bucket (`perIp` per minute). Without a forwarded address every
 * request shares "unknown", so that bucket gets ten times the room — enough
 * for a whole town, while still bounding a flood.
 */
export function admit(req: Request, scope: string, soul: string, perSoul: number, perIp: number, refillMs = 60_000): boolean {
  const ip = clientKey(req);
  const ipCapacity = ip === "unknown" ? perIp * 10 : perIp;
  if (soul && !allow(`${scope}:soul:${soul.slice(0, 96)}`, perSoul, refillMs)) return false;
  return allow(`${scope}:ip:${ip}`, ipCapacity, refillMs);
}
