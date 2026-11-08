// Browser-side art loader. Art lives as editable SVG files in public/art.
//
// Each SVG is fetched once. spriteFor() rasterises it into an offscreen canvas
// once per (path, pixel size), so every frame copies bitmaps instead of
// re-running vector paint. Scale is bucketed to 1x, 2x, or 4x so slight window
// or zoom adjustments do not re-rasterise mid-frame.
//
// Preloading: preloadArt() fetches all STATIC_ART images, room layouts, room
// furniture, and traveler.svg, and bakes common world sprites before artReady()
// becomes true so the first live frame is smooth.

export interface RoomArtItem {
  id: string;
  asset: string;
  x: number;
  y: number;
  width: number;
  height: number;
  when?: "done" | "unfinished";
}

/** Every fixed SVG the game draws by path. Room furniture is added from the room layouts. */
export const STATIC_ART: readonly string[] = [
  "house/interior.svg", "house/windows.svg", "house/door-frame.svg", "house/door-closed.svg",
  "house/door-open.svg", "house/sign.svg",
  "house/facade-ferryman.svg", "house/facade-foreman.svg", "house/facade-lodge.svg",
  "house/facade-orchard.svg", "house/facade-quarry.svg", "house/facade-tollhouse.svg",
  "furniture/barrel.svg", "furniture/crate.svg",
  "props/creek-bridge.svg", "props/fence.svg", "props/gravestone.svg", "props/haystack.svg",
  "props/key.svg", "props/lantern-post.svg", "props/supply-cart.svg", "props/supply-kit.svg",
  "props/timepiece.svg", "props/windmill.svg", "props/woodpile.svg", "props/broken-fence.svg",
  "props/blood-pool.svg",
  "scenery/autumn-tree.svg", "scenery/moon.svg", "scenery/meeting-square.svg",
  "scenery/stump.svg", "scenery/leaf-pile.svg", "scenery/pebble.svg",
  "structures/bell-tower.svg", "structures/bell.svg", "structures/cage-back.svg", "structures/cage-front.svg",
  "structures/chapel.svg", "structures/chapel-broken.svg", "structures/chapel-trim.svg",
  "structures/graves.svg", "structures/graves-broken.svg",
  "structures/lantern.svg", "structures/lantern-broken.svg",
  "structures/mill.svg", "structures/mill-broken.svg", "structures/mill-trim.svg",
  "structures/mill-sails.svg", "structures/mill-sails-broken.svg",
  "structures/pumpkin-shed.svg", "structures/pumpkin-shed-broken.svg", "structures/pumpkin-shed-trim.svg",
  "structures/radio.svg", "structures/radio-broken.svg",
  "structures/scarecrow.svg", "structures/scarecrow-broken.svg",
  "structures/silo.svg", "structures/silo-broken.svg",
  "structures/well.svg", "structures/well-broken.svg",
];

/** Each house's layout: rooms/<house>.svg, one <image> per placed object. */
export const ROOM_LAYOUTS: readonly string[] = ["ferryman", "foreman", "lodge", "orchard", "quarry", "tollhouse"];

const PRELOAD_TIMEOUT_MS = 4000;
const SPRITE_CAP = 1200;
const TRAVELER_CAP = 600;

const images = new Map<string, HTMLImageElement>();
const sprites = new Map<string, HTMLCanvasElement>();
const roomLayouts = new Map<string, RoomArtItem[]>();
const layoutRequests = new Map<string, Promise<void>>();
let travelerTemplate: string | null = null;
let travelerRequest: Promise<void> | null = null;
const travelers = new Map<string, HTMLCanvasElement>();
const travelerPending = new Set<string>();
let artScale = 1;
let artGen = 0;
let preloading: Promise<void> | null = null;
let ready = false;

export function artVersion(): number {
  return artGen;
}

/** Bucketed device density per world unit (1, 2, or 4) so small zoom changes keep bitmaps cached. */
export function setArtScale(scale: number) {
  if (!Number.isFinite(scale) || scale <= 0) return;
  artScale = scale <= 1.25 ? 1 : scale <= 2.3 ? 2 : 4;
}

export function getArtScale(): number {
  return artScale;
}

function assetUrl(path: string): string {
  if (typeof document === "undefined") return `/art/${path}`;
  const base = document.querySelector<HTMLMetaElement>('meta[name="hc-art-base"]')?.content || "/art/";
  return new URL(path, new URL(base, document.baseURI)).href;
}

function requestImage(path: string): HTMLImageElement {
  let image = images.get(path);
  if (!image) {
    image = new Image();
    image.decoding = "async";
    image.src = assetUrl(path);
    images.set(path, image);
  }
  return image;
}

