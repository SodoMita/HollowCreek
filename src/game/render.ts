// Canvas renderer for Hollow Creek — pure drawing, no game logic.
import {
  BELL_X, BUILDINGS, CAGE_XS, INTERIOR_STATIONS, MEETING_FROM, MEETING_TO, STATIONS, WORLD_W,
} from "./types";
import type { Building, Snapshot, Station } from "./types";
import { createDefaultSettings, type GameSettings } from "./settings";
import { drawBrokenWard, drawKit, drawSupplyCart } from "./ward-art";

interface Leaf { x: number; y: number; vx: number; vy: number; r: number; c: string; s: number }

const LEAF_COLORS = ["#b4552a", "#c9762f", "#8f3b1f", "#d99a3d", "#7a4a21"];

export class Renderer {
  private leaves: Leaf[] = [];
  private settings: GameSettings = createDefaultSettings();
  cameraX = 0;
  private visionR = 420;

  constructor() {
    for (let i = 0; i < 110; i++) {
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

  setSettings(settings: GameSettings) {
    this.settings = settings;
  }

  private qualityCount(high: number, medium: number, low: number) {
    return this.settings.graphics.quality === "high" ? high : this.settings.graphics.quality === "medium" ? medium : low;
  }

  private glow(ctx: CanvasRenderingContext2D, blur: number) {
    ctx.shadowBlur = this.settings.graphics.glow ? blur : 0;
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
    const graphics = this.settings.graphics;
    if (graphics.reducedMotion) t = 0;
    const me = snap.players.find((p) => p.id === snap.self.id);
    const meX = me ? displayX.get(me.id) ?? me.x : WORLD_W / 2;
    const targetCam = Math.max(0, Math.min(WORLD_W - w, meX - w / 2));
    if (graphics.cameraSmoothing) this.cameraX += (targetCam - this.cameraX) * Math.min(1, dt * 6);
    else this.cameraX = targetCam;
    if (WORLD_W < w) this.cameraX = (WORLD_W - w) / 2;
    const cam = this.cameraX;
    const ground = h * 0.78;
    const now = snap.now;

    // --- layered dusk sky ---
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, "#090b1b");
    sky.addColorStop(0.38, "#211329");
    sky.addColorStop(0.72, "#512534");
    sky.addColorStop(0.9, "#9a4c2c");
    sky.addColorStop(1, "#c0743c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, ground);

    // Deterministic stars: no shimmering random layout between frames.
    const starCount = this.qualityCount(95, 48, 18);
    ctx.save();
    for (let i = 0; i < starCount; i++) {
      const sx = ((i * 197.3 + 41) % (w + 160)) - 80 - (cam * 0.008) % 40;
      const sy = 18 + ((i * 83.7) % Math.max(60, ground * 0.52));
      const radius = 0.45 + (i % 7 === 0 ? 0.85 : 0.25);
      ctx.globalAlpha = 0.25 + (i % 5) * 0.1;
      ctx.fillStyle = i % 9 === 0 ? "#ffd9a0" : "#d9d8ed";
      ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Moon with a broad atmospheric halo and crisp crater detail.
    const mx = w * 0.78 - cam * 0.03;
    const my = h * 0.18;
    ctx.save();
    if (graphics.glow) {
      const halo = ctx.createRadialGradient(mx, my, 32, mx, my, 145);
      halo.addColorStop(0, "rgba(244,222,181,.25)");
      halo.addColorStop(0.45, "rgba(222,191,170,.08)");
      halo.addColorStop(1, "rgba(222,191,170,0)");
      ctx.fillStyle = halo; ctx.fillRect(mx - 150, my - 150, 300, 300);
    }
    ctx.shadowColor = "rgba(240,225,190,0.8)";
    this.glow(ctx, 34);
    const moon = ctx.createRadialGradient(mx - 13, my - 15, 4, mx, my, 45);
    moon.addColorStop(0, "#fff4d8"); moon.addColorStop(0.7, "#e8ddc0"); moon.addColorStop(1, "#bcae98");
    ctx.fillStyle = moon;
    ctx.beginPath(); ctx.arc(mx, my, 42, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(128,119,112,0.25)";
    for (const [dx, dy, r] of [[-12, -8, 7], [10, 10, 5], [14, -14, 4], [-20, 16, 3]] as const) {
      ctx.beginPath(); ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Long, slow cloud banks crossing the moon and horizon.
    if (graphics.quality !== "low") {
      ctx.save();
      ctx.fillStyle = "rgba(27,19,36,.22)";
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 410 + t * (3 + i)) % (w + 500)) - 250;
        const cy = 80 + i * 58;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 150, 17, -0.05, 0, Math.PI * 2);
        ctx.ellipse(cx + 95, cy + 5, 105, 12, 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- two layers of hills, then an irregular wooded horizon ---
    ctx.fillStyle = "#2a1828";
    ctx.beginPath(); ctx.moveTo(0, ground);
    for (let sx = 0; sx <= w + 20; sx += 20) {
      const wx = sx + cam * 0.09;
      ctx.lineTo(sx, ground - 135 - Math.sin(wx * 0.0021 + 1) * 48 - Math.sin(wx * 0.006) * 22);
    }
    ctx.lineTo(w, ground); ctx.fill();
    ctx.fillStyle = "#1b121d";
    ctx.beginPath(); ctx.moveTo(0, ground);
    for (let sx = 0; sx <= w + 20; sx += 20) {
      const wx = sx + cam * 0.15;
      ctx.lineTo(sx, ground - 82 - Math.sin(wx * 0.004) * 38 - Math.sin(wx * 0.0013 + 3) * 48);
    }
    ctx.lineTo(w, ground); ctx.fill();

    for (let i = 0; i < 60; i++) {
      const wx = i * 130 + ((i * 97) % 60);
      const sx = wx - cam * 0.45;
      if (sx < -90 || sx > w + 90) continue;
      const th = 74 + ((i * 53) % 56);
      this.drawTree(ctx, sx, ground, th, i);
    }

    // --- ground ---
    const gg = ctx.createLinearGradient(0, ground, 0, h);
    gg.addColorStop(0, "#2b1a12");
    gg.addColorStop(0.12, "#1d120c");
    gg.addColorStop(1, "#0d0806");
    ctx.fillStyle = gg;
    ctx.fillRect(0, ground, w, h - ground);
    // Rutted road, scattered stones, leaf piles, and a broken fence rhythm.
    ctx.strokeStyle = "rgba(218,164,100,0.13)";
    ctx.lineWidth = 2;
    for (const offset of [19, 34]) {
      ctx.beginPath();
      for (let sx = 0; sx <= w; sx += 30) {
        const y = ground + offset + Math.sin((sx + cam) * 0.017) * 2;
        if (sx === 0) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 50; i++) {
      const sx = i * 190 + ((i * 71) % 90) - cam;
      if (sx < -60 || sx > w + 60) continue;
      ctx.fillStyle = "rgba(160,90,40,0.28)";
      ctx.beginPath(); ctx.ellipse(sx, ground + 8, 30, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(205,129,55,.28)";
      for (let j = 0; j < 4; j++) {
        ctx.beginPath(); ctx.ellipse(sx - 18 + j * 11, ground + 4 + (j % 2) * 3, 5, 2, j * 0.7, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (graphics.quality !== "low") {
      ctx.strokeStyle = "rgba(107,75,50,.55)"; ctx.lineWidth = 4;
      for (let i = 0; i < 24; i++) {
        const fx = i * 235 - cam;
        if (fx < -80 || fx > w + 80) continue;
        const fy = ground + 48 + (i % 3) * 3;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx - 2, fy - 31); ctx.moveTo(fx + 74, fy); ctx.lineTo(fx + 72, fy - 28);
        ctx.moveTo(fx - 5, fy - 23); ctx.lineTo(fx + 78, fy - 17); ctx.moveTo(fx - 4, fy - 9); ctx.lineTo(fx + 77, fy - 5); ctx.stroke();
      }
      ctx.fillStyle = "rgba(93,103,111,.18)";
      for (let i = 0; i < 30; i++) {
        const sx = i * 173 + 60 - cam;
        if (sx < 0 || sx > w) continue;
        ctx.beginPath(); ctx.ellipse(sx, ground + 27, 4 + i % 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // meeting square highlight
    if (snap.phase === "meeting") {
      const a = 0.08 + Math.sin(t * 3) * 0.03;
      ctx.fillStyle = `rgba(255,200,100,${a})`;
      ctx.fillRect(MEETING_FROM - cam, ground - 200, MEETING_TO - MEETING_FROM, 200 + 40);
    }

    // --- stations / buildings ---
    for (const st of STATIONS) {
      const sx = st.x - cam;
      if (sx > -280 && sx < w + 280) this.drawStation(ctx, st, sx, ground, t, now, snap);
    }
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
      this.glow(ctx, 16);
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

    // --- houses: facades, locked doors, and cutaway interiors ---
    for (const state of snap.buildings) {
      const def = BUILDINGS.find((b) => b.id === state.id);
      if (!def) continue;
      const bx = state.x - cam;
      if (bx > -520 && bx < w + 520) this.drawBuilding(ctx, def, state, bx, ground, t, now, snap);
    }

    // --- players ---
    const sorted = [...snap.players].sort((a, b) => (a.id === snap.self.id ? 1 : 0) - (b.id === snap.self.id ? 1 : 0));
    const drawPlayer = (p: Snapshot["players"][number]) => {
      const px = (displayX.get(p.id) ?? p.x) - cam;
      if (px < -100 || px > w + 100) return;
      const ghost = !p.alive;
      if (ghost && snap.self.alive) return; // living can't see ghosts
      const isMate = snap.self.teammates.includes(p.id);
      const floatY = ghost ? -14 + Math.sin(t * 2 + p.x) * 5 : 0;
      // Someone behind a door is drawn on the room's floor so the cutaway reads.
      const indoors = p.inside ? snap.buildings.find((b) => b.id === p.inside) : undefined;
      const baseY = indoors ? ground - 58 : ground + floatY;
      const scale = indoors ? 0.72 : 1;
      ctx.save();
      if (ghost) ctx.globalAlpha = 0.45;
      if (!ghost && !indoors) {
        ctx.fillStyle = "rgba(0,0,0,.35)";
        ctx.beginPath(); ctx.ellipse(px, ground + 2, 17, 4, 0, 0, Math.PI * 2); ctx.fill();
      }
      this.drawFigure(ctx, px, baseY, p.color, p.facing, p.moving, ghost, isMate || (p.id === snap.self.id && snap.self.role === "hollow"), t, scale);
      ctx.restore();
      // A kit stays visible on its carrier until someone delivers it.
      if (p.hasSupply) drawKit(ctx, px - 23 * scale, baseY - 16 * scale);
      // key icon
      if (p.hasKey) {
        ctx.fillStyle = "#e8b93c";
        ctx.font = "12px serif";
        ctx.textAlign = "center";
        ctx.fillText("🗝", px + 16, baseY - 52 + floatY);
      }
      // name and speech are optional HUD layers; the figures remain identifiable by color.
      if (this.settings.interface.playerNames) {
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        const label = p.name + (indoors ? " ⌂" : "") + (snap.phase === "meeting" && p.voted ? " ✓" : "");
        const width = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(5,3,8,.55)";
        ctx.beginPath(); ctx.roundRect(px - width / 2 - 5, baseY - 75 + floatY, width + 10, 17, 5); ctx.fill();
        ctx.fillStyle = p.id === snap.self.id ? "#ffd98a" : isMate ? "#ff7a6a" : "rgba(245,235,220,.96)";
        ctx.fillText(label, px, baseY - 62 + floatY);
      }
      if (p.bubble && this.settings.interface.speechBubbles) this.drawBubble(ctx, px, baseY - 72 + floatY, p.bubble.text, Math.min(1, (p.bubble.until - now) / 800));
    };

    for (const p of sorted) if (p.caged) drawPlayer(p);
    // Only prisoners stand behind the fronts; everyone else walks in front.
    for (const c of snap.cages) this.drawCage(ctx, c.x - cam, ground, true);
    for (const p of sorted) if (!p.caged) drawPlayer(p);

    // --- falling leaves (quantity follows the detail preset) ---
    if (graphics.particles) {
      const count = this.qualityCount(100, 55, 22);
      for (const l of this.leaves.slice(0, count)) {
        if (!graphics.reducedMotion) { l.x += l.vx * dt; l.y += l.vy * dt; l.r += dt * 2; }
        if (l.y > ground + 10) { l.y = -20; l.x = cam + Math.random() * w; }
        if (l.x < cam - 60) l.x = cam + w + 40;
        const sx = l.x - cam;
        if (sx < -20 || sx > w + 20) continue;
        ctx.save();
        ctx.translate(sx, l.y * (h / 700));
        ctx.rotate(l.r);
        ctx.fillStyle = l.c;
        ctx.globalAlpha = 0.72;
        ctx.beginPath(); ctx.ellipse(0, 0, l.s, l.s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(40,18,10,.45)"; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(-l.s, 0); ctx.lineTo(l.s, 0); ctx.stroke();
        ctx.restore();
      }
    }

    // --- low, layered fog ---
    if (graphics.fog) {
      const layers = this.qualityCount(4, 3, 1);
      for (let i = 0; i < layers; i++) {
        const fy = ground - 24 - i * 25;
        const drift = Math.sin(t * 0.24 + i * 2) * 70;
        const fog = ctx.createLinearGradient(0, fy - 25, 0, fy + 25);
        fog.addColorStop(0, "rgba(120,110,130,0)");
        fog.addColorStop(0.5, `rgba(145,132,151,${0.075 + i * 0.018})`);
        fog.addColorStop(1, "rgba(120,110,130,0)");
        ctx.fillStyle = fog;
        ctx.fillRect(drift - 90, fy - 25, w + 180, 50);
      }
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
    if (graphics.vignette) {
      const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(5,2,8,0.72)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }

    // --- horror flicker (decorative only; never changes authoritative vision) ---
    const since = now - snap.flickerAt;
    if (graphics.flicker && !graphics.reducedMotion && since >= 0 && since < 900) {
      const a = Math.random() < 0.5 ? 0.55 : 0.15;
      ctx.fillStyle = `rgba(0,0,0,${a * (1 - since / 900)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // -------------------------------------------------------------------------

  private drawTree(ctx: CanvasRenderingContext2D, x: number, ground: number, height: number, seed: number) {
    const top = ground - height;
    ctx.save();
    ctx.strokeStyle = seed % 2 ? "#241718" : "#2c1918";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, ground); ctx.lineTo(x + (seed % 3 - 1) * 3, top + 18);
    ctx.moveTo(x, top + 45); ctx.lineTo(x - 19, top + 23);
    ctx.moveTo(x + 1, top + 35); ctx.lineTo(x + 23, top + 10);
    if (seed % 4 === 0) { ctx.moveTo(x - 8, top + 35); ctx.lineTo(x - 30, top + 39); }
    ctx.stroke();
    const palettes = [
      ["#3a1d1b", "#56251d", "#74321f"],
      ["#3a2118", "#5c301b", "#85411f"],
      ["#291a1b", "#43231d", "#613020"],
    ];
    const palette = palettes[seed % palettes.length];
    const clusters = this.qualityCount(8, 6, 4);
    for (let j = 0; j < clusters; j++) {
      const angle = j * 2.4 + seed;
      const cx = x + Math.sin(angle) * (15 + (j % 3) * 6);
      const cy = top + 9 + Math.cos(angle * 1.3) * 15 + j * 2.2;
      const radius = 17 + ((seed * 13 + j * 7) % 13);
      ctx.fillStyle = palette[j % palette.length];
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
    }
    if (this.settings.graphics.quality === "high") {
      ctx.fillStyle = "rgba(207,105,43,.22)";
      for (let j = 0; j < 7; j++) {
        const lx = x - 28 + ((seed * 31 + j * 17) % 58);
        const ly = top - 9 + ((seed * 19 + j * 23) % 50);
        ctx.beginPath(); ctx.arc(lx, ly, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  /** A house on the creek. Locked doors need the iron key; occupied rooms turn
   *  transparent so the whole street can watch whoever stepped inside. */
  private drawBuilding(
    ctx: CanvasRenderingContext2D,
    def: Building,
    state: Snapshot["buildings"][number],
    x: number,
    groundY: number,
    t: number,
    now: number,
    snap: Snapshot,
  ) {
    const half = state.half;
    const blackout = now < snap.blackoutUntil;
    const highlight = snap.self.inside === def.id;
    const flick = this.settings.graphics.flicker && !this.settings.graphics.reducedMotion && now - snap.flickerAt < 900 ? Math.random() * 0.5 : 0;
    ctx.save();
    ctx.translate(x, groundY);

    // stone footings
    ctx.fillStyle = "#17100e";
    ctx.beginPath(); ctx.roundRect(-half - 8, -12, half * 2 + 16, 14, 4); ctx.fill();

    if (state.transparent) {
      // ---- cutaway: the room behind the wall ----
      const glowOn = !blackout;
      const room = ctx.createLinearGradient(0, -152, 0, 0);
      room.addColorStop(0, glowOn ? "rgba(66,44,34,.96)" : "rgba(22,16,20,.97)");
      room.addColorStop(0.65, glowOn ? "rgba(96,60,38,.94)" : "rgba(28,20,24,.97)");
      room.addColorStop(1, "rgba(20,13,12,.98)");
      ctx.fillStyle = room;
      ctx.fillRect(-half + 4, -150, half * 2 - 8, 150);
      // plank floor
      ctx.strokeStyle = "rgba(190,140,86,.22)";
      ctx.lineWidth = 1;
      for (let i = -half + 14; i < half - 8; i += 22) {
        ctx.beginPath(); ctx.moveTo(i, -52); ctx.lineTo(i + 6, 0); ctx.stroke();
      }
      // wall studs
      ctx.strokeStyle = "rgba(36,20,14,.55)";
      ctx.lineWidth = 5;
      for (let i = -half + 20; i < half - 10; i += 62) { ctx.beginPath(); ctx.moveTo(i, -148); ctx.lineTo(i, 0); ctx.stroke(); }
      // room props: small interior locations
      for (const prop of def.props) {
        this.drawProp(ctx, prop.x - def.x, prop.kind, glowOn ? 1 : 0.45);
      }
      // the indoor ward, if this house has one
      const indoor = INTERIOR_STATIONS.find((st) => st.inside === def.id);
      if (indoor) {
        const task = snap.tasks.find((tk) => tk.id === indoor.id);
        const px = indoor.x - def.x;
        ctx.save();
        ctx.translate(px, -52);
        ctx.fillStyle = "#3a2418";
        ctx.fillRect(-30, -16, 60, 8);
        ctx.fillRect(-27, -8, 5, 16);
        ctx.fillRect(22, -8, 5, 16);
        if (!task?.done) {
          ctx.fillStyle = "#d8c9b4";
          ctx.font = "10px serif";
          ctx.textAlign = "center";
          ctx.fillText("✖", 0, -22);
          ctx.fillStyle = "rgba(230,140,80,.85)";
          ctx.fillText(task?.delivered ? "kit ready" : "needs kit", 0, 26);
        } else {
          ctx.fillStyle = "#a8c98a";
          ctx.font = "11px serif";
          ctx.textAlign = "center";
          ctx.fillText("✦", 0, -24);
        }
        ctx.restore();
      }
      // hanging lamp
      ctx.strokeStyle = "#2a1a12"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -148); ctx.lineTo(0, -118); ctx.stroke();
      ctx.fillStyle = glowOn ? "#ffcf7a" : "#4a3a2a";
      if (glowOn) { ctx.shadowColor = "#ffb45c"; this.glow(ctx, 26); }
      ctx.beginPath(); ctx.arc(0, -113, 8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // translucent front wall + window frames over the cutaway
      ctx.fillStyle = `rgba(32,20,18,${0.3 + flick})`;
      ctx.fillRect(-half, -150, half * 2, 150);
      ctx.strokeStyle = "rgba(18,11,10,.85)";
      ctx.lineWidth = 7;
      ctx.strokeRect(-half, -150, half * 2, 150);
      const winA = glowOn ? 0.42 : 0.05;
      ctx.strokeStyle = `rgba(255,200,130,${winA})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(-half + 34, -122, 52, 40);
      ctx.strokeRect(half - 86, -122, 52, 40);
      // "walls are thin" caption
      ctx.fillStyle = "rgba(255,220,170,.62)";
      ctx.font = "9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("WALLS THIN — OCCUPIED", 0, -158);
    } else {
      // ---- solid facade ----
      ctx.fillStyle = def.kind === "quarry" ? "#2a2523" : "#241511";
      ctx.beginPath(); ctx.roundRect(-half, -150, half * 2, 150, 4); ctx.fill();
      // roof
      ctx.fillStyle = "#180f0c";
      ctx.beginPath();
      ctx.moveTo(-half - 18, -150);
      ctx.lineTo(0, -202);
      ctx.lineTo(half + 18, -150);
      ctx.closePath(); ctx.fill();
      // chimney smoke
      ctx.fillStyle = "rgba(120,100,95,.18)";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(half - 46 + Math.sin(t + i) * 8, -212 - i * 15, 9 + i * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = def.kind === "quarry" ? "#3a3431" : "#31201b";
      ctx.fillRect(half - 64, -212, 22, 58);
      // windows, warm if the town still has light
      const lit = !blackout && !state.wardDone;
      const winA = lit ? 0.72 : 0.14;
      for (const wx of [-half + 34, half - 86]) {
        const glass = ctx.createLinearGradient(wx, -122, wx, -82);
        glass.addColorStop(0, `rgba(255,214,130,${winA})`);
        glass.addColorStop(1, `rgba(206,92,36,${winA * 0.8})`);
        ctx.fillStyle = glass;
        if (lit) { ctx.shadowColor = "rgba(255,151,55,.7)"; this.glow(ctx, 12); }
        ctx.fillRect(wx, -122, 52, 40);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(16,9,8,.9)"; ctx.lineWidth = 2;
        ctx.strokeRect(wx, -122, 52, 40);
        ctx.beginPath();
        ctx.moveTo(wx + 26, -122); ctx.lineTo(wx + 26, -82);
        ctx.moveTo(wx, -102); ctx.lineTo(wx + 52, -102);
        ctx.stroke();
      }
      // door + lock state
      const doorW = def.doorStyle === "arch" ? 50 : 42;
      ctx.fillStyle = state.doorOpen ? "#0c0809" : "#3d271a";
      ctx.beginPath();
      if (def.doorStyle === "arch") {
        ctx.moveTo(-doorW / 2, 0);
        ctx.lineTo(-doorW / 2, -48);
        ctx.quadraticCurveTo(0, -86, doorW / 2, -48);
        ctx.lineTo(doorW / 2, 0);
      } else {
        ctx.rect(-doorW / 2, -62, doorW, 62);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#17100c"; ctx.lineWidth = 4; ctx.stroke();
      if (state.doorOpen) {
        // light spilling from the threshold and the door leaning inward
        const spill = ctx.createLinearGradient(0, 0, 0, 34);
        spill.addColorStop(0, "rgba(255,196,110,.35)");
        spill.addColorStop(1, "rgba(255,196,110,0)");
        ctx.fillStyle = spill;
        ctx.beginPath();
        ctx.moveTo(-doorW / 2, 0); ctx.lineTo(doorW / 2, 0);
        ctx.lineTo(doorW, 30); ctx.lineTo(-doorW, 30);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#d9a75a"; ctx.lineWidth = 2;
        ctx.strokeRect(0, -60, doorW * 0.4, 58);
      } else {
        ctx.fillStyle = "#e8b93c";
        ctx.beginPath(); ctx.arc(doorW / 2 - 9, -28, 3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#e8b93c"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(doorW / 2 - 9, -33, 3.5, Math.PI, 0); ctx.stroke();
      }
      // painted sign
      ctx.fillStyle = "rgba(14,9,9,.8)";
      ctx.beginPath(); ctx.roundRect(-half + 18, -172, half * 2 - 36, 20, 4); ctx.fill();
      ctx.strokeStyle = "rgba(160,120,80,.4)"; ctx.lineWidth = 1;
      ctx.strokeRect(-half + 18, -172, half * 2 - 36, 20);
      ctx.fillStyle = "#e6d3b6";
      ctx.font = "600 11px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText(def.name.toUpperCase(), 0, -158);
    }

    // an always-readable label + state line under the sign
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = highlight ? "#ffd98a" : "rgba(232,220,200,.85)";
    ctx.fillText(def.name, 0, -178);
    if (!state.transparent) {
      ctx.font = "9px system-ui, sans-serif";
      ctx.fillStyle = state.doorOpen ? "#a8c98a" : "rgba(214,150,140,.85)";
      ctx.fillText(state.doorOpen ? "door open" : "locked · iron key", 0, -166);
    }
    ctx.restore();
  }

  /** Small hand-drawn furniture for interiors. */
  private drawProp(ctx: CanvasRenderingContext2D, x: number, kind: Building["props"][number]["kind"], alpha: number) {
    ctx.save();
    ctx.translate(x, -52);
    ctx.globalAlpha = alpha;
    switch (kind) {
      case "table":
        ctx.fillStyle = "#4a2f1d";
        ctx.fillRect(-24, -14, 48, 6);
        ctx.fillRect(-20, -8, 4, 14);
        ctx.fillRect(16, -8, 4, 14);
        ctx.fillStyle = "#d8c9b4";
        ctx.fillRect(-12, -18, 22, 5);
        ctx.fillStyle = "#8a6a44";
        ctx.fillRect(-2, -30, 4, 12);
        break;
      case "stove":
        ctx.fillStyle = "#3a3330";
        ctx.fillRect(-18, -34, 36, 34);
        ctx.fillStyle = "#211b19";
        ctx.fillRect(10, -58, 8, 26);
        ctx.fillStyle = "#d9743c";
        ctx.beginPath(); ctx.arc(0, -14, 5, 0, Math.PI * 2); ctx.fill();
        break;
      case "shelf":
        ctx.fillStyle = "#3d271a";
        ctx.fillRect(-22, -46, 44, 4);
        ctx.fillRect(-22, -28, 44, 4);
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = ["#7a4a21", "#5b6a3a", "#8a3b2a", "#3a5a6a", "#6b5433"][i];
          ctx.fillRect(-20 + i * 8, -58 + (i % 2) * 18, 6, 12);
        }
        break;
      case "crate":
        ctx.fillStyle = "#4a3a28";
        ctx.fillRect(-16, -22, 32, 22);
        ctx.strokeStyle = "#8a6a44"; ctx.lineWidth = 2;
        ctx.strokeRect(-16, -22, 32, 22);
        ctx.beginPath(); ctx.moveTo(-16, -22); ctx.lineTo(16, 0); ctx.moveTo(16, -22); ctx.lineTo(-16, 0); ctx.stroke();
        break;
      case "barrel":
        ctx.fillStyle = "#4a2f1d";
        ctx.beginPath(); ctx.ellipse(0, -18, 13, 18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#8a6a44"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, -26, 13, 5, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0, -10, 13, 5, 0, 0, Math.PI * 2); ctx.stroke();
        break;
      case "lamp":
        ctx.strokeStyle = "#2a1a12"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -98); ctx.lineTo(0, -74); ctx.stroke();
        ctx.fillStyle = "#ffcf7a";
        ctx.beginPath(); ctx.arc(0, -70, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#3d271a";
        ctx.fillRect(-5, -64, 10, 4);
        break;
    }
    ctx.restore();
  }

  private drawFigure(
    ctx: CanvasRenderingContext2D, x: number, groundY: number, color: string,
    facing: number, moving: boolean, ghost: boolean, redEyes: boolean, t: number, scale: number
  ) {
    const gait = Math.sin(t * 11 + x * 0.1);
    const bob = moving ? gait * 1.8 : Math.sin(t * 1.7 + x) * 0.35;
    const y = groundY + bob;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing * scale, scale);
    ctx.lineCap = "round";

    if (!ghost) {
      const swing = moving ? gait * 5 : 0;
      ctx.strokeStyle = "#100d13"; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-4, -14); ctx.lineTo(-4 + swing, -1); ctx.lineTo(-1 + swing, 0);
      ctx.moveTo(4, -14); ctx.lineTo(4 - swing, -1); ctx.lineTo(7 - swing, 0);
      ctx.stroke();
    }

    // Rear sleeve and arm make the walking direction legible at small sizes.
    ctx.strokeStyle = color; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-6, -33); ctx.lineTo(-12 - (moving ? gait * 3 : 0), -18); ctx.stroke();

    // Cloak silhouette, hem, and a shaded fold down the trailing side.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-12, -12);
    ctx.quadraticCurveTo(-15, -32, -8, -41);
    ctx.quadraticCurveTo(0, -49, 9, -41);
    ctx.quadraticCurveTo(15, -30, 12, -12);
    if (ghost) { ctx.lineTo(8, -5); ctx.lineTo(3, -12); ctx.lineTo(-2, -5); ctx.lineTo(-7, -12); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(5,3,9,.3)";
    ctx.beginPath();
    ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-15, -32, -8, -41);
    ctx.quadraticCurveTo(-4, -34, -5, -12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,235,210,.13)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(5, -28); ctx.quadraticCurveTo(8, -20, 7, -12); ctx.stroke();

    // Front sleeve and a small metal clasp break up the single-color body.
    ctx.strokeStyle = color; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(7, -33); ctx.lineTo(13 + (moving ? gait * 3 : 0), -20); ctx.stroke();
    ctx.fillStyle = "#c5a56a"; ctx.beginPath(); ctx.arc(3, -29, 1.4, 0, Math.PI * 2); ctx.fill();

    // Raised hood rim around a genuinely dark face opening.
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(2, -38, 11, 10, -0.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(240,215,190,.16)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(3, -37, 8.5, 7.5, -0.1, Math.PI * 0.75, Math.PI * 2.15); ctx.stroke();
    ctx.fillStyle = "#09070d";
    ctx.beginPath(); ctx.ellipse(4, -36.5, 7.2, 6.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = redEyes ? "#ff5142" : "#eee6ce";
    ctx.shadowColor = redEyes ? "#ff4a3a" : "#e8e0c8";
    this.glow(ctx, 5);
    ctx.beginPath(); ctx.arc(3, -37, 1.5, 0, Math.PI * 2); ctx.arc(8, -37, 1.5, 0, Math.PI * 2); ctx.fill();
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
    const blackout = now < snap.blackoutUntil;
    const task = snap.tasks.find((tk) => tk.id === st.id);
    const broken = snap.phase === "lobby" || (!!task && !task.done);
    const supplied = !!task?.delivered;
    const flick = this.settings.graphics.flicker && !this.settings.graphics.reducedMotion && now - snap.flickerAt < 900 ? Math.random() * 0.6 : 0;
    const win = (wx: number, wy: number, ww: number, wh: number) => {
      const a = blackout || broken ? 0.02 : Math.max(0.05, 0.75 - flick);
      ctx.save();
      ctx.shadowColor = "rgba(255,151,55,.75)"; this.glow(ctx, broken || blackout ? 0 : 13);
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
        if (!blackout && !broken && this.settings.graphics.glow) {
          const light = ctx.createRadialGradient(0, -92, 4, 0, -72, 112);
          light.addColorStop(0, "rgba(255,187,83,.22)"); light.addColorStop(1, "rgba(255,145,45,0)");
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
        const glow = blackout || broken ? 0.03 : 0.6 + Math.sin(t * 5) * 0.1 - flick;
        ctx.fillStyle = `rgba(255,190,90,${Math.max(0.03, glow)})`;
        ctx.shadowColor = "rgba(255,180,80,0.9)"; this.glow(ctx, blackout || broken ? 0 : 24);
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
        ctx.shadowColor = "#ff3c32"; this.glow(ctx, broken ? 0 : 12);
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
      const bob = Math.sin(t * 3 + st.x) * 4;
      ctx.save();
      ctx.fillStyle = supplied ? "#b3d59a" : task.sabotaged ? "#d87762" : "#ffcd5a";
      ctx.shadowColor = supplied ? "#729a65" : "#ffcd5a"; this.glow(ctx, 8);
      ctx.translate(x, ground - 235 + bob);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "rgba(12,8,16,.78)";
      ctx.fillRect(x - 48, ground - 259, 96, 16);
      ctx.font = "bold 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = supplied ? "#b3d59a" : task.sabotaged ? "#d87762" : "#ffcd5a";
      ctx.fillText(supplied ? "PUZZLE" : task.sabotaged ? "SABOTAGED" : "NEEDS KIT", x, ground - 247);
      ctx.restore();
      if (task.progress > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(x - 30, ground - 215, 60, 8);
        ctx.fillStyle = "#ffcd5a";
        ctx.fillRect(x - 29, ground - 214, 58 * task.progress, 6);
      }
    }
  }
}

export const CAGE_POSITIONS = CAGE_XS;