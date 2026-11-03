// House composition is intentionally data-driven: editable SVGs and rooms.json
// supply the artwork; this module only places layers in the existing world.
import { doorX, type Building, type DoorState } from "./buildings";
import { drawSvg, roomItems } from "./svg-assets";
import type { TaskView } from "./types";

const WALL_HEIGHT = 112;
const ROOF_HEIGHT = 158;

export function drawHouseInterior(
  ctx: CanvasRenderingContext2D, b: Building, x: number, ground: number,
  _time: number, task: TaskView | undefined, occupied: boolean,
) {
  const left = x - b.width / 2;
  ctx.save();
  // Contact shadow connects the building to the road rather than letting it float.
  ctx.fillStyle = "rgba(4,3,6,.38)";
  ctx.beginPath(); ctx.ellipse(x, ground + 2, b.width * 0.52, 7, 0, 0, Math.PI * 2); ctx.fill();
  if (!drawSvg(ctx, "house/interior.svg", left, ground - WALL_HEIGHT, b.width, WALL_HEIGHT)) {
    ctx.fillStyle = "#5c4034"; ctx.fillRect(left, ground - WALL_HEIGHT, b.width, WALL_HEIGHT - 8);
    ctx.fillStyle = "#72503c"; ctx.fillRect(left, ground - 12, b.width, 12);
  }
  for (const item of roomItems(b.id)) {
    if (item.when === "done" && !task?.done) continue;
    if (item.when === "unfinished" && task?.done) continue;
    drawSvg(ctx, item.asset, x + item.x, ground + item.y, item.width, item.height);
  }
  // The interactive marker follows the authoritative task coordinate.
  if (occupied && task && !task.done) {
    const workX = x + task.x - b.x;
    ctx.save(); ctx.fillStyle = task.delivered ? "#f0c276" : "#dc8a64";
    ctx.font = "bold 13px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.shadowColor = "#d99a3d"; ctx.shadowBlur = 9; ctx.fillText("◇", workX, ground - 90); ctx.restore();
  }
  ctx.restore();
}

export function drawHouseExterior(
  ctx: CanvasRenderingContext2D, b: Building, x: number, ground: number,
  _time: number, door: DoorState | undefined, occupied: boolean, openAmount = door?.open ? 1 : 0,
) {
  const left = x - b.width / 2;
  const scaleX = b.width / 300;
  const overhang = 16 * scaleX;
  const dx = doorX(b) - b.x + x;
  const opening = Math.max(0, Math.min(1, openAmount));

  // Knock out the windows and side threshold from the facade itself. The room
  // and people already painted behind these holes remain visible; no black panel
  // is left in the opening when the door swings out.
  ctx.save();
  ctx.beginPath();
  ctx.rect(left - overhang - 4, ground - ROOF_HEIGHT - 4, b.width + overhang * 2 + 8, ROOF_HEIGHT + 8);
  ctx.rect(left + 61 * scaleX, ground - 79, 27 * scaleX, 32);
  ctx.rect(left + 197 * scaleX, ground - 79, 27 * scaleX, 32);
  ctx.moveTo(dx - b.side * 9, ground - 66);
  ctx.lineTo(dx + b.side * 5, ground - 61);
  ctx.lineTo(dx + b.side * 5, ground - 7);
  ctx.lineTo(dx - b.side * 9, ground - 7);
  ctx.closePath();
  ctx.clip("evenodd");
  ctx.globalAlpha = occupied ? 0.24 : 1;
  if (!drawSvg(ctx, `house/facade-${b.id}.svg`, left - overhang, ground - ROOF_HEIGHT, b.width + overhang * 2, ROOF_HEIGHT)) {
    ctx.fillStyle = "#63483c"; ctx.fillRect(left, ground - WALL_HEIGHT, b.width, WALL_HEIGHT - 10);
    ctx.fillStyle = "#252129"; ctx.beginPath(); ctx.moveTo(left - overhang, ground - WALL_HEIGHT + 2);
    ctx.lineTo(x, ground - ROOF_HEIGHT); ctx.lineTo(left + b.width + overhang, ground - WALL_HEIGHT + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#302827"; ctx.fillRect(left, ground - 10, b.width, 10);
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = occupied ? 0.78 : 1;
  if (!drawSvg(ctx, "house/windows.svg", left, ground - ROOF_HEIGHT, b.width, ROOF_HEIGHT)) {
    ctx.strokeStyle = "#c09878"; ctx.lineWidth = 2;
    for (const wx of [left + 61 * scaleX, left + 197 * scaleX]) {
      ctx.strokeRect(wx, ground - 79, 27 * scaleX, 32);
      ctx.beginPath(); ctx.moveTo(wx + 13.5 * scaleX, ground - 79); ctx.lineTo(wx + 13.5 * scaleX, ground - 47); ctx.stroke();
    }
  }
  ctx.restore();

  // A small warm spill communicates an open threshold without changing vision.
  if (opening > 0.01) {
    ctx.save(); ctx.fillStyle = `rgba(230,170,105,${opening * 0.16})`;
    ctx.beginPath(); ctx.ellipse(dx + b.side * 12, ground + 1, 28, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  ctx.save();
  ctx.translate(dx, ground - WALL_HEIGHT);
  ctx.scale(b.side, 1); // one side-profile asset serves left- and right-hand gables
  ctx.globalAlpha = occupied ? 0.86 : 1;
  if (!drawSvg(ctx, "house/door-frame.svg", -20, 0, 64, WALL_HEIGHT)) {
    ctx.strokeStyle = "#cba27f"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-9, 105); ctx.lineTo(-9, 46); ctx.lineTo(5, 51); ctx.lineTo(5, 105); ctx.stroke();
  }
  ctx.save(); ctx.globalAlpha *= 1 - opening;
  if (!drawSvg(ctx, "house/door-closed.svg", -20, 0, 64, WALL_HEIGHT)) {
    ctx.fillStyle = "#76513a"; ctx.fillRect(-8, 48, 12, 56);
  }
  ctx.restore();
  ctx.save(); ctx.globalAlpha *= opening;
  if (!drawSvg(ctx, "house/door-open.svg", -20, 0, 64, WALL_HEIGHT)) {
    ctx.fillStyle = "#8b6246"; ctx.beginPath(); ctx.moveTo(4, 51); ctx.lineTo(29, 59); ctx.lineTo(29, 105); ctx.lineTo(4, 105); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  if (!occupied) {
    ctx.save();
    if (!drawSvg(ctx, "house/sign.svg", x - 56, ground - 145, 112, 18)) {
      ctx.fillStyle = "rgba(39,27,32,.9)"; ctx.fillRect(x - 56, ground - 143, 112, 14);
    }
    ctx.font = "600 10px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "#f1d7b7"; ctx.fillText(b.name.toUpperCase(), x, ground - 132, 103); ctx.restore();
  }
}
