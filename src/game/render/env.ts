// Shared drawing environment: the active settings, the gradient cache and the
// small text-layout caches. One instance is owned by the Renderer and handed
// to every draw function, so none of them need the Renderer itself.
import { createDefaultSettings, type GameSettings } from "../settings";

export class DrawEnv {
  settings: GameSettings = createDefaultSettings();
  readonly grads = new Map<string, CanvasGradient>();
  readonly noteWrap = new Map<string, string[]>();
  readonly bubbleWrap = new Map<string, { lines: string[]; bw: number }>();

  /** Canvas gradients are immutable once built; cache them by the dims that define them. */
  grad(key: string, make: () => CanvasGradient): CanvasGradient {
    let g = lruGet(this.grads, key);
    if (!g) {
      g = make();
      lruSet(this.grads, key, g, 256);
    }
    return g;
  }

  /** Shadow glow, switched off entirely when the glow setting is off. */
  glow(ctx: CanvasRenderingContext2D, blur: number) {
    ctx.shadowBlur = this.settings.graphics.glow ? blur : 0;
  }

  /** Pick a count for the current quality preset. */
  qualityCount(high: number, medium: number, low: number) {
    return this.settings.graphics.quality === "high" ? high : this.settings.graphics.quality === "medium" ? medium : low;
  }
}

/** LRU read: a hit is re-inserted so hot entries survive eviction. */
export function lruGet<V>(map: Map<string, V>, key: string): V | undefined {
  const v = map.get(key);
  if (v !== undefined) { map.delete(key); map.set(key, v); }
  return v;
}

/** LRU write: evicts only the oldest entry when at capacity. */
export function lruSet<V>(map: Map<string, V>, key: string, value: V, cap: number) {
  map.delete(key);
  while (map.size >= cap) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
  map.set(key, value);
}
