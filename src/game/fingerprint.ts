// Cheap, deterministic fingerprint of a snapshot for HTTP 304s.
// `now` (the wall clock) is the only field that changes on an idle town,
// so callers exclude it before hashing.

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Stable ETag for a snapshot-like object, ignoring the `now` clock field. */
export function snapshotEtag<T extends { now: number }>(snap: T): string {
  return `"${fnv1a(JSON.stringify({ ...snap, now: 0 }))}"`;
}
