// Shared browser-side SVG loader. Art lives in public/art, not in game logic.
// Static exports set hc-art-base so the same files work on portal hosts.
//
// Preloading: preloadArt() requests every fixed SVG in STATIC_ART, the room
// furniture named in rooms.json, and the traveller sprite. The renderer holds
// its frame until artReady() is true, so the first visible frame is complete.
// If a file is slow or missing, the wait ends after PRELOAD_TIMEOUT_MS and the
// game continues; an object whose file never loads is simply not drawn.
export interface RoomArtItem {
  id: string;
  asset: string;
  x: number;
  y: number;
  width: number;
  height: number;
  when?: "done" | "unfinished";
}

/** Every fixed SVG the game draws by path. Room furniture is added from rooms.json. */
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

const PRELOAD_TIMEOUT_MS = 4000;

const images = new Map<string, HTMLImageElement>();
let roomLayouts: Record<string, RoomArtItem[]> | null = null;
let layoutsRequest: Promise<void> | null = null;
let travelerTemplate: string | null = null;
let travelerRequest: Promise<void> | null = null;
const travelers = new Map<string, HTMLImageElement>();
let preloading: Promise<void> | null = null;
let ready = false;

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

/** Draw a same-origin SVG once loaded. Returns false until then, and forever if the file fails. */
export function drawSvg(ctx: CanvasRenderingContext2D, path: string, x: number, y: number, width: number, height: number): boolean {
  if (typeof Image === "undefined") return false;
  const image = requestImage(path);
  if (!image.complete || !image.naturalWidth) return false;
  ctx.drawImage(image, x, y, width, height);
  return true;
}

function parseLayouts(data: unknown): Record<string, RoomArtItem[]> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const result: Record<string, RoomArtItem[]> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!/^[a-z-]+$/.test(key) || !Array.isArray(value)) continue;
    result[key] = value.filter((item): item is RoomArtItem => {
      if (!item || typeof item !== "object") return false;
      const v = item as Record<string, unknown>;
      return typeof v.id === "string" && typeof v.asset === "string" && /^furniture\/[a-z0-9][a-z0-9_-]*\.svg$/i.test(v.asset) &&
        [v.x, v.y, v.width, v.height].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000) &&
        (v.width as number) > 0 && (v.height as number) > 0 &&
        (v.when === undefined || v.when === "done" || v.when === "unfinished");
    });
  }
  return result;
}

/** Layout JSON is re-read on a page reload, so positions can be edited without code. */
function requestLayouts(): Promise<void> {
  if (!layoutsRequest) {
    layoutsRequest = fetch(assetUrl("rooms.json"), { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Room artwork layout unavailable");
      return response.json();
    }).then((data: unknown) => {
      roomLayouts = parseLayouts(data);
    }).catch(() => { /* The game remains playable if optional art is unavailable. */ });
  }
  return layoutsRequest;
}

export function roomItems(houseId: string): RoomArtItem[] {
  if (typeof window !== "undefined") void requestLayouts();
  return roomLayouts?.[houseId] ?? [];
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

/** The SVG is a normal editable file. Only its marked palette variables vary by player. */
export function drawTraveler(ctx: CanvasRenderingContext2D, color: string, redEyes: boolean, ghost: boolean, pose: number): boolean {
  if (typeof window === "undefined") return false;
  void requestTraveler();
  if (!travelerTemplate) return false;
  const cloak = /^#[0-9a-f]{6}$/i.test(color) ? color : "#3a7ca5";
  const step = pose > 0 ? 3 : pose < 0 ? -3 : 0;
  const key = `${cloak}:${redEyes}:${ghost}:${step}`;
  let image = travelers.get(key);
  if (!image) {
    const variables = `--cloak:${cloak};--eyes:${redEyes ? "#ff5142" : "#eee6ce"};--leg-a:${step}px;--leg-b:${-step}px;--legs-opacity:${ghost ? 0 : 1};`;
    const svg = travelerTemplate.replace("/* RUNTIME PALETTE */", variables);
    image = new Image();
    image.decoding = "async";
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    travelers.set(key, image);
  }
  if (!image.complete || !image.naturalWidth) return false;
  ctx.drawImage(image, -20, -54, 40, 54);
  return true;
}

/** Whether preloadArt() has finished (all loaded, failed, or timed out). */
export function artReady(): boolean {
  return ready;
}

/** Starts loading all fixed art, room furniture and the traveller sprite. Idempotent.
 *  Resolves when everything has loaded or failed, or after PRELOAD_TIMEOUT_MS. */
export function preloadArt(): Promise<void> {
  if (preloading) return preloading;
  if (typeof window === "undefined") {
    ready = true;
    preloading = Promise.resolve();
    return preloading;
  }
  const rooms = requestLayouts().then(() => Promise.all(
    Object.values(roomLayouts ?? {}).flat().map((item) => settled(requestImage(item.asset))),
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
