// The renderer's display list.
//
// Every visible thing is a node: a bounded world position, a depth band and one
// draw function. A snapshot builds the list once; each frame only walks it,
// skipping nodes outside the viewport and drawing the rest in band order. There
// is no per-object special case: the compositor knows nothing about trees,
// houses or souls, and adding an object is one `scene.add()`.
//
// Pure except for the draw callbacks, which are never invoked here.
import type { Frame } from "./frame";

/** Depth bands, back to front. The order of this array is the draw order. */
export const BANDS = [
  "sky", "horizon", "ground", "groundProps", "creek", "square",
  "interior", "station", "bell", "cageBack", "overlay",
  "insideBody", "insideActor", "facade",
  "outsideBody", "cagedActor", "cageFront", "outsideActor",
  "weather", "foreground", "mask",
] as const;

export type Band = (typeof BANDS)[number];
const BAND_INDEX: Record<Band, number> = Object.fromEntries(BANDS.map((band, i) => [band, i])) as Record<Band, number>;

export interface SceneNode {
  band: Band;
  /** World x of the node's centre. Screen-space nodes ignore it. */
  x: number;
  /** Half-width of influence; a node is drawn while it is this close to the view. */
  span: number;
  /** Screen-space layers (sky, masks) are never culled. */
  screen?: boolean;
  draw: (f: Frame) => void;
  /** Optional debug label; the perf readout groups by band, not by label. */
  label?: string;
}

export interface SceneStats {
  nodes: number;
  visible: number;
  byBand: Partial<Record<Band, number>>;
}

export class Scene {
  private nodes: SceneNode[] = [];
  /** Reused array: culling must not allocate on a 60 fps path. */
  private readonly view: SceneNode[] = [];

  clear() { this.nodes = []; }

  add(node: SceneNode): this {
    this.nodes.push(node);
    return this;
  }

  get size() { return this.nodes.length; }

  /**
   * Nodes to draw this frame, back to front. Culling compares each node's
   * influence against the viewport; sorting is by band, then by x so overlapping
   * props keep a stable order, then by insertion for exact ties.
   */
  visible(cam: number, w: number): readonly SceneNode[] {
    const left = cam - (this.nodes.length ? 0 : 0);
    const right = cam + w;
    const out = this.view;
    out.length = 0;
    for (const node of this.nodes) {
      if (node.screen || (node.x + node.span >= left && node.x - node.span <= right)) out.push(node);
    }
    out.sort((a, b) => {
      const band = BAND_INDEX[a.band] - BAND_INDEX[b.band];
      return band !== 0 ? band : a.x - b.x;
    });
    return out;
  }

  stats(cam: number, w: number): SceneStats {
    const visible = this.visible(cam, w);
    const byBand: Partial<Record<Band, number>> = {};
    for (const node of this.nodes) byBand[node.band] = (byBand[node.band] ?? 0) + 1;
    return { nodes: this.nodes.length, visible: visible.length, byBand };
  }
}

/** Builds nodes in bulk; keeps call sites short and hard to mis-order. */
export function nodesOf(
  band: Band,
  items: readonly { x: number; span: number; draw: (f: Frame) => void; screen?: boolean; label?: string }[],
): SceneNode[] {
  return items.map((item) => ({ band, ...item }));
}