/** Resolves once the image has loaded or failed (a failed image never draws). */
function settled(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
  });
}

const FURNITURE_PATH = /^furniture\/[a-z0-9][a-z0-9_-]*\.svg$/i;

/** Reads the <image> objects of a room layout. Invalid objects are skipped. */
function parseLayout(text: string): RoomArtItem[] {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) return [];
  const num = (el: Element, name: string): number => {
    const value = el.getAttribute(name);
    return value === null || value.trim() === "" ? NaN : Number(value);
  };
  return Array.from(doc.querySelectorAll("image")).flatMap((el): RoomArtItem[] => {
    const id = el.getAttribute("id");
    const asset = (el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "").replace(/^(\.\.\/)+/, "");
    const when = el.getAttribute("data-when");
    const item: RoomArtItem = {
      id: id ?? "", asset, x: num(el, "x"), y: num(el, "y"), width: num(el, "width"), height: num(el, "height"),
      when: when === "done" || when === "unfinished" ? when : undefined,
    };
    const valid = id !== null && id !== "" && FURNITURE_PATH.test(asset) &&
      [item.x, item.y, item.width, item.height].every((n) => Number.isFinite(n) && Math.abs(n) <= 1000) &&
      item.width > 0 && item.height > 0 && (when === null || when === "done" || when === "unfinished");
    return valid ? [item] : [];
  });
}

function requestLayout(houseId: string): Promise<void> {
  let request = layoutRequests.get(houseId);
  if (!request) {
    request = fetch(assetUrl(`rooms/${houseId}.svg`), { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Room artwork layout unavailable");
      return response.text();
    }).then((text) => {
      roomLayouts.set(houseId, parseLayout(text));
    }).catch(() => { /* The game remains playable if optional art is unavailable. */ });
    layoutRequests.set(houseId, request);
  }
  return request;
}

export function roomItems(houseId: string): RoomArtItem[] {
  if (!/^[a-z-]+$/.test(houseId)) return [];
  if (typeof window !== "undefined") void requestLayout(houseId);
  return roomLayouts.get(houseId) ?? [];
}

function requestTraveler(): Promise<void> {
  if (!travelerRequest) {
    travelerRequest = fetch(assetUrl("characters/traveler.svg"), { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Traveler artwork unavailable");
      return response.text();
    }).then((text) => { if (text.includes("<svg")) travelerTemplate = text; }).catch(() => {});
  }
  return travelerRequest;
}

/**
 * Bitmap sprite for an SVG at a world size, cached once per (path, pixel size).
 * Passing flip=true bakes a horizontally mirrored bitmap once so frames never save/scale/restore.
 */
export function spriteFor(path: string, width: number, height: number, flip = false): HTMLCanvasElement | null {
  if (typeof document === "undefined" || !(width > 0) || !(height > 0)) return null;
  const image = requestImage(path);
  if (!image.complete || !image.naturalWidth) return null;
  const pw = Math.max(1, Math.ceil(width * artScale));
  const ph = Math.max(1, Math.ceil(height * artScale));
  const key = `${path}|${pw}x${ph}${flip ? "|f" : ""}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const g = canvas.getContext("2d");
  if (g) {
    if (flip) { g.translate(pw, 0); g.scale(-1, 1); }
    g.drawImage(image, 0, 0, pw, ph);
  }
  if (sprites.size >= SPRITE_CAP) sprites.delete(sprites.keys().next().value as string);
  sprites.set(key, canvas);
  return canvas;
}

/** Draws a pre-rasterised SVG bitmap at a world box. No per-frame save/scale/restore needed even when flipped. */
export function drawSvg(
  ctx: CanvasRenderingContext2D, path: string, x: number, y: number, width: number, height: number, flip = false,
): boolean {
  const sprite = spriteFor(path, width, height, flip);
  if (!sprite) return false;
  ctx.drawImage(sprite, x, y, width, height);
  return true;
}

/** The traveller sprite in its own colours, baked per palette, pose and direction. */
export function drawTraveler(
  ctx: CanvasRenderingContext2D, color: string, redEyes: boolean, ghost: boolean, pose: number, facing = 1,
): boolean {
  if (typeof window === "undefined") return false;
  void requestTraveler();
  if (!travelerTemplate) return false;
  const cloak = /^#[0-9a-f]{6}$/i.test(color) ? color : "#3a7ca5";
  const step = pose > 0 ? 3 : pose < 0 ? -3 : 0;
  const flip = facing < 0;
  const key = `${cloak}:${redEyes}:${ghost}:${step}:${flip ? -1 : 1}:${artScale}`;
  const hit = travelers.get(key);
  if (hit) {
    ctx.drawImage(hit, -20, -54, 40, 54);
    return true;
  }
  if (!travelerPending.has(key)) bakeTraveler(key, cloak, redEyes, ghost, step, flip, travelerTemplate);
  return false;
}

function bakeTraveler(
  key: string, cloak: string, redEyes: boolean, ghost: boolean, step: number, flip: boolean, template: string,
) {
  travelerPending.add(key);
  const variables = `--cloak:${cloak};--eyes:${redEyes ? "#ff5142" : "#eee6ce"};--leg-a:${step}px;--leg-b:${-step}px;--legs-opacity:${ghost ? 0 : 1};`;
  const image = new Image();
  const scale = artScale;
  image.onload = () => {
    const pw = Math.max(1, Math.ceil(40 * scale));
    const ph = Math.max(1, Math.ceil(54 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = pw;
    canvas.height = ph;
    const g = canvas.getContext("2d");
    if (g) {
      if (flip) { g.translate(pw, 0); g.scale(-1, 1); }
      g.drawImage(image, 0, 0, pw, ph);
    }
    if (travelers.size >= TRAVELER_CAP) travelers.clear();
    travelers.set(key, canvas);
    travelerPending.delete(key);
    artGen++;
  };
  image.onerror = () => travelerPending.delete(key);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(template.replace("/* RUNTIME PALETTE */", variables))}`;
}

