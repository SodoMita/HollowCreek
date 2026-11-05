// Shared browser-side SVG loader. Art lives in public/art, not in game logic.
// Static exports set hc-art-base so the same files work on portal hosts.
export interface RoomArtItem {
  id: string;
  asset: string;
  x: number;
  y: number;
  width: number;
  height: number;
  when?: "done" | "unfinished";
}

const images = new Map<string, HTMLImageElement>();
let roomLayouts: Record<string, RoomArtItem[]> | null = null;
let requestedLayouts = false;
let travelerTemplate: string | null = null;
let requestedTraveler = false;
const travelers = new Map<string, HTMLImageElement>();

function assetUrl(path: string): string {
  if (typeof document === "undefined") return `/art/${path}`;
  const base = document.querySelector<HTMLMetaElement>('meta[name="hc-art-base"]')?.content || "/art/";
  return new URL(path, new URL(base, document.baseURI)).href;
}

/** Draw a same-origin SVG once loaded; callers can provide a lightweight fallback. */
export function drawSvg(ctx: CanvasRenderingContext2D, path: string, x: number, y: number, width: number, height: number): boolean {
  if (typeof Image === "undefined") return false;
  let image = images.get(path);
  if (!image) {
    image = new Image();
    image.decoding = "async";
    image.src = assetUrl(path);
    images.set(path, image);
  }
  if (!image.complete || !image.naturalWidth) return false;
  ctx.drawImage(image, x, y, width, height);
  return true;
}

/** Layout JSON is re-read on a page reload, so positions can be edited without code. */
export function roomItems(houseId: string): RoomArtItem[] {
  if (!requestedLayouts && typeof window !== "undefined") {
    requestedLayouts = true;
    void fetch(assetUrl("rooms.json"), { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Room artwork layout unavailable");
      return response.json();
    }).then((data: unknown) => {
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
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
      roomLayouts = result;
    }).catch(() => { /* The game remains playable if optional art is unavailable. */ });
  }
  return roomLayouts?.[houseId] ?? [];
}

/** The SVG is a normal editable file. Only its marked palette variables vary by player. */
export function drawTraveler(ctx: CanvasRenderingContext2D, color: string, redEyes: boolean, ghost: boolean, pose: number): boolean {
  if (typeof window === "undefined") return false;
  if (!requestedTraveler) {
    requestedTraveler = true;
    void fetch(assetUrl("characters/traveler.svg"), { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Traveler artwork unavailable");
      return response.text();
    }).then((text) => { if (text.includes("<svg")) travelerTemplate = text; }).catch(() => {});
  }
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
