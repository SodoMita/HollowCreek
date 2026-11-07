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
  drawSvg(ctx, "house/interior.svg", left, ground - WALL_HEIGHT, b.width, WALL_HEIGHT);
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
  drawSvg(ctx, `house/facade-${b.id}.svg`, left - overhang, ground - ROOF_HEIGHT, b.width + overhang * 2, ROOF_HEIGHT);
  ctx.restore();

  // Warm window light spilling onto the road in front of the house.
  if (!occupied) {
    for (const wxs of [61, 197]) {
      const cx = left + (wxs + 13.5) * scaleX;
      const g = ctx.createRadialGradient(cx, ground + 4, 2, cx, ground + 4, 46 * scaleX + 18);
      g.addColorStop(0, "rgba(255,178,92,0.20)");
      g.addColorStop(1, "rgba(255,178,92,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cx, ground + 6, 46 * scaleX + 18, 12, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  ctx.save();
  ctx.globalAlpha = occupied ? 0.78 : 1;
  drawSvg(ctx, "house/windows.svg", left, ground - ROOF_HEIGHT, b.width, ROOF_HEIGHT);
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
  drawSvg(ctx, "house/door-frame.svg", -20, 0, 64, WALL_HEIGHT);
  ctx.save(); ctx.globalAlpha *= 1 - opening;
  drawSvg(ctx, "house/door-closed.svg", -20, 0, 64, WALL_HEIGHT);
  ctx.restore();
  ctx.save(); ctx.globalAlpha *= opening;
  drawSvg(ctx, "house/door-open.svg", -20, 0, 64, WALL_HEIGHT);
  ctx.restore();
  ctx.restore();

  if (!occupied) {
    ctx.save();
    drawSvg(ctx, "house/sign.svg", x - 56, ground - 145, 112, 18);
    ctx.font = "600 10px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "#f1d7b7"; ctx.fillText(b.name.toUpperCase(), x, ground - 132, 103); ctx.restore();
  }
}
