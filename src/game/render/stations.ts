// Outdoor ward stations (repairs out of doors): the structure in its broken or
// repaired state, lit windows and lamps, the kit on the ground when supplied, and
// the marker that floats above unfinished work.
import { STATIONS, type Station, type TaskView } from "../types";
import { MEETING_HOUSE } from "../units";
import { light } from "./paint";
import { drawKit, drawStructure } from "./props";
import { clamp, type View } from "./view";

/** Outdoor stations. House work is painted as part of its interior, so it is skipped here. */
export function drawStations(v: View) {
  for (const st of STATIONS) {
    if (st.inside) continue;
    const sx = st.x - v.cam;
    if (sx > -280 && sx < v.w + 280) drawStation(v, st, sx);
  }
}

type Win = (wx: number, wy: number, ww: number, wh: number) => void;

function drawStation(v: View, st: Station, x: number) {
  const { ctx, ground, t, now, snap, glow } = v;
  const blackout = now < snap.blackoutUntil;
  const night = snap.time?.mode === "past" ? 0.05 : clamp(snap.nightT ?? 0.2, 0, 1);
  const task = v.tasks.get(st.id);
  const broken = snap.phase === "lobby" || (!!task && !task.done);
  const supplied = !!task?.delivered;
  const flick = v.settings.graphics.flicker && !v.reduced && now - snap.flickerAt < 900 ? Math.random() * 0.6 : 0;
  const variant = broken ? "broken" : undefined;
  const lit = !blackout && !broken;

  // A lit pane: glass and glow only. The frame and muntins come from the trim art.
  const win: Win = (wx, wy, ww, wh) => {
    const a = blackout || broken ? 0.02 : Math.max(0.05, (0.75 - flick) * (0.45 + 0.55 * night));
    const g = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    g.addColorStop(0, `rgba(255,210,120,${a})`);
    g.addColorStop(1, `rgba(210,91,35,${a * 0.82})`);
    ctx.fillStyle = g;
    ctx.fillRect(wx, wy, ww, wh);
    if (lit && glow) light(ctx, wx + ww / 2, wy + wh / 2, ww * 0.9 + 6, wh * 0.6 + 6, "255,151,55", 0.22 + 0.2 * night);
  };

  ctx.save();
  ctx.translate(x, ground);
  switch (st.kind) {
    case "pumpkins":
      drawStructure(ctx, "pumpkin-shed", variant);
      win(-20, -50, 18, 20);
      drawStructure(ctx, "pumpkin-shed", "trim");
      break;
    case "well":
      drawStructure(ctx, "well", variant);
      break;
    case "scarecrow":
      drawStructure(ctx, "scarecrow", variant);
      break;
    case "lantern": {
      if (lit && glow) light(ctx, 0, -78, 112, 110, "255,187,83", 0.1 + 0.18 * night);
      drawStructure(ctx, "lantern", variant);
      const flame = blackout || broken ? 0.03 : 0.3 + 0.45 * night + Math.sin(t * 5) * 0.1 - flick;
      if (lit && glow) light(ctx, 0, -97, 18, 18, "255,180,80", 0.7);
      ctx.fillStyle = `rgba(255,190,90,${Math.max(0.03, flame)})`;
      ctx.fillRect(-8, -106, 16, 18);
      break;
    }
    case "chapel":
      drawChapel(v, broken, win);
      break;
    case "mill":
      drawStructure(ctx, "mill", variant);
      win(-50, -60, 20, 22);
      win(28, -60, 20, 22);
      drawStructure(ctx, "mill", "trim");
      ctx.save();
      ctx.translate(0, -50);
      ctx.rotate(broken ? 0 : t * 0.6);
      drawStructure(ctx, "mill-sails", variant);
      ctx.restore();
      break;
    case "graves":
      drawStructure(ctx, "graves", variant);
      break;
    case "radio": {
      drawStructure(ctx, "radio", variant);
      const blink = broken ? 0.03 : Math.sin(t * 3) > 0 ? 0.9 : 0.2;
      if (!broken && glow) light(ctx, 0, -194, 12, 12, "255,60,50", 0.6);
      ctx.fillStyle = `rgba(255,60,50,${blink})`;
      ctx.beginPath();
      ctx.arc(0, -194, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "silo":
      drawStructure(ctx, "silo", variant);
      break;
  }
  ctx.restore();

  // A kit on the ground marks a ward ready for hands-on repair.
  if (task && !task.done && supplied) drawKit(ctx, x + 85, ground);
  if (task && !task.done && snap.phase === "playing") drawMarker(v, st, task, supplied, x);
}

/** The meeting house: a white-clapboard chapel with belfry and spire, the tallest thing on the street.
 *  The lit glass is drawn between the two layers of the chapel art. */
function drawChapel(v: View, broken: boolean, win: Win) {
  const { ctx } = v;
  const M = MEETING_HOUSE;
  drawStructure(ctx, "chapel", broken ? "broken" : undefined);
  const winTop = -M.wallHeight + (M.wallHeight - M.windowHeight) * 0.45;
  for (const wx of [-M.width / 2 + M.width * 0.14, M.width / 2 - M.width * 0.14 - M.windowWidth]) {
    win(wx, winTop, M.windowWidth, M.windowHeight);
  }
  win(-M.doorWidth / 2, -M.doorHeight - 16, M.doorWidth, 12);
  drawStructure(ctx, "chapel", "trim");
}

/** The floating marker above unfinished work: a diamond, a status label, and progress once started. */
function drawMarker(v: View, st: Station, task: TaskView, supplied: boolean, x: number) {
  const { ctx, ground, t, glassUp, glow } = v;
  const M = MEETING_HOUSE;
  const bob = Math.sin(t * 3 + st.x) * 4;
  // The meeting house sign hangs beside the belfry: the spire tip is off-screen at the default zoom.
  const markerY = ground - (st.kind === "chapel" ? M.wallHeight + M.roofRise + M.towerBase - 18 : 235);
  const color = supplied ? "#b3d59a" : task.sabotaged ? "#d87762" : "#ffcd5a";
  const cy = markerY + bob;
  if (glow) light(ctx, x, cy, 14, 14, supplied ? "114,154,101" : "255,205,90", 0.55);
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(x, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-7, -7, 14, 14);
  ctx.restore();
  if (!glassUp) {
    ctx.fillStyle = "rgba(12,8,16,.78)";
    ctx.fillRect(x - 48, markerY - 24, 96, 16);
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(supplied ? "PUZZLE" : task.sabotaged ? "SABOTAGED" : "NEEDS KIT", x, markerY - 12);
  }
  if (task.progress > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x - 30, markerY + 20, 60, 8);
    ctx.fillStyle = "#ffcd5a";
    ctx.fillRect(x - 29, markerY + 21, 58 * task.progress, 6);
  }
}