/** Whether preloadArt() has finished (all loaded, failed, or timed out). */
export function artReady(): boolean {
  return ready;
}

/** Pre-bake common fixed-size sprites at load time so early frames never rasterise SVGs synchronously. */
function warmCommonSprites() {
  const prevScale = artScale;
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
  setArtScale(dpr * 1.2);
  const fixed: [string, number, number][] = [
    ["props/fence.svg", 140, 46], ["props/lantern-post.svg", 30, 96],
    ["props/woodpile.svg", 64, 44], ["props/windmill.svg", 130, 160],
    ["props/gravestone.svg", 34, 46], ["props/haystack.svg", 70, 52],
    ["props/creek-bridge.svg", 260, 64], ["props/supply-cart.svg", 100, 82],
    ["props/supply-kit.svg", 38, 28], ["props/key.svg", 18, 32],
    ["props/timepiece.svg", 36, 48], ["props/timepiece.svg", 15, 20],
    ["props/broken-fence.svg", 86, 38], ["props/blood-pool.svg", 60, 14],
    ["scenery/stump.svg", 60, 12], ["scenery/leaf-pile.svg", 44, 8],
    ["scenery/moon.svg", 84, 84], ["furniture/barrel.svg", 26, 34], ["furniture/crate.svg", 30, 26],
    ["house/interior.svg", 300, 112], ["house/interior.svg", 330, 112], ["house/interior.svg", 340, 112],
    ["house/windows.svg", 300, 158], ["house/windows.svg", 330, 158], ["house/windows.svg", 340, 158],
    ["house/door-frame.svg", 64, 112], ["house/door-closed.svg", 64, 112], ["house/door-open.svg", 64, 112],
    ["structures/bell-tower.svg", 100, 190], ["structures/bell.svg", 36, 40],
    ["structures/cage-back.svg", 80, 112], ["structures/cage-front.svg", 80, 112],
  ];
  for (const [path, w, h] of fixed) spriteFor(path, w, h);
  for (const houseId of ROOM_LAYOUTS) {
    for (const item of roomLayouts.get(houseId) ?? []) spriteFor(item.asset, item.width, item.height);
  }
  artScale = prevScale;
}

/** Starts loading all fixed art, room furniture and the traveller sprite. Idempotent. */
export function preloadArt(): Promise<void> {
  if (preloading) return preloading;
  if (typeof window === "undefined") {
    ready = true;
    preloading = Promise.resolve();
    return preloading;
  }
  const rooms = Promise.all(ROOM_LAYOUTS.map((houseId) => requestLayout(houseId))).then(() => Promise.all(
    ROOM_LAYOUTS.flatMap((houseId) => roomLayouts.get(houseId) ?? []).map((item) => settled(requestImage(item.asset))),
  ));
  const all = Promise.all([
    ...STATIC_ART.map((path) => settled(requestImage(path))),
    requestTraveler(),
    rooms,
  ]).then(warmCommonSprites);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, PRELOAD_TIMEOUT_MS));
  preloading = Promise.race([all, timeout]).then(() => { ready = true; });
  return preloading;
}
