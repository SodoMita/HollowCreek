// Pure planning for the rewritten renderer: camera easing, world-tile maths and
// the cache keys that decide when a baked tile is still valid.
//
// Nothing here touches a canvas, which is why the renderer's decisions can be
// unit-tested without a browser. The compositor (render/index.ts) only executes
// this plan.
import type { Snapshot } from "../types";
import { WORLD_MAX, WORLD_MIN } from "../buildings";

/** Width of one cached world tile, in world units. Small enough that a walking
 *  camera keeps most of its tiles, big enough that a screen holds 2–4. */
export const TILE_W = 1024;
/** Single-letter prefix per tile layer, so one store can hold both. */
export const LAYER_BACKDROP = "b";
export const LAYER_FACADE = "f";

export const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

/** Buckets keep caches small: the night gradient only ever shows 0.1 steps. */
export const nightBucket = (night: number) => Math.round(clamp(night, 0, 1) * 10) / 10;
/** Device scale quantised to 0.25, so a pinch zoom rebuilds tiles a few times, not per pixel. */
export const scaleBucket = (scale: number) => Math.round(clamp(scale, 0.5, 2) * 4) / 4;
/** Door swing and lantern flicker are baked; both step coarsely on purpose. */
export const swingBucket = (amount: number) => Math.round(clamp(amount, 0, 1) * 20) / 20;
export const flickerBucket = (t: number) => Math.floor(t * 2);

export interface CameraView {
  /** Smoothed camera x. */
  x: number;
  /** Viewport width in world units (after zoom). */
  w: number;
  /** Clamp the world's ends so the camera never shows the void. */
  min?: number;
  max?: number;
}

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

export interface TileRange { first: number; last: number; count: number }

/** Tile indices covering the viewport plus one tile of slack on each side. */
export function tileRange(cam: number, w: number, tileW = TILE_W, slack = 1): TileRange {
  const first = Math.floor(cam / tileW) - slack;
  const last = Math.floor((cam + Math.max(0, w)) / tileW) + slack;
  return { first, last, count: Math.max(0, last - first + 1) };
}

export const tileStart = (index: number, tileW = TILE_W) => index * tileW;

/** Does a world rect [x, x+width) touch this tile? Used to skip empty tiles. */
export function tileTouches(index: number, x: number, width: number, tileW = TILE_W): boolean {
  const from = index * tileW;
  return x + width > from && x < from + tileW;
}

export interface BuildingView { id: string; x: number; width: number }
export interface StationView { id: string; x: number; inside?: boolean; progress: number; done: boolean; delivered: boolean }
export interface DoorView { id: string; open: boolean; locked: boolean }

export interface SceneFacts {
  /** Occupied house ids, sorted: interiors and facades change when someone enters. */
  occupied: string;
  /** Station states that alter their art. */
  stations: string;
  /** House doors state (facade art shows a swung door). */
  doors: string;
}

/**
 * Facts that change baked art, computed once per snapshot rather than per tile
 * or per frame. Kept as compact strings so they can be cached by identity.
 */
export function sceneFacts(snap: Snapshot, buildings: BuildingView[]): SceneFacts {
  const inside = new Set<string>();
  for (const p of snap.players) if (p.inside && p.alive) inside.add(p.inside);
  const occupied = buildings.filter((b) => inside.has(b.id)).map((b) => b.id).join(",");
  const stations = snap.tasks
    .map((t) => `${t.id}:${t.done ? 1 : t.delivered ? 2 : 0}:${Math.round(t.progress * 20)}:${t.sabotaged ? 1 : 0}`)
    .sort()
    .join("|");
  const doors = (snap.doors ?? []).map((d) => `${d.id}:${d.open ? 1 : 0}${d.locked ? "L" : ""}`).sort().join("|");
  return { occupied, stations, doors };
}

export type CachedLayer = "backdrop" | "facade";

export interface TileKeyInput {
  layer: CachedLayer;
  index: number;
  tileW?: number;
  /** Viewport height in world units. */
  h: number;
  night: number;
  quality: string;
  scale: number;
  facts: SceneFacts;
  /** Door swing / flicker phase, only for the facade layer. */
  phase?: number;
}

/**
 * The identity of a baked tile. Two frames with the same key may share pixels;
 * anything that changes the painted result is in here. Data that this layer
 * never draws (for example a station's progress in the backdrop layer when the
 * station sits in another tile) is still included — a cache miss is cheap, a
 * stale frame is not.
 */
export function tileKey(input: TileKeyInput): string {
  const prefix = input.layer === "facade" ? LAYER_FACADE : LAYER_BACKDROP;
  const width = input.tileW ?? TILE_W;
  const phase = input.layer === "facade" ? `:${swingBucket(input.phase ?? 0)}` : "";
  return `${prefix}${input.index}:${width}:${Math.round(input.h)}:${nightBucket(input.night)}:${input.quality}:${scaleBucket(input.scale)}${phase}:${input.facts.occupied}:${input.facts.stations}:${input.facts.doors}`;
}

/** How many tiles a screen at this scale may cache: two screens' worth, floor 6. */
export function tileBudget(w: number, h: number, scale: number, tileW = TILE_W): number {
  const perScreen = Math.ceil(w / tileW) + 3;
  const pixels = Math.max(1, Math.round(tileW * scale) * Math.round(h * scale));
  const byBytes = Math.floor((96 * 1024 * 1024) / pixels);
  return clamp(Math.min(byBytes, Math.max(perScreen, Math.ceil(perScreen * 1.5))), 6, 40);
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

/** Depth-sorted props by screen x, so overlapping sprites keep a stable order. */
export function byDepth<T extends { x: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.x - b.x);
}
