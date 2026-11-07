// One outdoor ward station: its structure, its broken or repaired state, the
// kit on the ground when supplied, and the state marker that floats above it.
import { drawBrokenWard, drawKit } from "../ward-art";
import type { Station } from "../types";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { drawChapel } from "./chapel";
import { drawMarker } from "./marker";

export function drawStation(f: Frame, env: DrawEnv, st: Station, x: number) {
  const { ctx, ground, t, now, snap } = f;
  const blackout = now < snap.blackoutUntil;
  // lanterns and lit windows burn brighter as the night deepens
  const night = snap.time?.mode === "past" ? 0.05 : Math.min(1, Math.max(0, snap.nightT ?? 0.2));
  const task = f.tasks.get(st.id);
  const broken = snap.phase === "lobby" || (!!task && !task.done);
  const supplied = !!task?.delivered;
  const flick = env.settings.graphics.flicker && !env.settings.graphics.reducedMotion && now - snap.flickerAt < 900 ? Math.random() * 0.6 : 0;
  const win = (wx: number, wy: number, ww: number, wh: number) => {
    const a = blackout || broken ? 0.02 : Math.max(0.05, (0.75 - flick) * (0.45 + 0.55 * night));
    ctx.save();
    ctx.shadowColor = "rgba(255,151,55,.75)"; env.glow(ctx, broken || blackout ? 0 : Math.round(5 + 10 * night));
    const glass = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    glass.addColorStop(0, `rgba(255,210,120,${a})`);
    glass.addColorStop(1, `rgba(210,91,35,${a * 0.82})`);
    ctx.fillStyle = glass;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(31,17,15,.9)"; ctx.lineWidth = 2;
    ctx.strokeRect(wx, wy, ww, wh);
    ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
    ctx.restore();
  };
  ctx.save();
  ctx.translate(x, ground);
  ctx.fillStyle = "#1e1310";
  switch (st.kind) {
    case "pumpkins": {
      ctx.fillStyle = "#241511";
      ctx.fillRect(-70, -70, 140, 70); // shed
      if (!broken) {
        ctx.beginPath(); ctx.moveTo(-80, -70); ctx.lineTo(0, -105); ctx.lineTo(80, -70); ctx.closePath(); ctx.fill();
      }
      win(-20, -50, 18, 20);
      for (const [px, pr] of (broken ? [] : [[-45, 12], [-20, 15], [8, 11], [34, 14], [55, 10]]) as readonly (readonly [number, number])[]) {
        ctx.fillStyle = "#b05a1a";
        ctx.beginPath(); ctx.ellipse(px, -pr * 0.7, pr, pr * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#7a3c10"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, -pr * 1.5); ctx.lineTo(px, 0); ctx.stroke();
        ctx.fillStyle = "#3a5a20"; ctx.fillRect(px - 2, -pr * 1.7, 4, 6);
      }
      break;
    }
    case "well": {
      ctx.fillStyle = "#3a3230";
      ctx.fillRect(-26, -30, 52, 30);
      ctx.fillStyle = "#241511";
      ctx.fillRect(-30, -78, 6, 50); ctx.fillRect(24, -78, 6, 50);
      if (!broken) { ctx.beginPath(); ctx.moveTo(-38, -76); ctx.lineTo(0, -98); ctx.lineTo(38, -76); ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle = "#5a4a30"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -76); ctx.lineTo(0, -44); ctx.stroke();
      ctx.fillStyle = "#4a3a28"; ctx.fillRect(-7, -46, 14, 12);
      break;
    }
    case "scarecrow": {
      ctx.strokeStyle = "#3a2a18"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -85); ctx.moveTo(-30, -62); ctx.lineTo(30, -62); ctx.stroke();
      ctx.fillStyle = "#6b5433";
      ctx.beginPath(); ctx.moveTo(-14, -60); ctx.lineTo(14, -60); ctx.lineTo(9, -25); ctx.lineTo(-9, -25); ctx.closePath(); ctx.fill();
      if (!broken) {
        ctx.fillStyle = "#c9a86a";
        ctx.beginPath(); ctx.arc(0, -92, 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#241511";
        ctx.beginPath(); ctx.moveTo(-16, -98); ctx.lineTo(16, -98); ctx.lineTo(0, -116); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#1a0f0a";
        ctx.beginPath(); ctx.arc(-4, -93, 1.8, 0, Math.PI * 2); ctx.arc(4, -93, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case "lantern": {
      if (!blackout && !broken && env.settings.graphics.glow) {
        const light = ctx.createRadialGradient(0, -92, 4, 0, -72, 112);
        light.addColorStop(0, `rgba(255,187,83,${0.10 + 0.18 * night})`); light.addColorStop(1, "rgba(255,145,45,0)");
        ctx.fillStyle = light; ctx.fillRect(-115, -205, 230, 220);
      }
      ctx.fillStyle = "#191420";
      if (broken) {
        ctx.strokeStyle = "#191420"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -72); ctx.lineTo(-19, -103); ctx.stroke();
      } else {
        ctx.fillRect(-3, -110, 6, 110);
        ctx.fillRect(-14, -112, 28, 5);
      }
      const glow = blackout || broken ? 0.03 : (0.3 + 0.45 * night) + Math.sin(t * 5) * 0.1 - flick;
      ctx.fillStyle = `rgba(255,190,90,${Math.max(0.03, glow)})`;
      ctx.shadowColor = "rgba(255,180,80,0.9)"; env.glow(ctx, blackout || broken ? 0 : Math.round(10 + 16 * night));
      ctx.fillRect(-8, -106, 16, 18);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#191420"; ctx.fillRect(-10, -108, 20, 3);
      break;
    }
    case "chapel": {
      drawChapel(ctx, broken, win);
      break;
    }
    case "mill": {
      ctx.fillStyle = "#20140f";
      ctx.fillRect(-80, -85, 160, 85);
      ctx.beginPath(); ctx.moveTo(-88, -85); ctx.lineTo(88, -85); ctx.lineTo(60, -115); ctx.lineTo(-60, -115); ctx.closePath(); ctx.fill();
      win(-50, -60, 20, 22); win(28, -60, 20, 22);
      ctx.save();
      ctx.translate(0, -50); ctx.rotate(broken ? 0 : t * 0.6);
      ctx.strokeStyle = "#4a3826"; ctx.lineWidth = 7;
      for (let i = 0; i < (broken ? 2 : 4); i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -44); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = "#0f0a08"; ctx.fillRect(-14, -40, 28, 40);
      break;
    }
    case "graves": {
      for (const [gx, gh, tilt] of [[-55, 34, -0.28], [-20, 42, 0.3], [18, 30, -0.36], [52, 38, 0.24]] as const) {
        ctx.save(); ctx.translate(gx, 0); ctx.rotate(broken ? tilt : 0);
        ctx.fillStyle = "#3d3a42";
        ctx.beginPath(); ctx.roundRect(-11, -gh, 22, gh, [10, 10, 0, 0]); ctx.fill();
        ctx.restore();
      }
      if (broken) {
        ctx.fillStyle = "#0a0605";
        ctx.beginPath(); ctx.ellipse(85, -2, 26, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#2a1c12";
        ctx.beginPath(); ctx.ellipse(108, -8, 14, 9, 0.3, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "#493120";
        ctx.beginPath(); ctx.ellipse(85, -2, 28, 6, 0, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case "radio": {
      ctx.strokeStyle = "#2c2833"; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-34, 0); ctx.lineTo(broken ? -16 : 0, broken ? -102 : -190);
      ctx.lineTo(broken ? 38 : 34, broken ? -72 : 0);
      ctx.moveTo(-24, -55); ctx.lineTo(24, -55);
      ctx.moveTo(-15, -110); ctx.lineTo(15, -110);
      ctx.moveTo(-24, -55); ctx.lineTo(15, -110); ctx.moveTo(24, -55); ctx.lineTo(-15, -110);
      ctx.stroke();
      const blink = broken ? 0.03 : Math.sin(t * 3) > 0 ? 0.9 : 0.2;
      ctx.fillStyle = `rgba(255,60,50,${blink})`;
      ctx.shadowColor = "#ff3c32"; env.glow(ctx, broken ? 0 : 12);
      ctx.beginPath(); ctx.arc(0, -194, 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      break;
    }
    case "silo": {
      ctx.fillStyle = "#332622";
      ctx.fillRect(-34, -140, 68, 140);
      ctx.beginPath(); ctx.arc(0, -140, 34, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 2;
      for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-34, -i * 28); ctx.lineTo(34, -i * 28); ctx.stroke(); }
      ctx.fillStyle = "#17100c"; ctx.fillRect(-12, -36, 24, 36);
      break;
    }
  }
  if (broken) drawBrokenWard(ctx, st.kind);
  ctx.restore();

  // A kit on the ground marks a ward that is ready for hands-on repair.
  if (task && !task.done && supplied) drawKit(ctx, x + 85, ground);

  // State marker for unfinished wards: missing kit or ready for repair.
  if (task && !task.done && snap.phase === "playing") {
    drawMarker(f, env, st, task, supplied, x);
  }
}
