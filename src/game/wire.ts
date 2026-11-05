// Compact wire format for the 10Hz state stream. The full Snapshot stays the
// internal contract; on the wire we drop everything the client can reconstruct
// (station names/positions, building ids, repeated feed lines, far note text)
// so a poll costs a few hundred bytes instead of several kilobytes.
import { BUILDINGS } from "./buildings";
import { STATIONS, type Snapshot } from "./types";

export type WireSnapshot = Omit<Snapshot, "tasks" | "doors" | "feed" | "notes" | "cages"> & {
  /** [station index, done, delivered, sabotaged, progress %] */
  tk: [number, number, number, number, number][];
  /** [building index, locked|open flags, keyX] — holder is server-only */
  dr: [number, number, number | null][];
  /** only feed lines newer than the client's cursor */
  fd: { text: string; at: number }[];
  /** note text is sent only within reading range; the client caches the rest */
  nt: { id: string; x: number; kind: "wall" | "tree"; house: string | null; author: string; text: string }[];
  /** [x, occupant id during meetings, else 1/null] */
  cg: [number, string | number | null][];
};

const stationIndex = new Map(STATIONS.map((s, i) => [s.id, i]));
const buildingIndex = new Map(BUILDINGS.map((b, i) => [b.id, i]));

export function compactSnapshot(snap: Snapshot, feedSince: number): WireSnapshot {
  const meX = snap.players.find((p) => p.id === snap.self.id)?.x ?? 0;
  const { tasks, doors, feed, notes, cages, ...rest } = snap;
  return {
    ...rest,
    tk: tasks.map((t) => [stationIndex.get(t.id) ?? 0, t.done ? 1 : 0, t.delivered ? 1 : 0, t.sabotaged ? 1 : 0, Math.round(t.progress * 100)]),
    dr: (doors ?? []).map((d) => [buildingIndex.get(d.id) ?? 0, (d.locked ? 1 : 0) | (d.open ? 2 : 0), d.keyX]),
    fd: feed.filter((f) => f.at > feedSince),
    nt: (notes ?? []).map((n) => ({ id: n.id, x: n.x, kind: n.kind, house: n.house, author: n.author, text: Math.abs(n.x - meX) <= 170 ? n.text : "" })),
    cg: cages.map((c) => [c.x, snap.phase === "meeting" ? c.occupant : c.occupant ? 1 : null]),
  };
}

export interface WireCache {
  feed: { text: string; at: number }[];
  noteText: Map<string, string>;
}
export const newWireCache = (): WireCache => ({ feed: [], noteText: new Map() });

export function expandSnapshot(wire: WireSnapshot, cache: WireCache): Snapshot {
  if (wire.fd.length) {
    const seen = new Set(cache.feed.map((f) => f.at + "\u0000" + f.text));
    for (const f of wire.fd) if (!seen.has(f.at + "\u0000" + f.text)) cache.feed.push(f);
    cache.feed.sort((a, b) => a.at - b.at);
    if (cache.feed.length > 8) cache.feed = cache.feed.slice(-8);
  }
  for (const n of wire.nt) if (n.text) cache.noteText.set(n.id, n.text);
  if (cache.noteText.size > 128) cache.noteText.clear();
  const { tk, dr, fd, nt, cg, ...rest } = wire;
  void fd;
  return {
    ...rest,
    tasks: tk.map(([i, done, delivered, sabotaged, progress]) => {
      const st = STATIONS[i];
      return { id: st.id, name: st.name, x: st.x, inside: st.inside, done: !!done, delivered: !!delivered, sabotaged: !!sabotaged, progress: progress / 100 };
    }),
    doors: dr.map(([i, flags, keyX]) => ({ id: BUILDINGS[i].id, locked: !!(flags & 1), open: !!(flags & 2), keyX, holder: null })),
    feed: [...cache.feed],
    notes: nt.map((n) => ({ ...n, text: n.text || cache.noteText.get(n.id) || "" })),
    cages: cg.map(([x, occupant]) => ({ x, occupant: typeof occupant === "string" ? occupant : null })),
  };
}

/** The newest feed timestamp a client holds — its cursor for the next request. */
export const feedCursor = (cache: WireCache): number => cache.feed.length ? cache.feed[cache.feed.length - 1].at : 0;
