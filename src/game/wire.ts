// Wire format for the state stream, shared by the server routes and both clients.
//
// A viewer receives one full snapshot, then frames that carry only what changed:
//   delta  — changed top-level fields, as full values
//   patch  — for the id-keyed arrays (players, tasks, doors): the changed
//            fields of each changed item, as {id, ...fields}; for `self`: its
//            changed fields. The client merges them in place. A membership or
//            order change resends the whole list in `delta` instead.
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
  now: number;
  snap?: Snapshot;
  delta?: Partial<Record<keyof Snapshot, unknown>>;
  patch?: {
    // Items carry a roster slot (i) instead of an id: same information, ~34 bytes less
    // per changed entity, and the order is stable while patches are sent.
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

/** What a viewer holds, pre-serialised per field so each diff only stringifies the new side. */
export interface EncodedView {
  etag: string;
  snap: Snapshot;
  top: Record<string, string>;
  self: Record<string, string>;
  items: Record<IdArrayKey, Map<string, string>>;
  order: Record<IdArrayKey, string>;
}

const j = (v: unknown) => JSON.stringify(v ?? null);

export function encodeView(snap: Snapshot, etag: string): EncodedView {
  const top: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (k === "now" || k === "self" || (ID_ARRAYS as readonly string[]).includes(k)) continue;
    top[k] = j(v);
  }
  const self: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.self)) self[k] = j(v);
  const items = {} as Record<IdArrayKey, Map<string, string>>;
  const order = {} as Record<IdArrayKey, string>;
  for (const key of ID_ARRAYS) {
    const list = (snap[key] ?? []) as { id: string }[];
    items[key] = new Map(list.map((it) => [it.id, j(it)]));
    order[key] = list.map((it) => it.id).join("\u0001");
  }
  return { etag, snap, top, self, items, order };
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
  const snap = next.snap as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(prev.top), ...Object.keys(next.top)])) {
    if (prev.top[k] === next.top[k]) continue;
    delta[k as keyof Snapshot] = snap[k] ?? null;
    any = true;
    if (!SLOW_TOP.has(k)) fast = true;
  }
  const selfChanged = Object.keys(next.self).filter((k) => prev.self[k] !== next.self[k]);
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
    // Same members: send each changed item as {id, ...changedFields} only.
    const partials: WireItem[] = [];
    const list = (snap[key] ?? []) as Record<string, unknown>[];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const prevJson = prev.items[key].get(it.id as string);
      if (prevJson === next.items[key].get(it.id as string)) continue;
      const before = JSON.parse(prevJson!) as Record<string, unknown>;
      const part: WireItem = { i };
      for (const f of new Set([...Object.keys(before), ...Object.keys(it)])) {
        if (f === "id" || j(it[f]) === j(before[f])) continue;
        part[f] = it[f] === undefined ? null : it[f];
        if (key !== "tasks" || !SLOW_TASK.has(f)) fast = true; // a ward's bare progress figure can wait for the slow beat
      }
      partials.push(part);
    }
    if (!partials.length) continue;
    any = true;
    (patch as Record<string, unknown>)[key] = partials;
  }
  return { any, fast, delta, patch };
}

/** Merge a frame into the snapshot the client holds. Returns null when a delta arrives before any full frame. */
export function applyFrame(held: Snapshot | null, frame: WireFrame): Snapshot | null {
  if (frame.snap) return frame.snap;
  if (!held) return null;
  const next = { ...held, now: frame.now } as Snapshot & Record<string, unknown>;
  // Nulls stay nulls: consumers test `keyX !== null`, `winner === "hollow"` and
  // the like; the only optional field that can be absent (`time`) is read with `?.`.
  if (frame.delta) for (const [k, v] of Object.entries(frame.delta)) next[k] = v;
  if (frame.patch) {
    if (frame.patch.self) next.self = { ...held.self, ...frame.patch.self };
    for (const key of ID_ARRAYS) {
      const items = frame.patch[key] as WireItem[] | undefined;
      if (!items) continue;
      const bySlot = new Map(items.map((it) => [it.i, it as Record<string, unknown>]));
      (next as Record<string, unknown>)[key] = ((next[key] ?? []) as unknown as Record<string, unknown>[]).map((it, slot) => {
        const part = bySlot.get(slot);
        if (!part) return it;
        const merged = { ...it, ...part };
        delete merged.i;
        return merged;
      });
    }
  }
  return next as Snapshot;
}

/** True when a frame carried positions, so clients can timestamp their prediction baseline. */
export function frameTouchesPlayers(frame: WireFrame): boolean {
  return !!frame.snap || !!frame.patch?.players || frame.delta?.players !== undefined;
}
