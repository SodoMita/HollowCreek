// Outdoor ward stations: structures in their broken or repaired state, pre-baked
// lit glass panes, radio LED and floating work markers. Zero per-frame gradients,
// path builds, or text calls.
import { drawSvg } from "../svg-assets";
import { STATIONS, type Station, type TaskView } from "../types";
import { MEETING_HOUSE } from "../units";
import { cachedSprite, light, makeCanvas } from "./paint";
import { drawKit } from "./props";
import { clamp, type View } from "./view";

let paneSprite: HTMLCanvasElement | null = null;
function getPaneSprite(): HTMLCanvasElement {
  if (paneSprite) return paneSprite;
  const c = makeCanvas(4, 32);
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, "rgb(255,210,120)");
  grad.addColorStop(1, "rgb(210,91,35)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 32);
  paneSprite = c;
  return c;
}

let radioLed: HTMLCanvasElement | null = null;
function getRadioLed(): HTMLCanvasElement {
  if (radioLed) return radioLed;
  const c = makeCanvas(16, 16);
  const g = c.getContext("2d")!;
  g.fillStyle = "#ff3c32";
  g.beginPath();
  g.arc(8, 8, 4, 0, Math.PI * 2);
  g.fill();
  radioLed = c;
  return c;
}

function getDiamondSprite(color: string): HTMLCanvasElement {
  return cachedSprite(`diamond:${color}`, 8, () => {
    const c = makeCanvas(24, 24);
    const g = c.getContext("2d")!;
    g.fillStyle = color;
    g.translate(12, 12);
    g.rotate(Math.PI / 4);
    g.fillRect(-7, -7, 14, 14);
    return c;
  });
}

function getMarkerBadge(label: string, color: string): HTMLCanvasElement {
  return cachedSprite(`m:${label}:${color}`, 8, () => {
    const c = makeCanvas(192, 32);
    const g = c.getContext("2d")!;
    g.scale(2, 2);
    g.fillStyle = "rgba(12,8,16,.78)";
    g.fillRect(0, 0, 96, 16);
    g.font = "bold 10px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillStyle = color;
    g.fillText(label, 48, 12);
    return c;
  });
}

export function drawStations(v: View) {
  for (const st of STATIONS) {
    if (st.inside) continue;
    const sx = st.x - v.cam;
    if (sx > -280 && sx < v.w + 280) drawStation(v, st, sx);
  }
}

function drawPane(v: View, x: number, y: number, w: number, h: number, lit: boolean, a: number) {
  const { ctx, glow, night } = v;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * a;
  ctx.drawImage(getPaneSprite(), x, y, w, h);
  ctx.globalAlpha = prev;
  if (lit && glow) light(ctx, x + w / 2, y + h / 2, w * 0.9 + 6, h * 0.6 + 6, "255,151,55", 0.22 + 0.2 * night);
}

