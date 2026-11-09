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

export interface WireFrame {
  etag?: string;
  now: number;
  snap?: Snapshot;
  delta?: Partial<Record<keyof Snapshot, unknown>>;
  patch?: {
    players?: Snapshot["players"];
    tasks?: Snapshot["tasks"];
    doors?: NonNullable<Snapshot["doors"]>;
    self?: Partial<Snapshot["self"]>;
  };
  gone?: boolean;
}

export const ID_ARRAYS = ["players", "tasks", "doors"] as const;
type IdArrayKey = (typeof ID_ARRAYS)[number];
const SLOW_TOP = new Set<string>(["nightT", "time", "danger"]);
const SLOW_SELF = new Set<string>(["stamina", "killCooldownMs", "blackoutCooldownMs", "sabotageCooldownMs"]);
const SLOW_TASK = new Set<string>(["progress"]);

/** What a viewer holds, pre-serialised per field so each diff only stringifies the new side. */
export interface EncodedView {
  etag: string;
  snap: Snapshot;
  top: Record<string, string>;
  self: Record<string, string>;
  items: Record<IdArrayKey, Map<string, string>>;
  objs: Record<IdArrayKey, Map<string, Record<string, unknown>>>;
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
  const objs = {} as Record<IdArrayKey, Map<string, Record<string, unknown>>>;
  const order = {} as Record<IdArrayKey, string>;
  for (const key of ID_ARRAYS) {
    const list = (snap[key] ?? []) as { id: string }[];
    items[key] = new Map(list.map((it) => [it.id, j(it)]));
    objs[key] = new Map(list.map((it) => [it.id, it as unknown as Record<string, unknown>]));
    order[key] = list.map((it) => it.id).join("\u0001");
  }
  return { etag, snap, top, self, items, objs, order };
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
    // Same members: send each changed item as {i, ...changedFields} only, where
    // `i` is the item's index in this array. Order is verified two lines above,
    // so an index identifies the same item on both sides and costs one byte
    // instead of a 36-character UUID on every changed entity in every frame.
    // Membership or order changes take the `delta` branch and resend the list.
    const partials: Record<string, unknown>[] = [];
    const list = (snap[key] ?? []) as Record<string, unknown>[];
    for (let index = 0; index < list.length; index++) {
      const it = list[index];
      const id = it.id as string;
      const prevJson = prev.items[key].get(id);
      if (prevJson === next.items[key].get(id)) continue;
      const before = prev.objs[key].get(id) ?? (JSON.parse(prevJson!) as Record<string, unknown>);
      const part: Record<string, unknown> = { i: index };
      for (const f of Object.keys(it)) {
        if (f === "id") continue;
        const nv = it[f], ov = before[f];
        if (nv === ov || (nv == null && ov == null) || (typeof nv === "object" && typeof ov === "object" && nv !== null && ov !== null && j(nv) === j(ov))) continue;
        part[f] = nv === undefined ? null : nv;
        if (key !== "tasks" || !SLOW_TASK.has(f)) fast = true; // a ward's bare progress figure can wait for the slow beat
      }
      for (const f of Object.keys(before)) {
        if (f === "id" || f in it) continue;
        part[f] = null;
        if (key !== "tasks" || !SLOW_TASK.has(f)) fast = true;
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
      const items = frame.patch[key] as { id?: string; i?: number }[] | undefined;
      if (!items || !items.length) continue;
      // Patches address items by array index (`i`); older servers may still send
      // `id`. Mutate only a shallow-copied array at the patched indices so 120 Hz
      // frames allocate almost nothing.
      const curList = ((next[key] ?? []) as { id: string }[]).slice();
      for (const part of items) {
        let idx = typeof part.i === "number" ? part.i : -1;
        if (idx < 0 && part.id) idx = curList.findIndex((it) => it.id === part.id);
        if (idx >= 0 && idx < curList.length) {
          const merged = { ...curList[idx] } as Record<string, unknown>;
          for (const [fk, fv] of Object.entries(part)) {
            if (fk !== "i") merged[fk] = fv;
          }
          curList[idx] = merged as { id: string };
        }
      }
      (next as Record<string, unknown>)[key] = curList;
    }
  }
  return next as Snapshot;
}

/** True when a frame carried positions, so clients can timestamp their prediction baseline. */
export function frameTouchesPlayers(frame: WireFrame): boolean {
  return !!frame.snap || !!frame.patch?.players || frame.delta?.players !== undefined;
}
