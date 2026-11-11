// Wire format for the state stream, shared by the server routes and both clients.
//
// A viewer receives one full snapshot, then frames that carry only what changed:
//   delta  — changed top-level fields, as full values
//   patch  — for the id-keyed arrays (players, tasks, doors): the changed
//            fields of each changed item, as {i, ...fields} (slot index); for
//            `self`: its changed fields. The client merges them in place. A
//            membership or order change resends the whole list in `delta`.
//   now    — the room clock, always present (a frame with nothing else is a tick)
//
// Fields are also classed fast or slow. Slow values (vigor, cooldowns, the
// night's progress, dread, ward progress, the recorded-time range) drift every
// tick but are only *shown* coarsely, so the server holds them back and sends
// them at most once per second — unless a fast change ships in the same frame.
import type { Snapshot } from "./types";

export interface WireItem extends Record<string, unknown> { i: number }

export interface WireFrame {
  etag?: string;
  /** Per-connection monotonic frame number: a gap means frames were lost in transit. */
  n?: number;
  /** Deltas are valid only on this exact baseline. */
  base?: string;
  now: number;
  snap?: Snapshot;
  /** Exact server values, compact protocol v2: [roster slot, integer x, precise x, gait pose]. */
  motion?: [number, number, number, number][];
  cartMotion?: [number, number];
  delta?: Partial<Record<keyof Snapshot, unknown>>;
  patch?: {
    players?: WireItem[];
    tasks?: WireItem[];
    doors?: WireItem[];
    self?: Partial<Snapshot["self"]>;
  };
  gone?: boolean;
}

export const ID_ARRAYS = ["players", "tasks", "doors"] as const;
type IdArrayKey = (typeof ID_ARRAYS)[number];
const SLOW_TOP = new Set<string>(["nightT", "time", "danger", "hint"]);
const SLOW_SELF = new Set<string>(["stamina", "killCooldownMs", "blackoutCooldownMs", "sabotageCooldownMs"]);
const SLOW_TASK = new Set<string>(["progress"]);

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
function fnv(h: number, text: string): number {
  let hash = h;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** What a viewer holds, pre-serialised per field/item so diffs avoid redundant parses. */
export interface EncodedView {
  etag: string;
  snap: Snapshot;
  top: Record<string, string>;
  self: Record<string, string>;
  items: Record<IdArrayKey, Map<string, string>>;
  order: Record<IdArrayKey, string>;
}

const j = (v: unknown) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
};

export function encodeView(snap: Snapshot, etag = ""): EncodedView {
  const top: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined || k === "now" || k === "self" || k === "players" || k === "tasks" || k === "doors") continue;
    top[k] = j(v);
  }
  const self: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.self)) {
    if (v !== undefined) self[k] = j(v);
  }
  const items = {} as Record<IdArrayKey, Map<string, string>>;
  const order = {} as Record<IdArrayKey, string>;
  for (const key of ID_ARRAYS) {
    const list = (snap[key] ?? []) as unknown as { id: string }[];
    const map = new Map<string, string>();
    const ids: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      ids.push(it.id);
      map.set(it.id, JSON.stringify(it));
    }
    items[key] = map;
    order[key] = ids.join("\u0001");
  }
  const view: EncodedView = { etag, snap, top, self, items, order };
  if (!etag) view.etag = viewFingerprint(view);
  return view;
}

/** Single-pass FNV-1a revision over the already-encoded field strings (excludes `now`). */
export function viewFingerprint(v: EncodedView): string {
  let h = FNV_OFFSET;
  for (const k of Object.keys(v.top).sort()) { h = fnv(h, k); h = fnv(h, v.top[k]); }
  for (const k of Object.keys(v.self).sort()) { h = fnv(h, k); h = fnv(h, v.self[k]); }
  for (const key of ID_ARRAYS) {
    h = fnv(h, v.order[key]);
    for (const val of v.items[key].values()) h = fnv(h, val);
  }
  return `"${h.toString(36)}"`;
}

export interface ViewDiff {
  any: boolean;
  fast: boolean;
  delta: NonNullable<WireFrame["delta"]>;
  patch: NonNullable<WireFrame["patch"]>;
}

