// The meeting house: a white-clapboard chapel with a square belfry and a spire,
// the tallest thing on the street. Dimensions come from units.ts.
import { MEETING_HOUSE as M } from "../units";

/** Draws the chapel in the station's local frame (origin = road, x centred).
 *  `win` lights a window; it is supplied by the station so the lamp logic stays in one place. */
export function drawChapel(
  ctx: CanvasRenderingContext2D, broken: boolean,
  win: (wx: number, wy: number, ww: number, wh: number) => void,
) {
  const { width: W, wallHeight: H, roofRise, towerWidth, towerBase, belfryHeight, spireHeight, windowWidth: WW, windowHeight: WH, doorWidth: DW, doorHeight: DH } = M;
  const tw = towerWidth / 2, ridge = -H - roofRise, belfryFloor = ridge - towerBase, belfryTop = belfryFloor - belfryHeight, spireTip = belfryTop - spireHeight;
  ctx.fillStyle = "#2b2129";
  ctx.fillRect(-W / 2, -H, W, H);
  ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.lineWidth = 1;
  for (let y = -H + 8; y < -2; y += 8) { ctx.beginPath(); ctx.moveTo(-W / 2, y); ctx.lineTo(W / 2, y); ctx.stroke(); }
  // corner boards and water table
  ctx.fillStyle = "#3a2f38"; ctx.fillRect(-W / 2, -H, 6, H); ctx.fillRect(W / 2 - 6, -H, 6, H); ctx.fillRect(-W / 2, -8, W, 8);
  // gable roof facing the road, with a pediment cornice
  ctx.fillStyle = "#17111a";
  ctx.beginPath(); ctx.moveTo(-W / 2 - 14, -H); ctx.lineTo(0, ridge); ctx.lineTo(W / 2 + 14, -H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#5a4f58"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-W / 2 - 14, -H); ctx.lineTo(0, ridge); ctx.lineTo(W / 2 + 14, -H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-W / 2 - 14, -H + 2); ctx.lineTo(W / 2 + 14, -H + 2); ctx.stroke();
  // tower astride the ridge: base, open belfry, spire, weathervane
  ctx.fillStyle = "#2b2129"; ctx.fillRect(-tw, belfryFloor, towerWidth, towerBase + 12);
  ctx.fillStyle = "#3a2f38"; ctx.fillRect(-tw - 4, belfryFloor - 4, towerWidth + 8, 6);
  ctx.fillStyle = "#241a22"; ctx.fillRect(-tw + 4, belfryTop, towerWidth - 8, belfryHeight);
  ctx.fillStyle = broken ? "#07050a" : "#120a0e";
  const ar = tw * 0.46, arcY = belfryTop + belfryHeight * 0.45;
  ctx.beginPath(); ctx.moveTo(-ar, belfryFloor - 4); ctx.lineTo(-ar, arcY); ctx.arc(0, arcY, ar, Math.PI, 0); ctx.lineTo(ar, belfryFloor - 4); ctx.closePath(); ctx.fill();
  if (!broken) { ctx.fillStyle = "#8c6a2f"; ctx.beginPath(); ctx.arc(0, arcY + ar * 0.8, ar * 0.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#3a2f38"; ctx.fillRect(-tw - 2, belfryTop - 6, towerWidth + 4, 6);
  ctx.fillStyle = "#17111a";
  ctx.beginPath(); ctx.moveTo(-tw - 2, belfryTop - 6); ctx.lineTo(0, spireTip); ctx.lineTo(tw + 2, belfryTop - 6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#c9b98a"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, spireTip); ctx.lineTo(0, spireTip - 26); ctx.moveTo(-9, spireTip - 16); ctx.lineTo(9, spireTip - 16); ctx.stroke();
  // tall arched windows either side of the door, a fan light over it
  const winTop = -H + (H - WH) * 0.45;
  for (const wx of [-W / 2 + W * 0.14, W / 2 - W * 0.14 - WW]) {
    ctx.fillStyle = "#1a1219";
    ctx.beginPath(); ctx.moveTo(wx - 3, winTop + WH); ctx.lineTo(wx - 3, winTop); ctx.arc(wx + WW / 2, winTop, WW / 2 + 3, Math.PI, 0); ctx.lineTo(wx + WW + 3, winTop + WH); ctx.closePath(); ctx.fill();
    win(wx, winTop, WW, WH);
    ctx.strokeStyle = "rgba(31,17,15,.9)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(wx + WW / 2, winTop); ctx.lineTo(wx + WW / 2, winTop + WH); ctx.moveTo(wx, winTop + WH / 2); ctx.lineTo(wx + WW, winTop + WH / 2); ctx.stroke();
  }
  ctx.fillStyle = "#1a1219"; ctx.fillRect(-DW / 2 - 5, -DH - 20, DW + 10, DH + 20);
  win(-DW / 2, -DH - 16, DW, 12);
  ctx.fillStyle = "#120a0e"; ctx.fillRect(-DW / 2, -DH, DW, DH);
  ctx.strokeStyle = "#3a2f38"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -DH); ctx.lineTo(0, 0); ctx.stroke();
  ctx.fillStyle = "#3d3a42"; ctx.fillRect(-DW / 2 - 15, -6, DW + 30, 6); ctx.fillRect(-DW / 2 - 21, -3, DW + 42, 3);
}
