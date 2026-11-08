// Pure camera and ordering helpers for the Hollow Creek renderer.
//
// The renderer is a retained display list (see ./scene.ts): nodes are built once
// per snapshot and the frame loop only culls, sorts and draws them. This module
// holds the arithmetic that decision needs, so it can be tested without a canvas.
import { WORLD_MAX, WORLD_MIN } from "../buildings";

export const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

/** Where the camera wants to be for a look-at point, clamped to the world. */
export function cameraTarget(lookX: number, w: number, min = WORLD_MIN, max = WORLD_MAX): number {
  if (max - min <= w) return (min + max - w) / 2;
  return clamp(lookX - w / 2, min, max - w);
}

/** Exponential ease toward the target; a tiny dead zone stops idle shimmer. */
export function smoothCamera(current: number, target: number, dt: number, smoothing: boolean): number {
  if (!smoothing) return target;
  const next = current + (target - current) * Math.min(1, Math.max(0, dt) * 6);
  return Math.abs(target - next) < 0.05 ? target : next;
}

export const screenX = (worldX: number, cam: number) => worldX - cam;

/** Least recently used read: a hit is re-inserted so hot entries survive eviction. */
export function lruGet<V>(map: Map<string, V>, key: string): V | undefined {
  const v = map.get(key);
  if (v !== undefined) { map.delete(key); map.set(key, v); }
  return v;
}

/** Least recently used write with a hard capacity. */
export function lruSet<V>(map: Map<string, V>, key: string, value: V, cap: number) {
  map.delete(key);
  while (map.size >= cap) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
  map.set(key, value);
}

/** Visible player order: everyone except the viewer, then the viewer last (on top). */
export function drawOrder<T extends { id: string }>(players: readonly T[], selfId: string): T[] {
  const others: T[] = [];
  let self: T | undefined;
  for (const p of players) {
    if (p.id === selfId) self = p;
    else others.push(p);
  }
  if (self) others.push(self);
  return others;
}

/** Stable x order for props that overlap (cages, notes, bodies). */
export function byDepth<T extends { x: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.x - b.x);
}
