// The meeting house: a white-clapboard chapel with a square belfry and a spire,
// the tallest thing on the street. The walls, roof, door and frames are the SVG
// art (structures/chapel*.svg); the lit glass is drawn here between the two layers.
// The SVGs are authored to the dimensions in units.ts (MEETING_HOUSE); if those change, redraw the art too.
import { MEETING_HOUSE as M } from "../units";
import { drawStructure } from "./structures";

/** Draws the chapel in the station's local frame (origin = road, x centred).
 *  `win` lights a window; it is supplied by the station so the lamp logic stays in one place. */
export function drawChapel(
  ctx: CanvasRenderingContext2D, broken: boolean,
  win: (wx: number, wy: number, ww: number, wh: number) => void,
) {
  const { width: W, wallHeight: H, windowWidth: WW, windowHeight: WH, doorWidth: DW, doorHeight: DH } = M;
  drawStructure(ctx, "chapel", broken ? "broken" : undefined);
  const winTop = -H + (H - WH) * 0.45;
  for (const wx of [-W / 2 + W * 0.14, W / 2 - W * 0.14 - WW]) win(wx, winTop, WW, WH);
  win(-DW / 2, -DH - 16, DW, 12);
  drawStructure(ctx, "chapel", "trim");
}
