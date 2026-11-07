// Ward stations and the road around them. Structures are SVG art (structures.ts); code draws
// only state: lit windows, lantern glow, radio lamp, turning sails, kits and markers.
import { MEETING_HOUSE as M } from "../units";
import { drawKit, drawSupplyCart } from "../ward-art";
import { STATIONS, type Station } from "../types";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { drawMarker } from "./marker";
import { drawStructure } from "./structures";

/** Chapel in the station frame; `win` lights a window (the station owns the lamp logic). */
function drawChapel(
  ctx: CanvasRenderingContext2D, broken: boolean,
  win: (wx: number, wy: number, ww: number, wh: number) => void,
) {
  const { width: W, wallHeight: H, windowWidth: WW, windowHeight: WH, doorWidth: DW, doorHeight: DH } = M;
  drawStructure(ctx, "chapel", broken ? "broken" : undefined);
  const winTop = -H + (H - WH) * 0.45;
  for (const wx of [-W / 2 + W * 0.14, W / 2 - W * 0.14 - WW]) win(wx, winTop, WW, WH);
  win(-DW / 2, -DH - 16, DW, 12);
  drawStructure(ctx, "chapel", "trim");
}

/** Outdoor stations. House work is painted as part of its interior, so it is skipped here. */
export function drawStations(f: Frame, env: DrawEnv) {
  const { w, cam } = f;
  for (const st of STATIONS) {
    if (st.inside) continue; // house work is painted as part of its interior
    const sx = st.x - cam;
    if (sx > -280 && sx < w + 280) drawStation(f, env, st, sx);
  }
}

/** The supply cart with its pushers' label, then any supply kits lying on the road. */
export function drawCartAndKits(f: Frame) {
  const { ctx, w, cam, ground, snap } = f;
  const cartScreenX = snap.cartX - cam;
  if (cartScreenX > -90 && cartScreenX < w + 90) {
    drawSupplyCart(ctx, cartScreenX, ground);
    if (snap.cartPushers > 0) {
      ctx.save();
      ctx.font = "bold 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#e9dfcf";
      ctx.fillText(`${snap.cartPushers} PUSHING`, cartScreenX, ground - 89);
      ctx.restore();
    }
  }
  for (const drop of snap.supplyDrops) {
    const sx = drop - cam;
    if (sx > -45 && sx < w + 45) drawKit(ctx, sx, ground);
  }
}

export function drawStation(f: Frame, env: DrawEnv, st: Station, x: number) {
  const { ctx, ground, t, now, snap } = f;
  const blackout = now < snap.blackoutUntil;
  // lanterns and lit windows burn brighter as the night deepens
  const night = snap.time?.mode === "past" ? 0.05 : Math.min(1, Math.max(0, snap.nightT ?? 0.2));
  const task = f.tasks.get(st.id);
  const broken = snap.phase === "lobby" || (!!task && !task.done);
  const supplied = !!task?.delivered;
  const flick = env.settings.graphics.flicker && !env.settings.graphics.reducedMotion && now - snap.flickerAt < 900 ? Math.random() * 0.6 : 0;
  const variant = broken ? "broken" : undefined;
  // A lit pane: glass and glow only. The frame and muntins are drawn over it by the structure's trim art.
  const win = (wx: number, wy: number, ww: number, wh: number) => {
    const a = blackout || broken ? 0.02 : Math.max(0.05, (0.75 - flick) * (0.45 + 0.55 * night));
    ctx.save();
    ctx.shadowColor = "rgba(255,151,55,.75)"; env.glow(ctx, broken || blackout ? 0 : Math.round(5 + 10 * night));
    const glass = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    glass.addColorStop(0, `rgba(255,210,120,${a})`);
    glass.addColorStop(1, `rgba(210,91,35,${a * 0.82})`);
    ctx.fillStyle = glass;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.restore();
  };
  ctx.save();
  ctx.translate(x, ground);
  switch (st.kind) {
    case "pumpkins": {
      drawStructure(ctx, "pumpkin-shed", variant);
      win(-20, -50, 18, 20);
      drawStructure(ctx, "pumpkin-shed", "trim");
      break;
    }
    case "well": {
      drawStructure(ctx, "well", variant);
      break;
    }
    case "scarecrow": {
      drawStructure(ctx, "scarecrow", variant);
      break;
    }
    case "lantern": {
      if (!blackout && !broken && env.settings.graphics.glow) {
        const light = ctx.createRadialGradient(0, -92, 4, 0, -72, 112);
        light.addColorStop(0, `rgba(255,187,83,${0.10 + 0.18 * night})`); light.addColorStop(1, "rgba(255,145,45,0)");
        ctx.fillStyle = light; ctx.fillRect(-115, -205, 230, 220);
      }
      drawStructure(ctx, "lantern", variant);
      const glow = blackout || broken ? 0.03 : (0.3 + 0.45 * night) + Math.sin(t * 5) * 0.1 - flick;
      ctx.fillStyle = `rgba(255,190,90,${Math.max(0.03, glow)})`;
      ctx.shadowColor = "rgba(255,180,80,0.9)"; env.glow(ctx, blackout || broken ? 0 : Math.round(10 + 16 * night));
      ctx.fillRect(-8, -106, 16, 18);
      ctx.shadowBlur = 0;
      break;
    }
    case "chapel": {
      drawChapel(ctx, broken, win);
      break;
    }
    case "mill": {
      drawStructure(ctx, "mill", variant);
      win(-50, -60, 20, 22); win(28, -60, 20, 22);
      drawStructure(ctx, "mill", "trim");
      ctx.save();
      ctx.translate(0, -50); ctx.rotate(broken ? 0 : t * 0.6);
      drawStructure(ctx, "mill-sails", variant);
      ctx.restore();
      break;
    }
    case "graves": {
      drawStructure(ctx, "graves", variant);
      break;
    }
    case "radio": {
      drawStructure(ctx, "radio", variant);
      const blink = broken ? 0.03 : Math.sin(t * 3) > 0 ? 0.9 : 0.2;
      ctx.fillStyle = `rgba(255,60,50,${blink})`;
      ctx.shadowColor = "#ff3c32"; env.glow(ctx, broken ? 0 : 12);
      ctx.beginPath(); ctx.arc(0, -194, 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      break;
    }
    case "silo": {
      drawStructure(ctx, "silo", variant);
      break;
    }
  }
  ctx.restore();

  // A kit on the ground marks a ward that is ready for hands-on repair.
  if (task && !task.done && supplied) drawKit(ctx, x + 85, ground);

  // State marker for unfinished wards: missing kit or ready for repair.
  if (task && !task.done && snap.phase === "playing") {
    drawMarker(f, env, st, task, supplied, x);
  }
}
