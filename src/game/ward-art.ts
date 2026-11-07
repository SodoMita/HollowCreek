import { drawSvg } from "./svg-assets";

/** A small crate of boards, wire, iron and lamp oil, shared across all wards. */
export function drawKit(ctx: CanvasRenderingContext2D, x: number, ground: number) {
  if (drawSvg(ctx, "props/supply-kit.svg", x - 19, ground - 28, 38, 28)) return;
  ctx.save();
  ctx.translate(x, ground);
  ctx.fillStyle = "rgba(0,0,0,.4)";
  ctx.beginPath(); ctx.ellipse(0, 1, 20, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4a301e";
  ctx.fillRect(-14, -23, 28, 21);
  ctx.strokeStyle = "#a67a48";
  ctx.lineWidth = 2;
  ctx.strokeRect(-14, -23, 28, 21);
  ctx.beginPath(); ctx.moveTo(-14, -21); ctx.lineTo(14, -4);
  ctx.moveTo(14, -21); ctx.lineTo(-14, -4); ctx.stroke();
  ctx.fillStyle = "#7e8790";
  ctx.fillRect(-16, -19, 4, 3); ctx.fillRect(12, -19, 4, 3);
  ctx.restore();
}

/** A reusable stock cart. The E hint comes from the server; the sign is visible from afar. */
export function drawSupplyCart(ctx: CanvasRenderingContext2D, x: number, ground: number) {
  if (drawSvg(ctx, "props/supply-cart.svg", x - 50, ground - 82, 100, 82)) {
    ctx.save(); ctx.fillStyle = "#e4cba8"; ctx.font = "bold 11px Georgia, serif"; ctx.textAlign = "center"; ctx.fillText("SUPPLIES", x, ground - 75); ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, ground);
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.beginPath(); ctx.ellipse(0, 4, 49, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#312117";
  ctx.fillRect(-40, -31, 80, 21);
  ctx.fillStyle = "#644328";
  ctx.fillRect(-42, -35, 84, 6);
  for (const cx of [-27, 27]) {
    ctx.fillStyle = "#211a18";
    ctx.beginPath(); ctx.arc(cx, -5, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#89745b";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, -5, 9, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = "#503723";
  ctx.fillRect(-28, -56, 26, 20); ctx.fillRect(4, -58, 27, 22);
  ctx.strokeStyle = "#987451";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-28, -56, 26, 20); ctx.strokeRect(4, -58, 27, 22);
  ctx.fillStyle = "#c9b28c";
  ctx.font = "bold 11px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("SUPPLIES", 0, -75);
  ctx.restore();
}

