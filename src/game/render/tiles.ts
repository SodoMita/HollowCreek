// Offscreen tile store for baked world layers.
//
// A tile is a canvas holding everything that only changes with the scene, not
// with the camera: street props, house interiors, stations, facades. The
// compositor blits the visible tiles each frame instead of re-issuing hundreds
// of SVG draws. Entries are LRU-evicted by count and by pixel budget, and the
// canvas factory is injected so the policy can be tested without a browser.

export interface TileSurface {
  canvas: { width: number; height: number };
  ctx: CanvasRenderingContext2D;
}

export interface TileStoreStats {
  builds: number;
  hits: number;
  misses: number;
  evictions: number;
  pixels: number;
  entries: number;
}

export interface TileStoreOptions<T extends TileSurface> {
  /** Hard cap on cached entries (the renderer adjusts this per viewport). */
  maxTiles: number;
  /** Hard cap on cached pixels (width × height across every entry). */
  maxPixels: number;
  /** Allocates a surface; the renderer passes a DOM canvas factory. */
  create: (pixelWidth: number, pixelHeight: number) => T;
}

export class TileStore<T extends TileSurface> {
  private readonly entries = new Map<string, { tile: T; pixels: number }>();
  private pixels = 0;
  private builds = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly options: TileStoreOptions<T>) {}

  /** Adjusts the entry cap when the viewport or the bake scale changes. */
  updateLimits(maxTiles: number) {
    this.options.maxTiles = Math.max(2, Math.round(maxTiles));
    this.trimFor(0);
  }

  /** Moves a hit to the most-recently-used position. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) { this.misses++; return undefined; }
    this.hits++;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.tile;
  }

  peek(key: string): T | undefined { return this.entries.get(key)?.tile; }

  /**
   * Returns a painted tile for `key`. `paint` runs at most once per key and is
   * handed a cleared surface at `pixelWidth × pixelHeight`.
   */
  paint(
    key: string,
    width: number,
    height: number,
    render: (tile: T, pixelWidth: number, pixelHeight: number) => void,
  ): T {
    const existing = this.get(key);
    if (existing) return existing;
    const pixelWidth = Math.max(1, Math.round(width));
    const pixelHeight = Math.max(1, Math.round(height));
    const need = pixelWidth * pixelHeight;
    // Prefer a single large tile over evicting everything; only refuse shapes
    // that can never fit the budget.
    if (need > this.options.maxPixels) {
      const scratch = this.options.create(pixelWidth, pixelHeight);
      render(scratch, pixelWidth, pixelHeight);
      return scratch;
    }
    this.trimFor(need);
    const tile = this.options.create(pixelWidth, pixelHeight);
    this.builds++;
    render(tile, pixelWidth, pixelHeight);
    this.entries.set(key, { tile, pixels: need });
    this.pixels += need;
    return tile;
  }

  private trimFor(need: number) {
    while (this.entries.size >= this.options.maxTiles || this.pixels + need > this.options.maxPixels) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const entry = this.entries.get(oldest.value)!;
      this.entries.delete(oldest.value);
      this.pixels -= entry.pixels;
      this.evictions++;
    }
  }

  /** Drops entries whose key prefix no longer matches (quality or viewport change). */
  invalidate(test: (key: string) => boolean) {
    for (const [key, entry] of [...this.entries]) {
      if (!test(key)) continue;
      this.entries.delete(key);
      this.pixels -= entry.pixels;
    }
  }

  clear() {
    this.entries.clear();
    this.pixels = 0;
  }

  get stats(): TileStoreStats {
    return {
      builds: this.builds,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      pixels: this.pixels,
      entries: this.entries.size,
    };
  }
}