function drawStation(v: View, st: Station, x: number) {
  const { ctx, ground, t, now, snap, glow } = v;
  const blackout = now < snap.blackoutUntil;
  const night = snap.time?.mode === "past" ? 0.05 : clamp(snap.nightT ?? 0.2, 0, 1);
  const task = v.tasks.get(st.id);
  const broken = snap.phase === "lobby" || (!!task && !task.done);
  const supplied = !!task?.delivered;
  const flick = v.flicker && !v.reduced && now - snap.flickerAt < 900 ? Math.random() * 0.6 : 0;
  const lit = !blackout && !broken;
  const paneAlpha = blackout || broken ? 0.02 : Math.max(0.05, (0.75 - flick) * (0.45 + 0.55 * night));

  switch (st.kind) {
    case "pumpkins": {
      drawSvg(ctx, broken ? "structures/pumpkin-shed-broken.svg" : "structures/pumpkin-shed.svg", x - 90, ground - 110, 180, 116);
      drawPane(v, x - 20, ground - 50, 18, 20, lit, paneAlpha);
      drawSvg(ctx, "structures/pumpkin-shed-trim.svg", x - 90, ground - 110, 180, 116);
      break;
    }
    case "well":
      drawSvg(ctx, broken ? "structures/well-broken.svg" : "structures/well.svg", x - 60, ground - 100, 120, 106);
      break;
    case "scarecrow":
      drawSvg(ctx, broken ? "structures/scarecrow-broken.svg" : "structures/scarecrow.svg", x - 60, ground - 120, 120, 124);
      break;
    case "lantern": {
      if (lit && glow) light(ctx, x, ground - 78, 112, 110, "255,187,83", 0.1 + 0.18 * night);
      drawSvg(ctx, broken ? "structures/lantern-broken.svg" : "structures/lantern.svg", x - 40, ground - 115, 80, 119);
      const flame = blackout || broken ? 0.03 : 0.3 + 0.45 * night + Math.sin(t * 5) * 0.1 - flick;
      if (lit && glow) light(ctx, x, ground - 97, 18, 18, "255,180,80", 0.7);
      ctx.fillStyle = `rgba(255,190,90,${Math.max(0.03, flame)})`;
      ctx.fillRect(x - 8, ground - 106, 16, 18);
      break;
    }
    case "chapel": {
      const M = MEETING_HOUSE;
      drawSvg(ctx, broken ? "structures/chapel-broken.svg" : "structures/chapel.svg", x - 140, ground - 470, 280, 476);
      const winTop = ground - M.wallHeight + (M.wallHeight - M.windowHeight) * 0.45;
      drawPane(v, x - M.width / 2 + M.width * 0.14, winTop, M.windowWidth, M.windowHeight, lit, paneAlpha);
      drawPane(v, x + M.width / 2 - M.width * 0.14 - M.windowWidth, winTop, M.windowWidth, M.windowHeight, lit, paneAlpha);
      drawPane(v, x - M.doorWidth / 2, ground - M.doorHeight - 16, M.doorWidth, 12, lit, paneAlpha);
      drawSvg(ctx, "structures/chapel-trim.svg", x - 140, ground - 470, 280, 476);
      break;
    }
    case "mill": {
      drawSvg(ctx, broken ? "structures/mill-broken.svg" : "structures/mill.svg", x - 95, ground - 120, 190, 124);
      drawPane(v, x - 50, ground - 60, 20, 22, lit, paneAlpha);
      drawPane(v, x + 28, ground - 60, 20, 22, lit, paneAlpha);
      drawSvg(ctx, "structures/mill-trim.svg", x - 95, ground - 120, 190, 124);
      ctx.save();
      ctx.translate(x, ground - 50);
      if (!broken) ctx.rotate(t * 0.6);
      drawSvg(ctx, broken ? "structures/mill-sails-broken.svg" : "structures/mill-sails.svg", -46, -46, 92, 92);
      ctx.restore();
      break;
    }
    case "graves":
      drawSvg(ctx, broken ? "structures/graves-broken.svg" : "structures/graves.svg", x - 75, ground - 50, 200, 60);
      break;
    case "radio": {
      drawSvg(ctx, broken ? "structures/radio-broken.svg" : "structures/radio.svg", x - 70, ground - 210, 140, 214);
      const blink = broken ? 0.03 : Math.sin(t * 3) > 0 ? 0.9 : 0.2;
      if (!broken && glow) light(ctx, x, ground - 194, 12, 12, "255,60,50", 0.6);
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * blink;
      ctx.drawImage(getRadioLed(), x - 8, ground - 202);
      ctx.globalAlpha = prev;
      break;
    }
    case "silo":
      drawSvg(ctx, broken ? "structures/silo-broken.svg" : "structures/silo.svg", x - 45, ground - 180, 90, 184);
      break;
  }

  if (task && !task.done && supplied) drawKit(ctx, x + 85, ground);
  if (task && !task.done && snap.phase === "playing") drawMarker(v, st, task, supplied, x);
}

function drawMarker(v: View, st: Station, task: TaskView, supplied: boolean, x: number) {
  const { ctx, ground, t, glassUp, glow } = v;
  const M = MEETING_HOUSE;
  const bob = Math.sin(t * 3 + st.x) * 4;
  const markerY = ground - (st.kind === "chapel" ? M.wallHeight + M.roofRise + M.towerBase - 18 : 235);
  const color = supplied ? "#b3d59a" : task.sabotaged ? "#d87762" : "#ffcd5a";
  const cy = markerY + bob;
  if (glow) light(ctx, x, cy, 14, 14, supplied ? "114,154,101" : "255,205,90", 0.55);
  ctx.drawImage(getDiamondSprite(color), x - 12, cy - 12);
  if (!glassUp) {
    const label = supplied ? "PUZZLE" : task.sabotaged ? "SABOTAGED" : "NEEDS KIT";
    ctx.drawImage(getMarkerBadge(label, color), x - 48, markerY - 24, 96, 16);
  }
  if (task.progress > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x - 30, markerY + 20, 60, 8);
    ctx.fillStyle = "#ffcd5a";
    ctx.fillRect(x - 29, markerY + 21, 58 * task.progress, 6);
  }
}
