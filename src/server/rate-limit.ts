// Tiny in-memory token bucket per key. Serverless restarts reset it, which is
// fine — this exists to stop a script hammering create/join, not to be perfect.

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

/** Per-IP key from the request (falls back to a shared bucket behind no proxy headers). */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || "unknown";
  return ip;
}

/**
 * Identity-scoped budget for the game API.
 *
 * A strict bucket is keyed by the explicit playerId the client already sends,
 * so several people sharing one NAT/proxy address (a household, a school, a
 * carrier-grade NAT, or one smoke host running every test player) no longer
 * drain a single tiny budget. A much wider bucket still caps one address that
 * mints unlimited player ids.
 *
 * Without `playerId` the address is used for both buckets, which keeps the old
 * behaviour for anonymous traffic.
 */
export function allowPlayer(
  req: Request,
  scope: string,
  playerId: string | undefined,
  capacity: number,
  windowMs: number,
): boolean {
  const id = (playerId ?? "").slice(0, 64) || clientKey(req);
  const playerOk = allow(`${scope}:player:${id}`, capacity, windowMs);
  // Evaluated even when the player bucket is empty so address bookkeeping
  // stays honest (no short-circuit skew).
  const addressOk = allow(`${scope}:address:${clientKey(req)}`, Math.max(capacity, 1200) * 4, windowMs);
  return playerOk && addressOk;
}
