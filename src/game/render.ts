// Canvas renderer for Hollow Creek — pure drawing, no game logic.
import {
  BELL_X, CAGE_XS, MEETING_FROM, MEETING_TO, STATIONS, WORLD_W,
} from "./types";
import type { Snapshot, Station } from "./types";

interface Leaf { x: number; y: number; vx: number; vy: number; r: number; c: string; s: number }

const LEAF_COLORS = ["#b4552a", "#c9762f", "#8f3b1f", "#d99a3d", "#7a4a21"];

export class Renderer {
  private leaves: Leaf[] = [];
  cameraX = 0;
  private visionR = 420;

  constructor() {
    for (let i = 0; i < 70; i++) {
      this.leaves.push({
        x: Math.random() * WORLD_W,
        y: Math.random() * 600,
        vx: -12 - Math.random() * 25,
        vy: 18 + Math.random() * 30,
        r: Math.random() * Math.PI * 2,
        c: LEAF_COLORS[i % LEAF_COLORS.length],
        s: 3 + Math.random() * 4,
      });
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snap: Snapshot,
    displayX: Map<string, number>,
    t: number, // seconds
    dt: number
  ) {
    const me = snap.players.find((p) => p.id === snap.self.id);
    const meX = me ? displayX.get(me.id) ?? me.x : WORLD_W / 2;
    const targetCam = Math.max(0, Math.min(WORLD_W - w, meX - w / 2));
    this.cameraX += (targetCam - this.cameraX) * Math.min(1, dt * 6);
    if (WORLD_W < w) this.cameraX = (WORLD_W - w) / 2;
    const cam = this.cameraX;
    const ground = h * 0.78;
    const now = snap.now;

    // --- sky ---
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, "#120b1e");
    sky.addColorStop(0.5, "#33172b");
    sky.addColorStop(0.85, "#6e3320");
    sky.addColorStop(1, "#8a4a24");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, ground);

