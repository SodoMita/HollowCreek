// A hooded traveller, drawn from the SVG sprite (characters/traveler.svg).
// Until the sprite has loaded, nothing is drawn; see public/art/README.md.
import { drawTraveler } from "../svg-assets";

export function drawFigure(
  ctx: CanvasRenderingContext2D, x: number, groundY: number, color: string,
  facing: number, moving: boolean, ghost: boolean, redEyes: boolean, t: number, scale: number,
) {
  const gait = Math.sin(t * 11 + x * 0.1);
  const bob = moving ? gait * 1.8 : Math.sin(t * 1.7 + x) * 0.35;
  ctx.save();
  ctx.translate(x, groundY + bob);
  ctx.scale(facing * scale, scale);
  const pose = moving ? (gait > 0.25 ? 1 : gait < -0.25 ? -1 : 0) : 0;
  drawTraveler(ctx, color, redEyes, ghost, pose);
  ctx.restore();
}