/** Everything in `next` that differs from what the viewer holds, and whether any of it is fast. */
export function diffView(prev: EncodedView, next: EncodedView): ViewDiff {
  const delta: NonNullable<WireFrame["delta"]> = {};
  const patch: NonNullable<WireFrame["patch"]> = {};
  let any = false;
  let fast = false;
  const prevSnap = prev.snap as unknown as Record<string, unknown>;
  const snap = next.snap as unknown as Record<string, unknown>;
  for (const k in next.top) {
    if (prev.top[k] === next.top[k]) continue;
    delta[k as keyof Snapshot] = snap[k] ?? null;
    any = true;
    if (!SLOW_TOP.has(k)) fast = true;
  }
  for (const k in prev.top) {
    if (k in next.top) continue;
    delta[k as keyof Snapshot] = null;
    any = true;
    if (!SLOW_TOP.has(k)) fast = true;
  }
  const selfChanged: string[] = [];
  for (const k in next.self) {
    if (prev.self[k] !== next.self[k]) selfChanged.push(k);
  }
  if (selfChanged.length) {
    any = true;
    if (selfChanged.some((k) => !SLOW_SELF.has(k))) fast = true;
    const s = next.snap.self as unknown as Record<string, unknown>;
    patch.self = Object.fromEntries(selfChanged.map((k) => [k, s[k]])) as Partial<Snapshot["self"]>;
  }
  for (const key of ID_ARRAYS) {
    if (prev.order[key] !== next.order[key]) {
      delta[key] = snap[key] ?? null; // membership or order changed: resend the list
      any = true;
      fast = true;
      continue;
    }
    const prevList = (prevSnap[key] ?? []) as unknown as Record<string, unknown>[];
    const list = (snap[key] ?? []) as unknown as Record<string, unknown>[];
    const partials: WireItem[] = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const id = it.id as string;
      if (prev.items[key].get(id) === next.items[key].get(id)) continue;
      // Compare directly against prev.snap[key][i] (same order guaranteed above) -> zero JSON.parse!
      const before = prevList[i];
      const part: WireItem = { i };
      for (const f in it) {
        if (f === "id") continue;
        const av = it[f], bv = before[f];
        if (av === bv) continue;
        if (av && bv && typeof av === "object" && typeof bv === "object" && j(av) === j(bv)) continue;
        part[f] = av === undefined ? null : av;
        if (key !== "tasks" || !SLOW_TASK.has(f)) fast = true;
      }
      for (const f in before) {
        if (f !== "id" && !(f in it)) {
          part[f] = null;
          if (key !== "tasks" || !SLOW_TASK.has(f)) fast = true;
        }
      }
      partials.push(part);
    }
    if (!partials.length) continue;
    any = true;
    (patch as Record<string, unknown>)[key] = partials;
  }
  return { any, fast, delta, patch };
}

/** Lossless wire compaction only; no movement is inferred or calculated on the client. */
export function compactMotion(frame: WireFrame, snap: Snapshot): void {
  if (frame.snap || frame.delta?.players) return;
  if (frame.patch?.players) {
    const remainder: WireItem[] = [];
    const motion: NonNullable<WireFrame["motion"]> = [];
    for (const part of frame.patch.players) {
      const p = snap.players[part.i];
      if (p && (part.x !== undefined || part.drawX !== undefined || part.walkFrame !== undefined)) {
        motion.push([part.i, p.x, p.drawX ?? p.x, p.walkFrame ?? 0]);
        const rest = { ...part }; delete rest.x; delete rest.drawX; delete rest.walkFrame;
        if (Object.keys(rest).length > 1) remainder.push(rest);
      } else remainder.push(part);
    }
    if (motion.length) frame.motion = motion;
    if (remainder.length) frame.patch.players = remainder;
    else delete frame.patch.players;
    if (!Object.keys(frame.patch).length) delete frame.patch;
  }
  if (frame.delta && (frame.delta.cartX !== undefined || frame.delta.cartDrawX !== undefined)) {
    frame.cartMotion = [snap.cartX, snap.cartDrawX ?? snap.cartX];
    delete frame.delta.cartX; delete frame.delta.cartDrawX;
    if (!Object.keys(frame.delta).length) delete frame.delta;
  }
}

/** Merge a frame into the snapshot the client holds. Returns null when a delta arrives before any full frame. */
export function applyFrame(held: Snapshot | null, frame: WireFrame, holdsEtag?: string): Snapshot | null {
  if (frame.snap) return frame.snap;
  if (!held || (frame.base !== undefined && holdsEtag !== undefined && frame.base !== holdsEtag)) return null;
  const next = { ...held, now: frame.now } as Snapshot & Record<string, unknown>;
  if (frame.delta) for (const [k, v] of Object.entries(frame.delta)) next[k] = v;
  if (frame.patch) {
    if (frame.patch.self) next.self = { ...held.self, ...frame.patch.self };
    for (const key of ID_ARRAYS) {
      const items = frame.patch[key] as WireItem[] | undefined;
      if (!items) continue;
      const list = ((next[key] ?? []) as unknown as Record<string, unknown>[]).slice();
      for (const part of items) {
        const idx = part.i;
        if (idx >= 0 && idx < list.length) {
          const merged: Record<string, unknown> = { ...list[idx], ...part };
          delete merged.i;
          list[idx] = merged;
        }
      }
      (next as Record<string, unknown>)[key] = list;
    }
  }
  if (frame.motion) {
    const list = next.players.slice();
    for (const [i, x, drawX, walkFrame] of frame.motion) {
      if (list[i]) list[i] = { ...list[i], x, drawX, walkFrame };
    }
    next.players = list;
  }
  if (frame.cartMotion) {
    next.cartX = frame.cartMotion[0]; next.cartDrawX = frame.cartMotion[1];
  }
  return next as Snapshot;
}

/** True when a frame carried positions, for raw arrival-cadence diagnostics. */
export function frameTouchesPlayers(frame: WireFrame): boolean {
  return !!frame.snap || !!frame.motion || !!frame.patch?.players || frame.delta?.players !== undefined;
}