    // moon
    const mx = w * 0.78 - cam * 0.03;
    ctx.save();
    ctx.shadowColor = "rgba(240,225,190,0.8)";
    ctx.shadowBlur = 60;
    ctx.fillStyle = "#e8ddc0";
    ctx.beginPath();
    ctx.arc(mx, h * 0.18, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(180,170,140,0.5)";
    for (const [dx, dy, r] of [[-12, -8, 7], [10, 10, 5], [14, -14, 4]] as const) {
      ctx.beginPath(); ctx.arc(mx + dx, h * 0.18 + dy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // --- far hills ---
    ctx.fillStyle = "#1c1220";
    ctx.beginPath();
    ctx.moveTo(0, ground);
    for (let sx = 0; sx <= w; sx += 20) {
      const wx = sx + cam * 0.15;
      ctx.lineTo(sx, ground - 90 - Math.sin(wx * 0.004) * 45 - Math.sin(wx * 0.0013 + 3) * 60);
    }
    ctx.lineTo(w, ground);
    ctx.fill();

    // --- tree line (parallax) ---
    for (let i = 0; i < 60; i++) {
      const wx = i * 130 + ((i * 97) % 60);
      const sx = wx - cam * 0.45;
      if (sx < -80 || sx > w + 80) continue;
      const th = 70 + ((i * 53) % 50);
      ctx.fillStyle = "#241318";
      ctx.fillRect(sx - 3, ground - th, 6, th);
      ctx.fillStyle = i % 3 === 0 ? "#4a2417" : i % 3 === 1 ? "#552d14" : "#3c1f16";
      ctx.beginPath();
      ctx.arc(sx, ground - th - 12, 26 + ((i * 31) % 14), 0, Math.PI * 2);
      ctx.arc(sx - 18, ground - th + 4, 18, 0, Math.PI * 2);
      ctx.arc(sx + 18, ground - th + 4, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- ground ---
    const gg = ctx.createLinearGradient(0, ground, 0, h);
    gg.addColorStop(0, "#2b1a12");
    gg.addColorStop(0.12, "#1d120c");
    gg.addColorStop(1, "#0d0806");
    ctx.fillStyle = gg;
    ctx.fillRect(0, ground, w, h - ground);
    // road line + leaf piles
    ctx.strokeStyle = "rgba(200,150,90,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, ground + 26); ctx.lineTo(w, ground + 26); ctx.stroke();
    ctx.fillStyle = "rgba(160,90,40,0.25)";
    for (let i = 0; i < 50; i++) {
      const sx = i * 190 + ((i * 71) % 90) - cam;
      if (sx < -60 || sx > w + 60) continue;
      ctx.beginPath(); ctx.ellipse(sx, ground + 8, 30, 6, 0, 0, Math.PI * 2); ctx.fill();
    }

    // meeting square highlight
    if (snap.phase === "meeting") {
      const a = 0.08 + Math.sin(t * 3) * 0.03;
      ctx.fillStyle = `rgba(255,200,100,${a})`;
      ctx.fillRect(MEETING_FROM - cam, ground - 200, MEETING_TO - MEETING_FROM, 200 + 40);
    }

    // --- stations / buildings ---
    for (const st of STATIONS) this.drawStation(ctx, st, st.x - cam, ground, t, now, snap);

    // --- bell tower ---
    this.drawBellTower(ctx, BELL_X - cam, ground, t, now - snap.bellAt < 4000);

    // --- cages (back frame) ---
    for (const c of snap.cages) this.drawCage(ctx, c.x - cam, ground, false);

    // --- key ---
    if (snap.keyX !== null) {
      const kx = snap.keyX - cam;
      const bob = Math.sin(t * 3) * 4;
      ctx.save();
      ctx.shadowColor = "#ffd76a";
      ctx.shadowBlur = 16;
      ctx.strokeStyle = "#e8b93c";
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(kx, ground - 26 + bob, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(kx, ground - 20 + bob); ctx.lineTo(kx, ground - 6 + bob);
      ctx.moveTo(kx, ground - 10 + bob); ctx.lineTo(kx + 6, ground - 10 + bob);
      ctx.moveTo(kx, ground - 6 + bob); ctx.lineTo(kx + 5, ground - 6 + bob); ctx.stroke();
      ctx.restore();
    }

    // --- bodies (crows gather above the dead) ---
    for (const b of snap.bodies) {
      const bx = b.x - cam;
      ctx.fillStyle = "rgba(90,10,10,0.7)";
      ctx.beginPath(); ctx.ellipse(bx, ground - 2, 30, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(bx, ground - 10);
      ctx.rotate(Math.PI / 2);
      this.drawFigure(ctx, 0, 0, b.color, 1, false, false, false, t, 1);
      ctx.restore();
      // circling crows
      ctx.strokeStyle = "#0a0608";
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        const a = t * (0.9 + i * 0.2) + i * 2.1;
        const cx2 = bx + Math.cos(a) * (34 + i * 14);
        const cy2 = ground - 120 - i * 16 + Math.sin(a * 1.7) * 10;
        const flap = Math.sin(t * 9 + i * 2) * 4;
        ctx.beginPath();
        ctx.moveTo(cx2 - 7, cy2 - flap);
        ctx.quadraticCurveTo(cx2, cy2 + 3, cx2 + 7, cy2 - flap);
        ctx.stroke();
      }
    }

    // --- players ---
    const sorted = [...snap.players].sort((a, b) => (a.id === snap.self.id ? 1 : 0) - (b.id === snap.self.id ? 1 : 0));
    for (const p of sorted) {
      const px = (displayX.get(p.id) ?? p.x) - cam;
      if (px < -100 || px > w + 100) continue;
      const ghost = !p.alive;
      if (ghost && snap.self.alive) continue; // living can't see ghosts
      const isMate = snap.self.teammates.includes(p.id);
      const floatY = ghost ? -14 + Math.sin(t * 2 + p.x) * 5 : 0;
      ctx.save();
      if (ghost) ctx.globalAlpha = 0.45;
      this.drawFigure(ctx, px, ground + floatY, p.color, p.facing, p.moving, ghost, isMate || (p.id === snap.self.id && snap.self.role === "hollow"), t, 1);
      ctx.restore();
      // key icon
      if (p.hasKey) {
        ctx.fillStyle = "#e8b93c";
        ctx.font = "12px serif";
        ctx.textAlign = "center";
        ctx.fillText("🗝", px + 16, ground - 52 + floatY);
      }
      // name
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = p.id === snap.self.id ? "#ffd98a" : isMate ? "#ff7a6a" : "rgba(235,225,210,0.9)";
      ctx.fillText(p.name + (snap.phase === "meeting" && p.voted ? " ✓" : ""), px, ground - 62 + floatY);
      // speech bubble
      if (p.bubble) this.drawBubble(ctx, px, ground - 72 + floatY, p.bubble.text, Math.min(1, (p.bubble.until - now) / 800));
    }

    // --- cages (front bars) ---
    for (const c of snap.cages) this.drawCage(ctx, c.x - cam, ground, true);

    // --- falling leaves ---
    for (const l of this.leaves) {
      l.x += l.vx * dt; l.y += l.vy * dt; l.r += dt * 2;
      if (l.y > ground + 10) { l.y = -20; l.x = cam + Math.random() * w; }
      if (l.x < cam - 60) l.x = cam + w + 40;
      const sx = l.x - cam;
      if (sx < -20 || sx > w + 20) continue;
      ctx.save();
      ctx.translate(sx, l.y * (h / 700));
      ctx.rotate(l.r);
      ctx.fillStyle = l.c;
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.ellipse(0, 0, l.s, l.s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // --- fog ---
    for (let i = 0; i < 3; i++) {
      const fy = ground - 30 - i * 26;
      const drift = Math.sin(t * 0.3 + i * 2) * 60;
      const fog = ctx.createLinearGradient(0, fy - 24, 0, fy + 24);
      fog.addColorStop(0, "rgba(120,110,130,0)");
      fog.addColorStop(0.5, `rgba(130,120,140,${0.10 + i * 0.02})`);
      fog.addColorStop(1, "rgba(120,110,130,0)");
      ctx.fillStyle = fog;
      ctx.fillRect(drift - 80, fy - 24, w + 160, 48);
    }

    // --- lantern-light darkness mask (server-authoritative vision radius) ---
    const targetR = snap.visionRadius;
    if (targetR < 1500) {
      this.visionR += (targetR - this.visionR) * Math.min(1, dt * 3.5);
      const r = Math.max(80, this.visionR + Math.sin(t * 7.3) * 6); // lantern breathing
      const cx2 = meX - cam;
      const cy2 = ground - 50;
      const dark = ctx.createRadialGradient(cx2, cy2, r * 0.45, cx2, cy2, r);
      dark.addColorStop(0, "rgba(4,2,8,0)");
      dark.addColorStop(0.75, "rgba(4,2,8,0.55)");
      dark.addColorStop(1, "rgba(3,1,6,0.965)");
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, w, h);
    } else {
      this.visionR = 420;
    }

    // --- vignette ---
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(5,2,8,0.75)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // --- horror flicker ---
    const since = now - snap.flickerAt;
    if (since >= 0 && since < 900) {
      const a = Math.random() < 0.5 ? 0.55 : 0.15;
      ctx.fillStyle = `rgba(0,0,0,${a * (1 - since / 900)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // -------------------------------------------------------------------------

  private drawFigure(
    ctx: CanvasRenderingContext2D, x: number, groundY: number, color: string,
    facing: number, moving: boolean, ghost: boolean, redEyes: boolean, t: number, scale: number
  ) {
    const bob = moving ? Math.sin(t * 11 + x * 0.1) * 2.2 : 0;
    const y = groundY + bob;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing * scale, scale);
    // legs
    if (!ghost) {
      const swing = moving ? Math.sin(t * 11 + x * 0.1) * 5 : 0;
      ctx.strokeStyle = "#171017";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-4, -14); ctx.lineTo(-4 + swing, 0);
      ctx.moveTo(4, -14); ctx.lineTo(4 - swing, 0);
      ctx.stroke();
    }
    // hooded body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-11, -12);
    ctx.quadraticCurveTo(-13, -38, 0, -46);
    ctx.quadraticCurveTo(13, -38, 11, -12);
    if (ghost) { ctx.lineTo(7, -6); ctx.lineTo(3, -12); ctx.lineTo(-2, -5); ctx.lineTo(-6, -12); }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.moveTo(-11, -12); ctx.quadraticCurveTo(-13, -38, 0, -46); ctx.quadraticCurveTo(-4, -34, -5, -12);
    ctx.closePath(); ctx.fill();
    // face void
    ctx.fillStyle = "#0c0710";
    ctx.beginPath(); ctx.ellipse(4, -36, 7.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    // eyes
    ctx.fillStyle = redEyes ? "#ff4a3a" : "#e8e0c8";
    ctx.shadowColor = redEyes ? "#ff4a3a" : "#e8e0c8";
    ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(3, -37, 1.6, 0, Math.PI * 2); ctx.arc(8, -37, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  private drawBubble(ctx: CanvasRenderingContext2D, x: number, topY: number, text: string, alpha: number) {
    ctx.save();
    ctx.globalAlpha = Math.max(0.15, alpha);
    ctx.font = "12px system-ui, sans-serif";
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const wd of words) {
      const test = line ? line + " " + wd : wd;
      if (ctx.measureText(test).width > 150 && line) { lines.push(line); line = wd; }
      else line = test;
      if (lines.length >= 3) break;
    }
    if (line && lines.length < 4) lines.push(line);
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const bh = lines.length * 15 + 10;
    const bx = x - bw / 2, by = topY - bh;
    ctx.fillStyle = "rgba(245,240,228,0.95)";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.moveTo(x - 5, by + bh); ctx.lineTo(x + 5, by + bh); ctx.lineTo(x, by + bh + 7);
    ctx.fill();
    ctx.fillStyle = "#241a14";
    ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, x, by + 17 + i * 15));
    ctx.restore();
  }

  private drawCage(ctx: CanvasRenderingContext2D, x: number, ground: number, front: boolean) {
    const wHalf = 32, top = ground - 96;
    ctx.save();
    if (!front) {
      ctx.fillStyle = "rgba(15,10,14,0.6)";
      ctx.fillRect(x - wHalf, top, wHalf * 2, 96);
      ctx.strokeStyle = "#2e2a33";
      ctx.lineWidth = 3;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(x + i * 12, top + 4); ctx.lineTo(x + i * 12, ground); ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "#4a4552";
      ctx.lineWidth = 3.5;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(x + i * 12 + 5, top + 2); ctx.lineTo(x + i * 12 + 5, ground); ctx.stroke();
      }
      ctx.strokeStyle = "#57515f";
      ctx.lineWidth = 5;
      ctx.strokeRect(x - wHalf, top, wHalf * 2, 96);
      ctx.beginPath(); ctx.moveTo(x - wHalf, top + 30); ctx.lineTo(x + wHalf, top + 30); ctx.stroke();
      // hanging chain
      ctx.strokeStyle = "#3a3542";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top - 16); ctx.stroke();
    }
    ctx.restore();
  }

  private drawBellTower(ctx: CanvasRenderingContext2D, x: number, ground: number, t: number, ringing: boolean) {
    ctx.save();
    ctx.strokeStyle = "#241611";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(x - 42, ground); ctx.lineTo(x - 14, ground - 150);
    ctx.moveTo(x + 42, ground); ctx.lineTo(x + 14, ground - 150);
    ctx.stroke();
    ctx.fillStyle = "#1c100c";
    ctx.beginPath();
    ctx.moveTo(x - 30, ground - 148); ctx.lineTo(x + 30, ground - 148); ctx.lineTo(x, ground - 178);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(x - 24, ground - 152, 48, 7);
    // bell
    const swing = ringing ? Math.sin(t * 9) * 0.5 : Math.sin(t * 0.8) * 0.04;
    ctx.translate(x, ground - 143);
    ctx.rotate(swing);
    ctx.fillStyle = "#8a6b2a";
    ctx.beginPath();
    ctx.moveTo(-13, 22);
    ctx.quadraticCurveTo(-13, -2, 0, -4);
    ctx.quadraticCurveTo(13, -2, 13, 22);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#6b5220";
    ctx.fillRect(-15, 20, 30, 5);
    ctx.beginPath(); ctx.arc(0, 28, 3.4, 0, Math.PI * 2); ctx.fill();
    if (ringing) {
      ctx.strokeStyle = "rgba(255,215,130,0.5)";
      ctx.lineWidth = 2;
      for (const r of [26, 38]) { ctx.beginPath(); ctx.arc(0, 12, r, -0.6, 0.6); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 12, r, Math.PI - 0.6, Math.PI + 0.6); ctx.stroke(); }
    }
    ctx.restore();
    // rope
    ctx.strokeStyle = "#5a4a30";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 6, ground - 120); ctx.lineTo(x + 6 + (ringing ? Math.sin(t * 9) * 6 : 0), ground - 30); ctx.stroke();
  }

  private drawStation(
    ctx: CanvasRenderingContext2D, st: Station, x: number, ground: number,
    t: number, now: number, snap: Snapshot
  ) {
    if (x < -260 || x > (ctx.canvas.width / (window.devicePixelRatio || 1)) + 260) return;
    const blackout = now < snap.blackoutUntil;
    const flick = now - snap.flickerAt < 900 ? Math.random() * 0.6 : 0;
    const win = (wx: number, wy: number, ww: number, wh: number) => {
      const a = blackout ? 0.04 : Math.max(0.05, 0.75 - flick);
      ctx.fillStyle = `rgba(255,${170 + Math.sin(t * 2 + wx) * 20},80,${a})`;
      ctx.fillRect(wx, wy, ww, wh);
    };
    ctx.save();
    ctx.translate(x, ground);
    ctx.fillStyle = "#1e1310";
    switch (st.kind) {
      case "pumpkins": {
        ctx.fillStyle = "#241511";
        ctx.fillRect(-70, -70, 140, 70); // shed
        ctx.beginPath(); ctx.moveTo(-80, -70); ctx.lineTo(0, -105); ctx.lineTo(80, -70); ctx.closePath(); ctx.fill();
        win(-20, -50, 18, 20);
        for (const [px, pr] of [[-45, 12], [-20, 15], [8, 11], [34, 14], [55, 10]] as const) {
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
        ctx.beginPath(); ctx.moveTo(-38, -76); ctx.lineTo(0, -98); ctx.lineTo(38, -76); ctx.closePath(); ctx.fill();
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
        ctx.fillStyle = "#c9a86a";
        ctx.beginPath(); ctx.arc(0, -92, 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#241511";
        ctx.beginPath(); ctx.moveTo(-16, -98); ctx.lineTo(16, -98); ctx.lineTo(0, -116); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#1a0f0a";
        ctx.beginPath(); ctx.arc(-4, -93, 1.8, 0, Math.PI * 2); ctx.arc(4, -93, 1.8, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "lantern": {
        ctx.fillStyle = "#191420";
        ctx.fillRect(-3, -110, 6, 110);
        ctx.fillRect(-14, -112, 28, 5);
        const glow = blackout ? 0.03 : 0.6 + Math.sin(t * 5) * 0.1 - flick;
        ctx.fillStyle = `rgba(255,190,90,${Math.max(0.03, glow)})`;
        ctx.shadowColor = "rgba(255,180,80,0.9)"; ctx.shadowBlur = blackout ? 0 : 24;
        ctx.fillRect(-8, -106, 16, 18);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#191420"; ctx.fillRect(-10, -108, 20, 3);
        break;
      }
      case "chapel": {
        ctx.fillStyle = "#221419";
        ctx.fillRect(-65, -90, 130, 90);
        ctx.beginPath(); ctx.moveTo(-72, -90); ctx.lineTo(0, -128); ctx.lineTo(72, -90); ctx.closePath(); ctx.fill();
        ctx.fillRect(-16, -170, 32, 84);
        ctx.beginPath(); ctx.moveTo(-20, -168); ctx.lineTo(0, -206); ctx.lineTo(20, -168); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#c9b98a"; ctx.fillRect(-2, -228, 4, 24); ctx.fillRect(-8, -221, 16, 4);
        win(-44, -66, 14, 28); win(30, -66, 14, 28); win(-6, -156, 12, 20);
        ctx.fillStyle = "#120a0e"; ctx.fillRect(-12, -44, 24, 44);
        break;
      }
      case "mill": {
        ctx.fillStyle = "#20140f";
        ctx.fillRect(-80, -85, 160, 85);
        ctx.beginPath(); ctx.moveTo(-88, -85); ctx.lineTo(88, -85); ctx.lineTo(60, -115); ctx.lineTo(-60, -115); ctx.closePath(); ctx.fill();
        win(-50, -60, 20, 22); win(28, -60, 20, 22);
        ctx.save();
        ctx.translate(0, -50); ctx.rotate(t * 0.6);
        ctx.strokeStyle = "#4a3826"; ctx.lineWidth = 7;
        for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -44); ctx.stroke(); }
        ctx.restore();
        ctx.fillStyle = "#0f0a08"; ctx.fillRect(-14, -40, 28, 40);
        break;
      }
      case "graves": {
        for (const [gx, gh, tilt] of [[-55, 34, -0.08], [-20, 42, 0.05], [18, 30, -0.04], [52, 38, 0.1]] as const) {
          ctx.save(); ctx.translate(gx, 0); ctx.rotate(tilt);
          ctx.fillStyle = "#3d3a42";
          ctx.beginPath(); ctx.roundRect(-11, -gh, 22, gh, [10, 10, 0, 0]); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = "#0a0605";
        ctx.beginPath(); ctx.ellipse(85, -2, 26, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#2a1c12";
        ctx.beginPath(); ctx.ellipse(108, -8, 14, 9, 0.3, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "radio": {
        ctx.strokeStyle = "#2c2833"; ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-34, 0); ctx.lineTo(0, -190); ctx.lineTo(34, 0);
        ctx.moveTo(-24, -55); ctx.lineTo(24, -55);
        ctx.moveTo(-15, -110); ctx.lineTo(15, -110);
        ctx.moveTo(-24, -55); ctx.lineTo(15, -110); ctx.moveTo(24, -55); ctx.lineTo(-15, -110);
        ctx.stroke();
        const blink = Math.sin(t * 3) > 0 ? 0.9 : 0.2;
        ctx.fillStyle = `rgba(255,60,50,${blink})`;
        ctx.shadowColor = "#ff3c32"; ctx.shadowBlur = 12;
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
    ctx.restore();

    // task marker for own unfinished tasks
    const myTask = snap.tasks.find((tk) => tk.id === st.id && !tk.done);
    if (myTask && snap.phase === "playing") {
      const bob = Math.sin(t * 3 + st.x) * 4;
      ctx.save();
      ctx.fillStyle = "rgba(255,205,90,0.9)";
      ctx.shadowColor = "#ffcd5a"; ctx.shadowBlur = 10;
      ctx.translate(x, ground - 235 + bob);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
      if (myTask.progress > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(x - 30, ground - 215, 60, 8);
        ctx.fillStyle = "#ffcd5a";
        ctx.fillRect(x - 29, ground - 214, 58 * myTask.progress, 6);
      }
    }
  }
}

export const CAGE_POSITIONS = CAGE_XS;