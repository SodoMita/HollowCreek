import { drawSvg } from "./svg-assets";

/** A small crate of boards, wire, iron and lamp oil, shared across all wards. */
export function drawKit(ctx: CanvasRenderingContext2D, x: number, ground: number) {
  drawSvg(ctx, "props/supply-kit.svg", x - 19, ground - 28, 38, 28);
}

/** A reusable stock cart. The E hint comes from the server; the sign is visible from afar. */
export function drawSupplyCart(ctx: CanvasRenderingContext2D, x: number, ground: number) {
  if (!drawSvg(ctx, "props/supply-cart.svg", x - 50, ground - 82, 100, 82)) return;
  ctx.save(); ctx.fillStyle = "#e4cba8"; ctx.font = "bold 11px Georgia, serif"; ctx.textAlign = "center"; ctx.fillText("SUPPLIES", x, ground - 75); ctx.restore();
}
