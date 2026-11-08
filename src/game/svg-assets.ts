// Browser-side art loader. Art lives as editable SVG files in public/art.
//
// Each file is fetched once. The renderer then asks for a sprite at a world size:
// the SVG is rasterised once into a canvas at the device density, and every later
// frame is a plain bitmap copy. Drawing an SVG <img> straight onto the canvas
// re-runs its vector paint on every call, which the old renderer did for well
// over a hundred calls a frame.
//
// Preloading: preloadArt() requests every fixed SVG in STATIC_ART, the room
// furniture from rooms/<house>.svg and the traveller sprite. The renderer holds
// its frame until artReady(). The wait ends after PRELOAD_TIMEOUT_MS so a slow or
// missing file cannot stall the game, and a file that never loads is never drawn.

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
let preloading: Promise<void> | null = null;
let ready = false;

/** Device pixels per world unit, in half steps. Sprites are rasterised at this density. */
export function setArtScale(scale: number) {
  if (!Number.isFinite(scale) || scale <= 0) return;
  artScale = Math.min(4, Math.max(0.5, Math.ceil(scale * 2) / 2));
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
    // The layout sits in rooms/, so its links start with ../ to reach the art root.
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

/** Layouts are re-read on a page reload, so positions can be edited without code. */
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

/** The sprite for a same-origin SVG at a world size, or null until the file has loaded. */
export function spriteFor(path: string, width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined" || !(width > 0) || !(height > 0)) return null;
  const image = requestImage(path);
  if (!image.complete || !image.naturalWidth) return null;
  const pw = Math.max(1, Math.ceil(width * artScale));
  const ph = Math.max(1, Math.ceil(height * artScale));
  const key = `${path}|${pw}x${ph}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  canvas.getContext("2d")?.drawImage(image, 0, 0, pw, ph);
  if (sprites.size >= SPRITE_CAP) sprites.delete(sprites.keys().next().value as string);
  sprites.set(key, canvas);
  return canvas;
}

/** Draws a same-origin SVG at a world box. Returns false until the file has loaded. */
export function drawSvg(
  ctx: CanvasRenderingContext2D, path: string, x: number, y: number, width: number, height: number, flip = false,
): boolean {
  const sprite = spriteFor(path, width, height);
  if (!sprite) return false;
  if (flip) {
    // Mirror about the box's centre line.
    ctx.save();
    ctx.translate(2 * x + width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite, x, y, width, height);
    ctx.restore();
  } else {
    ctx.drawImage(sprite, x, y, width, height);
  }
  return true;
}

/** The traveller sprite in its own colours, baked per palette and pose. Drawn in local coordinates. */
export function drawTraveler(ctx: CanvasRenderingContext2D, color: string, redEyes: boolean, ghost: boolean, pose: number): boolean {
  if (typeof window === "undefined") return false;
  void requestTraveler();
  if (!travelerTemplate) return false;
  const cloak = /^#[0-9a-f]{6}$/i.test(color) ? color : "#3a7ca5";
  const step = pose > 0 ? 3 : pose < 0 ? -3 : 0;
  const key = `${cloak}:${redEyes}:${ghost}:${step}:${artScale}`;
  const hit = travelers.get(key);
  if (hit) {
    ctx.drawImage(hit, -20, -54, 40, 54);
    return true;
  }
  if (!travelerPending.has(key)) bakeTraveler(key, cloak, redEyes, ghost, step, travelerTemplate);
  return false;
}

function bakeTraveler(key: string, cloak: string, redEyes: boolean, ghost: boolean, step: number, template: string) {
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
    canvas.getContext("2d")?.drawImage(image, 0, 0, pw, ph);
    if (travelers.size >= TRAVELER_CAP) travelers.clear();
    travelers.set(key, canvas);
    travelerPending.delete(key);
  };
  image.onerror = () => travelerPending.delete(key);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(template.replace("/* RUNTIME PALETTE */", variables))}`;
}

/** Whether preloadArt() has finished (all loaded, failed, or timed out). */
export function artReady(): boolean {
  return ready;
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
  ]);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, PRELOAD_TIMEOUT_MS));
  preloading = Promise.race([all, timeout]).then(() => { ready = true; });
  return preloading;
}
