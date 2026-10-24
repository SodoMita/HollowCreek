import type { Station } from "./types";

/** A small crate of boards, wire, iron and lamp oil, shared across all wards. */
export function drawKit(ctx: CanvasRenderingContext2D, x: number, ground: number) {
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

/** Physical damage overlays drawn on the original station silhouettes. */
export function drawBrokenWard(ctx: CanvasRenderingContext2D, kind: Station["kind"]) {
  ctx.save();
  ctx.lineCap = "round";
  switch (kind) {
    case "pumpkins":
      // Shed roof has fallen inward; the gourds have split across the dirt.
      ctx.fillStyle = "#100c0c";
      ctx.beginPath(); ctx.moveTo(-40, -94); ctx.lineTo(-8, -76); ctx.lineTo(26, -87);
      ctx.lineTo(50, -72); ctx.lineTo(12, -70); ctx.lineTo(-35, -75); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#6b3219";
      for (const px of [-39, 4, 39]) {
        ctx.beginPath(); ctx.ellipse(px, -2, 20, 4, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = "#705038"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-46, -67); ctx.lineTo(-16, -51);
      ctx.moveTo(29, -70); ctx.lineTo(56, -49); ctx.stroke();
      break;
    case "well":
      // Snapped beam, frayed rope and a bucket on its side.
      ctx.fillStyle = "#131016";
      ctx.fillRect(-40, -31, 80, 8);
      ctx.strokeStyle = "#443426"; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-27, -73); ctx.lineTo(-27, -32);
      ctx.moveTo(28, -75); ctx.lineTo(50, -17); ctx.stroke();
      ctx.strokeStyle = "#84633b"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(2, -64); ctx.lineTo(-10, -49); ctx.stroke();
      ctx.fillStyle = "#493623";
      ctx.save(); ctx.translate(34, -6); ctx.rotate(-0.6); ctx.fillRect(-12, -12, 24, 14); ctx.restore();
      break;
    case "scarecrow":
      ctx.strokeStyle = "#392a1c"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(-29, -63); ctx.lineTo(34, -40); ctx.stroke();
      ctx.fillStyle = "#bd9860";
      ctx.beginPath(); ctx.arc(38, -8, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#131013";
      ctx.beginPath(); ctx.moveTo(24, -19); ctx.lineTo(46, -21); ctx.lineTo(53, -10); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#9d7850"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-8, -44); ctx.lineTo(-16, -24);
      ctx.moveTo(10, -36); ctx.lineTo(18, -17); ctx.stroke();
      break;
    case "lantern":
      // Dead glass at the foot of a bent, unlit post.
      ctx.fillStyle = "#101016";
      ctx.fillRect(-12, -109, 28, 23);
      ctx.strokeStyle = "#55515b"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-15, -30); ctx.lineTo(-36, -13);
      ctx.moveTo(-26, -17); ctx.lineTo(-17, -7);
      ctx.moveTo(19, -15); ctx.lineTo(36, -7); ctx.stroke();
      break;
    case "chapel":
      // Broken roof slates and boarded windows — no warm glow until restored.
      ctx.fillStyle = "#0a080d";
      ctx.beginPath(); ctx.moveTo(-22, -116); ctx.lineTo(-5, -99); ctx.lineTo(17, -115);
      ctx.lineTo(35, -94); ctx.lineTo(-20, -93); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#493326"; ctx.lineWidth = 5;
      for (const wx of [-42, 30]) {
        ctx.beginPath(); ctx.moveTo(wx - 3, -65); ctx.lineTo(wx + 19, -37); ctx.stroke();
      }
      ctx.strokeStyle = "#4c4146"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-59, -17); ctx.lineTo(-29, -47);
      ctx.moveTo(-47, -20); ctx.lineTo(-24, -22); ctx.stroke();
      break;
    case "mill":
      ctx.fillStyle = "#0c090b";
      ctx.beginPath(); ctx.moveTo(-30, -113); ctx.lineTo(-4, -94); ctx.lineTo(22, -112);
      ctx.lineTo(40, -86); ctx.lineTo(-25, -83); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#4a3826"; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-38, -4); ctx.lineTo(13, -20); ctx.stroke();
      ctx.fillStyle = "#412a1c"; ctx.fillRect(44, -17, 35, 6);
      break;
    case "graves":
      ctx.fillStyle = "#0a0807";
      ctx.beginPath(); ctx.ellipse(-24, 0, 28, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(54, 0, 30, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4b444b";
      ctx.save(); ctx.translate(13, -6); ctx.rotate(0.95); ctx.fillRect(-16, -12, 32, 13); ctx.restore();
      ctx.strokeStyle = "#65525a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-48, -16); ctx.lineTo(-26, -29); ctx.stroke();
      break;
    case "radio":
      ctx.strokeStyle = "#12111a"; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(-6, -200); ctx.lineTo(30, -55); ctx.stroke();
      ctx.strokeStyle = "#5b555d"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(13, -98); ctx.lineTo(53, -55);
      ctx.moveTo(23, -68); ctx.lineTo(38, -22); ctx.stroke();
      ctx.fillStyle = "#423942";
      ctx.beginPath(); ctx.arc(56, -12, 5, 0, Math.PI * 2); ctx.fill();
      break;
    case "silo":
      ctx.fillStyle = "#111015";
      ctx.beginPath(); ctx.moveTo(5, -173); ctx.lineTo(30, -163); ctx.lineTo(37, -136);
      ctx.lineTo(13, -143); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#141015"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-26, -119); ctx.lineTo(-3, -89); ctx.lineTo(-13, -56);
      ctx.moveTo(28, -70); ctx.lineTo(9, -50); ctx.stroke();
      ctx.fillStyle = "#161014"; ctx.fillRect(-16, -38, 32, 38);
      break;
  }
  ctx.restore();
}
