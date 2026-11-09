// Houses: interior cutaway (painted before the people inside) and exterior
// (painted after the people inside). Facade cutouts and nameplate signs are
// baked once per house so per-frame work is plain bitmap copies.
import { BUILDINGS, doorX, type Building } from "../buildings";
import { drawSvg, roomItems, spriteFor } from "../svg-assets";
import type { TaskView } from "../types";
import { cachedSprite, drawShadowOval, drawWarmOval, light, makeCanvas } from "./paint";
import { drawNote } from "./notes";
import { clamp, type View } from "./view";

const WALL_HEIGHT = 112;
const ROOF_HEIGHT = 158;

const cutaways = new Map<string, HTMLCanvasElement>();

function cutawayFacade(b: Building, facade: HTMLCanvasElement, boxW: number, overhang: number, scaleX: number): HTMLCanvasElement {
  const key = `${b.id}|${facade.width}x${facade.height}`;
  const hit = cutaways.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(facade.width, facade.height);
  const g = canvas.getContext("2d")!;
  g.drawImage(facade, 0, 0);
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
  if (cutaways.size >= 36) cutaways.delete(cutaways.keys().next().value as string);
  cutaways.set(key, canvas);
  return canvas;
}

function signSprite(b: Building): HTMLCanvasElement | null {
  const bg = spriteFor("house/sign.svg", 112, 18);
  if (!bg) return null;
  return cachedSprite(`hsign:${b.id}`, 16, () => {
    const c = makeCanvas(224, 36);
    const g = c.getContext("2d")!;
    g.drawImage(bg, 0, 0, 224, 36);
    g.scale(2, 2);
    g.font = "600 10px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillStyle = "#f1d7b7";
    g.fillText(b.name.toUpperCase(), 56, 13, 103);
    return c;
  });
}

export function drawHouseInteriors(v: View) {
  const { w, cam, ground } = v;
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
  drawShadowOval(ctx, x, ground - 1, b.width * 0.52, 6, 0.38);
  drawSvg(ctx, "house/interior.svg", left, ground - WALL_HEIGHT, b.width, WALL_HEIGHT);
  for (const item of roomItems(b.id)) {
    if (item.when === "done" && !task?.done) continue;
    if (item.when === "unfinished" && task?.done) continue;
    drawSvg(ctx, item.asset, x + item.x, ground + item.y, item.width, item.height);
  }
  if (occupied && task && !task.done) {
    const workX = x + task.x - b.x;
    if (v.glow) light(ctx, workX, ground - 90, 14, 14, "217,154,61", 0.5);
    const color = task.delivered ? "#f0c276" : "#dc8a64";
    const diamond = cachedSprite(`indiamond:${color}`, 4, () => {
      const c = makeCanvas(32, 32);
      const g = c.getContext("2d")!;
      g.scale(2, 2);
      g.font = "bold 13px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = color;
      g.fillText("◇", 8, 8);
      return c;
    });
    ctx.drawImage(diamond, workX - 8, ground - 101, 16, 16);
  }
}

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

  if (opening > 0.01) drawWarmOval(ctx, dx + b.side * 12, ground + 1, 28, 5, opening * 0.16);

  // Side-profile door sprites are pre-mirrored when b.side === -1 (zero save/scale/restore).
  const flip = b.side < 0;
  const doorLeft = flip ? dx - 44 : dx - 20;
  const doorTop = ground - WALL_HEIGHT;
  const doorAlpha = occupied ? 0.86 : 1;
  ctx.globalAlpha = base * doorAlpha;
  drawSvg(ctx, "house/door-frame.svg", doorLeft, doorTop, 64, WALL_HEIGHT, flip);
  if (opening < 0.99) {
    ctx.globalAlpha = base * doorAlpha * (1 - opening);
    drawSvg(ctx, "house/door-closed.svg", doorLeft, doorTop, 64, WALL_HEIGHT, flip);
  }
  if (opening > 0.01) {
    ctx.globalAlpha = base * doorAlpha * opening;
    drawSvg(ctx, "house/door-open.svg", doorLeft, doorTop, 64, WALL_HEIGHT, flip);
  }
  ctx.globalAlpha = base;

  if (!occupied) {
    const sign = signSprite(b);
    if (sign) ctx.drawImage(sign, x - 56, ground - 145, 112, 18);
  }
}
