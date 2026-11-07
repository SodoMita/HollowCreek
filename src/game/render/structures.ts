// Placement boxes for the structure art in public/art/structures/ (world units, road point at 0,0).
import { drawSvg } from "../svg-assets";

export const STRUCTURE_BOX = {
  "pumpkin-shed": [-90, -110, 180, 116],
  well: [-60, -100, 120, 106],
  scarecrow: [-60, -120, 120, 124],
  lantern: [-40, -115, 80, 119],
  chapel: [-140, -470, 280, 476],
  mill: [-95, -120, 190, 124],
  "mill-sails": [-46, -46, 92, 92],
  graves: [-75, -50, 200, 60],
  radio: [-70, -210, 140, 214],
  silo: [-45, -180, 90, 184],
  "cage-back": [-40, -112, 80, 112],
  "cage-front": [-40, -112, 80, 112],
  "bell-tower": [-50, -186, 100, 190],
  bell: [-18, -8, 36, 40],
} as const;

export type StructureName = keyof typeof STRUCTURE_BOX;

/** Draws `public/art/structures/<name>[-<variant>].svg` at its box. Returns false until the image has loaded. */
export function drawStructure(ctx: CanvasRenderingContext2D, name: StructureName, variant?: "broken" | "trim"): boolean {
  const [x, y, w, h] = STRUCTURE_BOX[name];
  return drawSvg(ctx, `structures/${variant ? `${name}-${variant}` : name}.svg`, x, y, w, h);
}
