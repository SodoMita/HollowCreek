// Houses: the interior cutaway (painted before the people) and the exterior
// (painted after the people inside, so an occupied house reads as a cutaway).
import { BUILDINGS, doorX, type Building } from "../buildings";
import { drawSvg, roomItems, spriteFor } from "../svg-assets";
import { light, makeCanvas } from "./paint";
import { drawNote } from "./notes";
import type { TaskView } from "../types";
import { clamp, type View } from "./view";

const WALL_HEIGHT = 112;
const ROOF_HEIGHT = 158;

/** Facades with the windows and doorway already cut out, baked once per house and size.
 *  The old renderer clipped every facade with an even-odd path on every frame. */
const cutaways = new Map<string, HTMLCanvasElement>();

function cutawayFacade(b: Building, facade: HTMLCanvasElement, boxW: number, overhang: number, scaleX: number): HTMLCanvasElement {
  const key = `${b.id}|${facade.width}x${facade.height}`;
  const hit = cutaways.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(facade.width, facade.height);
  const g = canvas.getContext("2d")!;
  g.drawImage(facade, 0, 0);
  // Coordinates below are relative to the facade box's top-left corner, in world units.
  const kx = facade.width / boxW;
  const ky = facade.height / ROOF_HEIGHT;
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  for (const wxs of [61, 197]) g.rect((overhang + wxs * scaleX) * kx, 79 * ky, 27 * scaleX * kx, 32 * ky);
  const dxr = doorX(b) - b.x + b.width / 2 + overhang;
  g.moveTo((dxr - b.side * 9) * kx, 92 * ky);
  g.lineTo((dxr + b.side * 5) * kx, 97 * ky);
  g.lineTo((dxr + b.side * 5) * kx, 151 * ky);
  g.lineTo((dxr - b.side * 9) * kx, 151 * ky);
  g.closePath();
  g.fill();
  if (cutaways.size > 24) cutaways.clear();
  cutaways.set(key, canvas);
  return canvas;
}

/** Interiors and the pages pinned on their walls. */
export function drawHouseInteriors(v: View) {
  const { ctx, w, cam, ground } = v;
  for (const b of BUILDINGS) {
    const sx = b.x - cam;
    if (sx < -b.width || sx > w + b.width) continue;
    drawInterior(v, b, sx, ground, v.houseTask.get(b.id), v.occupied.has(b.id));
    for (const note of v.notesByHouse.get(b.id) ?? []) {
      const nx = note.x - cam;
      if (nx < -100 || nx > w + 100) continue;
      drawNote(v, nx, "wall", v.focusX === note.x, note);
    }
  }
}

function drawInterior(v: View, b: Building, x: number, ground: number, task: TaskView | undefined, occupied: boolean) {
  const { ctx } = v;
  const left = x - b.width / 2;
  // A contact shadow ties the building to the road.
  ctx.fillStyle = "rgba(4,3,6,.38)";
  ctx.beginPath();
  ctx.ellipse(x, ground + 2, b.width * 0.52, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  drawSvg(ctx, "house/interior.svg", left, ground - WALL_HEIGHT, b.width, WALL_HEIGHT);
  for (const item of roomItems(b.id)) {
    if (item.when === "done" && !task?.done) continue;
    if (item.when === "unfinished" && task?.done) continue;
    drawSvg(ctx, item.asset, x + item.x, ground + item.y, item.width, item.height);
  }
  // The work marker follows the authoritative task coordinate.
  if (occupied && task && !task.done) {
    const workX = x + task.x - b.x;
    if (v.glow) light(ctx, workX, ground - 90, 14, 14, "217,154,61", 0.5);
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = task.delivered ? "#f0c276" : "#dc8a64";
    ctx.fillText("◇", workX, ground - 90);
  }
}

/** Exteriors, doors, and the barrel and crate by each door. Doors swing toward their open
 *  amount over time, tracked per house in `doorOpen`. */
export function drawHouseExteriors(v: View, doorOpen: Map<string, number>) {
  const { ctx, w, dt, cam, ground } = v;
  for (const b of BUILDINGS) {
    const sx = b.x - cam;
    if (!(sx > -b.width && sx < w + b.width)) continue;
    const door = v.doors.get(b.id);
    const target = door?.open ? 1 : 0;
    const previous = doorOpen.get(b.id) ?? target;
    const amount = v.reduced ? target : previous + (target - previous) * Math.min(1, dt * 10);
    doorOpen.set(b.id, amount);
    drawSvg(ctx, "furniture/barrel.svg", sx - b.width / 2 - 30, ground - 34, 26, 34);
    drawSvg(ctx, "furniture/crate.svg", sx + b.width / 2 + 8, ground - 26, 30, 26);
    drawExterior(v, b, sx, v.occupied.has(b.id), amount);
  }
}

function drawExterior(v: View, b: Building, x: number, occupied: boolean, openAmount: number) {
  const { ctx, ground, glow } = v;
  const left = x - b.width / 2;
  const scaleX = b.width / 300;
  const overhang = 16 * scaleX;
  const boxW = b.width + overhang * 2;
  const dx = doorX(b) - b.x + x;
  const opening = clamp(openAmount, 0, 1);
  const base = ctx.globalAlpha;

  // Warm light from each unshuttered window, spilling onto the road.
  if (!occupied && glow) {
    for (const wxs of [61, 197]) {
      light(ctx, left + (wxs + 13.5) * scaleX, ground + 6, 46 * scaleX + 18, 12, "255,178,92", 0.2);
    }
  }

  const facade = spriteFor(`house/facade-${b.id}.svg`, boxW, ROOF_HEIGHT);
  if (facade) {
    ctx.globalAlpha = base * (occupied ? 0.24 : 1);
    ctx.drawImage(cutawayFacade(b, facade, boxW, overhang, scaleX), left - overhang, ground - ROOF_HEIGHT, boxW, ROOF_HEIGHT);
  }
  ctx.globalAlpha = base * (occupied ? 0.78 : 1);
  drawSvg(ctx, "house/windows.svg", left, ground - ROOF_HEIGHT, b.width, ROOF_HEIGHT);
  ctx.globalAlpha = base;

  // A small warm spill marks an open threshold.
  if (opening > 0.01) {
    ctx.fillStyle = `rgba(230,170,105,${opening * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(dx + b.side * 12, ground + 1, 28, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Door frame, with the closed and open leaves cross-faded by the swing amount.
  ctx.save();
  ctx.translate(dx, ground - WALL_HEIGHT);
  ctx.scale(b.side, 1); // one side-profile asset serves both gables
  const doorAlpha = occupied ? 0.86 : 1;
  ctx.globalAlpha = base * doorAlpha;
  drawSvg(ctx, "house/door-frame.svg", -20, 0, 64, WALL_HEIGHT);
  ctx.globalAlpha = base * doorAlpha * (1 - opening);
  drawSvg(ctx, "house/door-closed.svg", -20, 0, 64, WALL_HEIGHT);
  ctx.globalAlpha = base * doorAlpha * opening;
  drawSvg(ctx, "house/door-open.svg", -20, 0, 64, WALL_HEIGHT);
  ctx.restore();
  ctx.globalAlpha = base;

  if (!occupied) {
    drawSvg(ctx, "house/sign.svg", x - 56, ground - 145, 112, 18);
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#f1d7b7";
    ctx.fillText(b.name.toUpperCase(), x, ground - 132, 103);
  }
}
