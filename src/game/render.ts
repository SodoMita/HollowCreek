// Canvas renderer for Hollow Creek — pure drawing, no game logic.
// A painterly moonlit valley: tiled earth, curved roads, a black creek, real
// buildings, fog of war, lantern light and a hand-set HUD minimap.
import {
  BELL, CAGES, CREATURES, OBSTACLES, SQUARE, STATIONS, WORLD_H, WORLD_W,
} from "./types";
import type { Snapshot, Station, Vec } from "./types";
import { createDefaultSettings, type GameSettings } from "./settings";

interface Leaf { x: number; y: number; vx: number; vy: number; r: number; c: string; s: number }
interface Mist { x: number; y: number; r: number; a: number; vx: number }

const LEAF_COLORS = ["#b4552a", "#c9762f", "#8f3b1f", "#d99a3d", "#7a4a21"];
const INK = "#0B0A0C";
const NIGHT = "#14101A";
const BONE = "#E8DFCF";
const OXBLOOD = "#7B1220";
const SILVER = "#9FB6C6";

const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/** Roads of the valley, as world polylines. */
const ROADS: Vec[][] = [
  [{ x: 240, y: 2000 }, { x: 1400, y: 2180 }, { x: 2400, y: 2280 }, { x: 3500, y: 2380 }, { x: 4900, y: 2200 }, { x: 6200, y: 2000 }],
  [{ x: 3500, y: 2380 }, { x: 3300, y: 1500 }, { x: 3560, y: 700 }, { x: 3720, y: 180 }],
  [{ x: 2400, y: 2280 }, { x: 1600, y: 3100 }, { x: 900, y: 3700 }],
  [{ x: 4900, y: 2200 }, { x: 5300, y: 3000 }, { x: 5760, y: 3500 }],
  [{ x: 1400, y: 2180 }, { x: 1100, y: 1300 }, { x: 760, y: 800 }],
  [{ x: 3500, y: 2380 }, { x: 3800, y: 3200 }, { x: 3960, y: 3700 }],
];

/** The creek, as a thick world polyline. */
const CREEK: Vec[] = [
  { x: -100, y: 3200 }, { x: 900, y: 3320 }, { x: 1800, y: 3560 }, { x: 2600, y: 3420 },
  { x: 3400, y: 3620 }, { x: 4300, y: 3500 }, { x: 5200, y: 3680 }, { x: 6500, y: 3520 },
];

export class Renderer {
  private leaves: Leaf[] = [];
  private mist: Mist[] = [];
  private settings: GameSettings = createDefaultSettings();
  private ground: HTMLImageElement | null = null;
  private groundReady = false;
  cameraX = WORLD_W / 2;
  cameraY = WORLD_H / 2;
  private zoom = 1;

  constructor() {
    for (let i = 0; i < 130; i++) {
      this.leaves.push({
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        vx: -16 - Math.random() * 30,
        vy: 22 + Math.random() * 36,
        r: Math.random() * Math.PI * 2,
        c: LEAF_COLORS[i % LEAF_COLORS.length],
        s: 3 + Math.random() * 5,
      });
    }
    for (let i = 0; i < 26; i++) {
      this.mist.push({
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        r: 260 + Math.random() * 520,
        a: 0.05 + Math.random() * 0.08,
        vx: 4 + Math.random() * 10,
      });
    }
    if (typeof Image !== "undefined") {
      const img = new Image();
      img.onload = () => { this.groundReady = true; };
      img.onerror = () => { this.groundReady = false; };
      img.src = "images/ground.webp";
      this.ground = img;
    }
  }

  setSettings(settings: GameSettings) {
    this.settings = settings;
  }

  private qualityCount(high: number, medium: number, low: number) {
    return this.settings.graphics.quality === "high" ? high : this.settings.graphics.quality === "medium" ? medium : low;
  }

  render(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snap: Snapshot,
    display: Map<string, Vec>,
    t: number, // seconds
    dt: number
  ) {
    const graphics = this.settings.graphics;
    if (graphics.reducedMotion) dt = 0;
    const me = snap.players.find((p) => p.id === snap.self.id);
    const selfPos: Vec = me ? display.get(me.id) ?? { x: me.x, y: me.y } : { x: WORLD_W / 2, y: WORLD_H / 2 };

    const zoom = Math.max(0.42, Math.min(1, Math.min(w / 1500, h / 900)));
    this.zoom = zoom;
    const targetCam = { x: selfPos.x, y: selfPos.y };
    if (graphics.cameraSmoothing) {
      this.cameraX += (targetCam.x - this.cameraX) * Math.min(1, dt * 5);
      this.cameraY += (targetCam.y - this.cameraY) * Math.min(1, dt * 5);
    } else {
      this.cameraX = targetCam.x;
      this.cameraY = targetCam.y;
    }
    // gate weave — a hand-cranked projector never sits perfectly still
    const weave = graphics.reducedMotion ? 0 : Math.sin(t * 0.7) * 2.2 + Math.sin(t * 1.9) * 1.1;

    ctx.save();
    ctx.fillStyle = NIGHT;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2 + weave, h / 2 - weave * 0.5);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    const left = this.cameraX - w / 2 / zoom - 200;
    const right = this.cameraX + w / 2 / zoom + 200;
    const top = this.cameraY - h / 2 / zoom - 200;
    const bottom = this.cameraY + h / 2 / zoom + 200;

    this.drawGround(ctx, left, top, right, bottom, t);
    this.drawWater(ctx, t);
    this.drawRoads(ctx);
    this.drawSquare(ctx, t);
    this.drawStructures(ctx, left, top, right, bottom);
    this.drawTrees(ctx, left, top, right, bottom);
    this.drawStations(ctx, snap, t);
    this.drawProps(ctx, snap, t);

    // --- players ---
    for (const p of snap.players) {
      if (p.x < -1000) continue;
      const pos = display.get(p.id) ?? { x: p.x, y: p.y };
      this.drawPlayer(ctx, snap, p, pos, t);
    }

    // --- atmospherics ---
    this.drawMist(ctx, left, top, right, bottom, snap.weather?.kind === "fog" ? 2.1 : 1);
    this.drawLeaves(ctx, dt, top, bottom, left, right);
    this.drawLighting(ctx, w, h, snap, selfPos, zoom, t);
    ctx.restore();

    this.drawWayfinding(ctx, w, h, snap, selfPos, zoom);
    this.drawMinimap(ctx, w, h, snap, selfPos);
    this.drawGrain(ctx, w, h, t, graphics.reducedMotion);
  }

  // ---------------------------------------------------------------- ground

  private drawGround(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number, t: number) {
    ctx.fillStyle = "#171219";
    ctx.fillRect(left, top, right - left, bottom - top);
    if (this.groundReady && this.ground) {
      const tile = 700;
      ctx.save();
      ctx.globalAlpha = 0.82;
      const x0 = Math.floor(left / tile) * tile;
      const y0 = Math.floor(top / tile) * tile;
      for (let x = x0; x < right; x += tile) {
        for (let y = y0; y < bottom; y += tile) {
          ctx.drawImage(this.ground, x, y, tile, tile);
        }
      }
      ctx.restore();
      // moon-cool wash so the earth reads as night, not brown
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(40,34,66,0.55)";
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.restore();
    }

  }

  private drawRoads(ctx: CanvasRenderingContext2D) {
    for (const road of ROADS) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(road[0].x, road[0].y);
      for (let i = 1; i < road.length - 1; i++) {
        const xc = (road[i].x + road[i + 1].x) / 2;
        const yc = (road[i].y + road[i + 1].y) / 2;
        ctx.quadraticCurveTo(road[i].x, road[i].y, xc, yc);
      }
      const last = road[road.length - 1];
      ctx.lineTo(last.x, last.y);
      // one tone, one road — the earth is already busy enough
      ctx.strokeStyle = "rgba(56,45,42,0.55)";
      ctx.lineWidth = 88;
      ctx.stroke();
    }
  }

  private drawWater(ctx: CanvasRenderingContext2D, t: number) {
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(CREEK[0].x, CREEK[0].y);
    for (let i = 1; i < CREEK.length - 1; i++) {
      const xc = (CREEK[i].x + CREEK[i + 1].x) / 2;
      const yc = (CREEK[i].y + CREEK[i + 1].y) / 2;
      ctx.quadraticCurveTo(CREEK[i].x, CREEK[i].y, xc, yc);
    }
    ctx.lineTo(CREEK[CREEK.length - 1].x, CREEK[CREEK.length - 1].y);
    ctx.strokeStyle = "#07070C";
    ctx.lineWidth = 190;
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = SILVER;
    ctx.lineWidth = 3;
    for (let k = 0; k < 7; k++) {
      const off = ((t * 26 + k * 90) % 320) - 160;
      ctx.setLineDash([120, 220]);
      ctx.lineDashOffset = off * 2;
      ctx.stroke();
    }
    ctx.restore();
    ctx.setLineDash([]);
  }

  private drawSquare(ctx: CanvasRenderingContext2D, t: number) {
    const { x, y, w, h } = SQUARE;
    ctx.save();
    ctx.fillStyle = "rgba(58,48,52,0.85)";
    ctx.fillRect(x, y, w, h);
    // cobbles
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#6c5b56";
    ctx.lineWidth = 2;
    for (let gy = y + 20; gy < y + h; gy += 46) {
      const row = Math.floor((gy - y) / 46);
      for (let gx = x + (row % 2 ? 22 : 0); gx < x + w; gx += 46) {
        ctx.beginPath();
        ctx.arc(gx, gy, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // hairline rule, poster style
    ctx.strokeStyle = "rgba(232,223,207,0.35)";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.restore();
    // bell
    this.drawBell(ctx, BELL.x, BELL.y, t);
  }

  private drawBell(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
    const toll = Math.max(0, 1 - (Date.now() - (this.lastBell ?? 0)) / 2500);
    const swing = this.settings.graphics.reducedMotion ? 0 : Math.sin(t * 2.4) * 0.06 + toll * Math.sin(t * 9) * 0.35;
    ctx.save();
    ctx.translate(x, y);
    // post
    ctx.fillStyle = "#2b2028";
    ctx.fillRect(-70, -12, 14, -0);
    ctx.fillRect(-70, -190, 14, 190);
    ctx.fillRect(56, -190, 14, 190);
    ctx.fillRect(-70, -200, 140, 16);
    ctx.rotate(swing);
    const grad = ctx.createLinearGradient(-46, -190, 46, -80);
    grad.addColorStop(0, "#d8c48a");
    grad.addColorStop(0.5, "#8c7233");
    grad.addColorStop(1, "#4a3a16");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-46, -100);
    ctx.quadraticCurveTo(-52, -186, 0, -190);
    ctx.quadraticCurveTo(52, -186, 46, -100);
    ctx.lineTo(38, -88);
    ctx.lineTo(-38, -88);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#2a2114";
    ctx.fillRect(-38, -92, 76, 10);
    ctx.restore();
    void toll;
  }
  private lastBell = 0;

  // ------------------------------------------------------------ buildings

  private drawStructures(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number) {
    for (const o of OBSTACLES) {
      if (o.x + o.w < left || o.x > right || o.y + o.h < top || o.y > bottom) continue;
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      // ground shadow
      ctx.save();
      ctx.fillStyle = "rgba(6,5,10,0.55)";
      ctx.beginPath();
      ctx.ellipse(cx + 26, cy + 34, o.w * 0.62, o.h * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (o.kind === "pond") {
        ctx.save();
        ctx.fillStyle = "#080A12";
        ctx.beginPath();
        ctx.ellipse(cx, cy, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = SILVER;
        ctx.lineWidth = 3;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.ellipse(cx, cy, o.w / 2 - 24 - i * 22, o.h / 2 - 18 - i * 16, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      if (o.kind === "hedge") {
        ctx.fillStyle = "#191b16";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = "#242a1c";
        for (let i = 0; i < o.h / 60; i++) {
          ctx.beginPath();
          ctx.arc(o.x + o.w / 2, o.y + i * 60 + 30, 52, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }

      const wall = o.kind === "chapel" ? "#2a2430" : o.kind === "ruin" ? "#241f26" : "#2c2029";
      const roof =
        o.kind === "chapel" ? "#3a2b3c" :
        o.kind === "mill" ? "#2f2431" :
        o.kind === "barn" ? "#3b1d20" : "#241a22";
      ctx.fillStyle = wall;
      ctx.fillRect(o.x, o.y + o.h * 0.28, o.w, o.h * 0.72);
      // roof
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(o.x - 26, o.y + o.h * 0.3);
      ctx.lineTo(cx, o.y - o.h * 0.16);
      ctx.lineTo(o.x + o.w + 26, o.y + o.h * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(232,223,207,0.10)";
      ctx.lineWidth = 3;
      ctx.stroke();
      // windows: a few lit, most dead
      const cols = Math.max(2, Math.floor(o.w / 130));
      for (let i = 0; i < cols; i++) {
        const wx = o.x + 34 + i * ((o.w - 68) / cols);
        const lit = hash(o.x * 0.01 + i * 7.3) > 0.72;
        ctx.fillStyle = lit ? "rgba(224,165,42,0.55)" : "rgba(10,8,14,0.9)";
        ctx.fillRect(wx, o.y + o.h * 0.46, 34, 46);
      }
      if (o.kind === "chapel") {
        ctx.fillStyle = "#3f3346";
        ctx.fillRect(cx - 34, o.y - o.h * 0.62, 68, o.h * 0.5);
        ctx.fillStyle = OXBLOOD;
        ctx.fillRect(cx - 6, o.y - o.h * 0.92, 12, o.h * 0.22);
        ctx.fillRect(cx - 26, o.y - o.h * 0.82, 52, 12);
      }
      if (o.kind === "mill") {
        ctx.save();
        ctx.translate(o.x + o.w + 26, o.y + o.h * 0.62);
        ctx.rotate(Date.now() / 4200);
        ctx.strokeStyle = "#4b3b46";
        ctx.lineWidth = 12;
        for (let i = 0; i < 6; i++) {
          ctx.rotate(Math.PI / 3);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(150, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  private drawTrees(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number) {
    const step = 210;
    const gx0 = Math.floor(left / step);
    const gx1 = Math.ceil(right / step);
    const gy0 = Math.floor(top / step);
    const gy1 = Math.ceil(bottom / step);
    const count = this.qualityCount(1, 1, 1);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const seed = gx * 57.13 + gy * 131.7;
        if (hash(seed) > 0.34 * count) continue;
        const x = gx * step + hash(seed + 1) * step;
        const y = gy * step + hash(seed + 2) * step;
        if (x > SQUARE.x - 120 && x < SQUARE.x + SQUARE.w + 120 && y > SQUARE.y - 120 && y < SQUARE.y + SQUARE.h + 120) continue;
        let inObstacle = false;
        for (const o of OBSTACLES) {
          if (x > o.x - 70 && x < o.x + o.w + 70 && y > o.y - 70 && y < o.y + o.h + 70) { inObstacle = true; break; }
        }
        if (inObstacle) continue;
        const size = 62 + hash(seed + 3) * 52;
        ctx.fillStyle = "rgba(6,5,10,0.5)";
        ctx.beginPath();
        ctx.ellipse(x + 22, y + 26, size * 0.9, size * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#241a18";
        ctx.fillRect(x - 7, y - size * 0.2, 14, size * 0.8);
        const tone = hash(seed + 4);
        ctx.fillStyle = tone > 0.66 ? "#2c2216" : tone > 0.33 ? "#241c1c" : "#1c1a20";
        for (let i = 0; i < 4; i++) {
          const a = hash(seed + 5 + i) * Math.PI * 2;
          const r = size * (0.35 + hash(seed + 9 + i) * 0.35);
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * size * 0.42, y - size * 0.5 + Math.sin(a) * size * 0.3, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // --------------------------------------------------------------- props

  private drawStations(ctx: CanvasRenderingContext2D, snap: Snapshot, t: number) {
    for (const task of snap.tasks) {
      const st = STATIONS.find((s) => s.id === task.id);
      if (!st) continue;
      this.drawStationProp(ctx, st, task.done, task.progress, t);
    }
  }

  private drawStationProp(ctx: CanvasRenderingContext2D, st: Station, done: boolean, progress: number, t: number) {
    const { x, y } = st;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(6,5,10,0.5)";
    ctx.beginPath();
    ctx.ellipse(12, 18, 62, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    const lit = done ? "#4d6b4a" : "#5b4a2c";
    ctx.fillStyle = lit;
    switch (st.kind) {
      case "pumpkins":
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i % 2 ? "#a8631d" : "#8d4f18";
          ctx.beginPath();
          ctx.ellipse(-52 + i * 28, 6 + (i % 2) * 10, 22, 17, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case "well":
        ctx.fillStyle = "#3a3038";
        ctx.beginPath();
        ctx.arc(0, 0, 46, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0a0910";
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2f2429";
        ctx.fillRect(-46, -74, 12, 60);
        ctx.fillRect(34, -74, 12, 60);
        break;
      case "scarecrow":
        ctx.fillStyle = "#3c2c22";
        ctx.fillRect(-6, -86, 12, 100);
        ctx.fillRect(-52, -56, 104, 11);
        ctx.fillStyle = "#6d5b3c";
        ctx.beginPath();
        ctx.arc(0, -100, 20, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "lantern":
        ctx.fillStyle = "#2a2229";
        ctx.fillRect(-5, -110, 10, 116);
        ctx.fillStyle = done ? "#e0a52a" : "#4a3b22";
        ctx.fillRect(-18, -132, 36, 34);
        break;
      case "chapel":
        ctx.fillStyle = "#4a3b46";
        ctx.fillRect(-20, -62, 40, 68);
        ctx.fillStyle = "#e0a52a";
        ctx.fillRect(-8, -50, 16, 40);
        break;
      case "mill":
        ctx.fillStyle = "#4b3b46";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(-34 + i * 34, -10, 22, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case "graves":
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = "#3b333c";
          ctx.fillRect(-56 + i * 42, -44, 26, 52);
          ctx.beginPath();
          ctx.arc(-43 + i * 42, -44, 13, Math.PI, 0);
          ctx.fill();
        }
        break;
      case "radio":
        ctx.strokeStyle = "#5b4b52";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(-40, 12);
        ctx.lineTo(0, -130);
        ctx.lineTo(40, 12);
        ctx.stroke();
        ctx.fillStyle = OXBLOOD;
        ctx.beginPath();
        ctx.arc(0, -136, 9, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "silo":
        ctx.fillStyle = "#3c3038";
        ctx.fillRect(-40, -96, 80, 104);
        ctx.beginPath();
        ctx.moveTo(-46, -96);
        ctx.lineTo(0, -136);
        ctx.lineTo(46, -96);
        ctx.closePath();
        ctx.fill();
        break;
      case "beehive":
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = "#6b5222";
          ctx.beginPath();
          ctx.ellipse(-44 + i * 44, -6, 24, 30, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case "laundry":
        ctx.strokeStyle = "#5b4b52";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(-64, -10);
        ctx.lineTo(-64, -96);
        ctx.moveTo(64, -10);
        ctx.lineTo(64, -96);
        ctx.moveTo(-64, -92);
        ctx.lineTo(64, -92);
        ctx.stroke();
        ctx.fillStyle = "#c8bda6";
        for (let i = 0; i < 4; i++) ctx.fillRect(-56 + i * 30, -90, 22, 46);
        break;
      case "woodpile":
        ctx.fillStyle = "#4a3526";
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          ctx.arc(-44 + (i % 3) * 42, -18 + Math.floor(i / 3) * 34, 20, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case "gate":
        ctx.fillStyle = "#3c2c22";
        ctx.fillRect(-72, -70, 14, 82);
        ctx.fillRect(58, -70, 14, 82);
        ctx.fillRect(-72, -62, 158, 12);
        ctx.fillRect(-72, -22, 158, 12);
        break;
      case "bridge":
        ctx.fillStyle = "#4a3526";
        ctx.fillRect(-90, -26, 180, 52);
        ctx.strokeStyle = "#2b1e17";
        ctx.lineWidth = 5;
        for (let i = -80; i < 90; i += 26) {
          ctx.beginPath();
          ctx.moveTo(i, -26);
          ctx.lineTo(i, 26);
          ctx.stroke();
        }
        break;
    }
    // progress ring
    if (progress > 0 && !done) {
      ctx.strokeStyle = "rgba(232,223,207,0.85)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, -150, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
    }
    // a plain stake in the ground marks the work; nothing blinks at you
    ctx.strokeStyle = done ? "rgba(127,176,105,0.45)" : "rgba(123,18,32,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawProps(ctx: CanvasRenderingContext2D, snap: Snapshot, t: number) {
    // cages
    for (const c of snap.cages) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.fillStyle = "rgba(6,5,10,0.55)";
      ctx.beginPath();
      ctx.ellipse(10, 26, 66, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#4c4148";
      ctx.lineWidth = 9;
      ctx.strokeRect(-48, -70, 96, 104);
      for (let i = -32; i <= 32; i += 16) {
        ctx.beginPath();
        ctx.moveTo(i, -70);
        ctx.lineTo(i, 34);
        ctx.stroke();
      }
      ctx.restore();
    }
    // iron key
    if (snap.keyPos) {
      ctx.save();
      ctx.translate(snap.keyPos.x, snap.keyPos.y);
      const bob = this.settings.graphics.reducedMotion ? 0 : Math.sin(t * 2.2) * 6;
      ctx.translate(0, bob);
      ctx.rotate(-0.5);
      ctx.strokeStyle = "#c9b273";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(0, -18, 18, 0, Math.PI * 2);
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 54);
      ctx.moveTo(0, 36);
      ctx.lineTo(22, 36);
      ctx.moveTo(0, 50);
      ctx.lineTo(18, 50);
      ctx.stroke();
      ctx.restore();
    }
    // the thing in the fog
    if (snap.stalker) {
      ctx.save();
      ctx.translate(snap.stalker.x, snap.stalker.y);
      const halo = ctx.createRadialGradient(0, 0, 6, 0, 0, 210);
      halo.addColorStop(0, "rgba(18,10,26,0.94)");
      halo.addColorStop(1, "rgba(18,10,26,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, 210, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0d0a12";
      ctx.beginPath();
      ctx.moveTo(-36, 66);
      ctx.quadraticCurveTo(-48, -28, -19, -62);
      ctx.lineTo(19, -62);
      ctx.quadraticCurveTo(48, -28, 36, 66);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(123,18,32,0.55)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#C2404C";
      ctx.beginPath();
      ctx.ellipse(-9, -36, 5, 7, 0, 0, Math.PI * 2);
      ctx.ellipse(9, -36, 5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // bodies
    for (const b of snap.bodies) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = "rgba(6,5,10,0.6)";
      ctx.beginPath();
      ctx.ellipse(8, 22, 72, 32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 52, 24, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2a1013";
      ctx.beginPath();
      ctx.ellipse(-32, 8, 30, 16, -0.35, 0, Math.PI * 2);
      ctx.fill();
      // crows
      for (let i = 0; i < 3; i++) {
        const a = t * 1.1 + i * 2.1;
        const cx = Math.cos(a) * 92;
        const cy = -40 + Math.sin(a * 1.4) * 26;
        ctx.fillStyle = "#0c0a10";
        ctx.beginPath();
        ctx.ellipse(cx, cy, 13, 7, Math.sin(a * 3) * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    void snap;
  }

  // -------------------------------------------------------------- figures

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    snap: Snapshot,
    p: Snapshot["players"][number],
    pos: Vec,
    t: number
  ) {
    const isSelf = p.id === snap.self.id;
    const ghost = !p.alive;
    const creature = CREATURES.find((c) => c.id === p.creature) ?? CREATURES[0];
    const bob = this.settings.graphics.reducedMotion || !p.moving ? 0 : Math.sin(t * 9 + pos.x * 0.02) * 5;
    if (p.downed) {
      ctx.save();
      ctx.translate(pos.x, pos.y);
      this.drawFallen(ctx, snap, p, t);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(pos.x, pos.y + bob);
    if (ghost) ctx.globalAlpha = 0.42;

    // shadow
    ctx.fillStyle = "rgba(6,5,10,0.6)";
    ctx.beginPath();
    ctx.ellipse(6, 34, 44, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // cloak
    const grad = ctx.createLinearGradient(0, -60, 0, 34);
    grad.addColorStop(0, p.color);
    grad.addColorStop(1, "#191218");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-30, 32);
    ctx.quadraticCurveTo(-38, -22, -18, -46);
    ctx.lineTo(18, -46);
    ctx.quadraticCurveTo(38, -22, 30, 32);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(11,10,12,0.8)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // head + shroud
    ctx.fillStyle = "#d9cfc0";
    ctx.beginPath();
    ctx.arc(0, -66, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#171219";
    ctx.beginPath();
    ctx.arc(0, -70, 22, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    // eyes: hollow black, oxblood for the hungry
    ctx.fillStyle = snap.self.role === "hollow" && p.id === snap.self.id ? OXBLOOD : "#0b0a0c";
    ctx.beginPath();
    ctx.ellipse(-8 * p.facing, -66, 4.6, 6.4, 0, 0, Math.PI * 2);
    ctx.ellipse(9 * p.facing, -66, 4.6, 6.4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (creature.sigil === "wolf") {
      ctx.fillStyle = "#171219";
      ctx.beginPath();
      ctx.moveTo(-20, -82);
      ctx.lineTo(-10, -104);
      ctx.lineTo(-2, -82);
      ctx.moveTo(20, -82);
      ctx.lineTo(10, -104);
      ctx.lineTo(2, -82);
      ctx.fill();
    }
    if (creature.sigil === "banshee") {
      ctx.strokeStyle = SILVER;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -66, 32, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }

    // host carries the lantern
    if (p.isHost) {
      const glow = ctx.createRadialGradient(42 * p.facing, -10, 4, 42 * p.facing, -10, 150);
      glow.addColorStop(0, "rgba(224,165,42,0.42)");
      glow.addColorStop(1, "rgba(224,165,42,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(42 * p.facing, -10, 150, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e0a52a";
      ctx.fillRect(34 * p.facing, -30, 16, 22);
    }

    // name plate — tracked small caps on a bone rule
    const label = p.name.toUpperCase();
    ctx.font = "600 15px 'Space Grotesk', system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(11,10,12,0.72)";
    ctx.fillRect(-tw / 2 - 12, -124, tw + 24, 26);
    ctx.fillStyle = isSelf ? "#E8DFCF" : "rgba(232,223,207,0.82)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, -111);
    if (p.isHost) {
      ctx.fillStyle = "#e0a52a";
      ctx.fillRect(-tw / 2 - 12, -99, tw + 24, 3);
    }

    if (p.hasKey) {
      ctx.fillStyle = "#c9b273";
      ctx.beginPath();
      ctx.arc(26, -4, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    if (p.caged) {
      ctx.strokeStyle = "rgba(159,182,198,0.5)";
      ctx.lineWidth = 4;
      ctx.strokeRect(-52, -100, 104, 140);
    }

    // speech bubble
    if (p.bubble) {
      ctx.font = "500 17px 'Space Grotesk', system-ui, sans-serif";
      const text = p.bubble.text.slice(0, 42);
      const bw = Math.max(120, ctx.measureText(text).width + 34);
      ctx.fillStyle = "rgba(232,223,207,0.94)";
      ctx.fillRect(-bw / 2, -186, bw, 44);
      ctx.beginPath();
      ctx.moveTo(-10, -142);
      ctx.lineTo(12, -142);
      ctx.lineTo(0, -126);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#14101A";
      ctx.fillText(text, 0, -164);
    }
    ctx.restore();
  }

  /** A townsfolk laid out by the fog, waiting for a friend. */
  private drawFallen(
    ctx: CanvasRenderingContext2D,
    snap: Snapshot,
    p: Snapshot["players"][number],
    t: number
  ) {
    ctx.fillStyle = "rgba(6,5,10,0.6)";
    ctx.beginPath();
    ctx.ellipse(6, 30, 76, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.rotate(0.18);
    const grad = ctx.createLinearGradient(0, -30, 0, 30);
    grad.addColorStop(0, p.color);
    grad.addColorStop(1, "#191218");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 62, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d9cfc0";
    ctx.beginPath();
    ctx.arc(52, -12, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // raise ring
    const revive = p.id === snap.self.id ? snap.self.revive : 0;
    ctx.strokeStyle = "rgba(123,18,32,0.85)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 84, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.04, revive));
    ctx.stroke();
    ctx.strokeStyle = "rgba(159,182,198,0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 84, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "600 15px 'Space Grotesk', system-ui, sans-serif";
    const label = (p.name + " · DOWN").toUpperCase();
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(11,10,12,0.78)";
    ctx.fillRect(-tw / 2 - 12, -134, tw + 24, 26);
    ctx.fillStyle = "#C2404C";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, -121);
    void t;
  }

  // ------------------------------------------------------------ atmospherics

  private drawMist(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number, boost = 1) {
    ctx.save();
    for (const m of this.mist) {
      if (m.x < left - m.r || m.x > right + m.r || m.y < top - m.r || m.y > bottom + m.r) continue;
      const grad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
      grad.addColorStop(0, `rgba(159,182,198,${Math.min(0.3, m.a * boost)})`);
      grad.addColorStop(1, "rgba(159,182,198,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawLeaves(ctx: CanvasRenderingContext2D, dt: number, top: number, bottom: number, left: number, right: number) {
    const n = this.qualityCount(this.leaves.length, Math.floor(this.leaves.length * 0.6), Math.floor(this.leaves.length * 0.3));
    ctx.save();
    for (let i = 0; i < n; i++) {
      const l = this.leaves[i];
      if (dt > 0) {
        l.x += l.vx * dt;
        l.y += l.vy * dt;
        l.r += dt * 1.6;
        if (l.x < left - 40) l.x = right + 40;
        if (l.y > bottom + 40) { l.y = top - 40; l.x = left + Math.random() * (right - left); }
      }
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.r);
      ctx.fillStyle = l.c;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(-l.s, -l.s * 0.5, l.s * 2, l.s);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawLighting(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snap: Snapshot,
    selfPos: Vec,
    zoom: number,
    t: number
  ) {
    const blackout = Date.now() < snap.blackoutUntil;
    const foggy = snap.weather?.kind === "fog";
    const radius = (blackout ? Math.min(snap.visionRadius, 260) : snap.visionRadius) * zoom;

    // world-space moon wash
    ctx.save();
    const moon = ctx.createLinearGradient(selfPos.x - 900, selfPos.y - 900, selfPos.x + 900, selfPos.y + 900);
    moon.addColorStop(0, "rgba(159,182,198,0.16)");
    moon.addColorStop(1, "rgba(20,16,26,0.05)");
    ctx.fillStyle = moon;
    ctx.fillRect(selfPos.x - 1600, selfPos.y - 1200, 3200, 2400);
    ctx.restore();

    // fog of war, drawn in screen space around the player
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = w / 2;
    const cy = h / 2;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.42, cx, cy, radius * 1.35);
    grad.addColorStop(0, "rgba(10,9,12,0)");
    grad.addColorStop(0.72, blackout ? "rgba(8,6,12,0.72)" : foggy ? "rgba(14,12,22,0.58)" : "rgba(12,9,18,0.42)");
    grad.addColorStop(1, blackout ? "rgba(6,4,10,0.97)" : foggy ? "rgba(12,10,20,0.92)" : "rgba(10,8,16,0.86)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // vignette
    const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.32, cx, cy, Math.max(w, h) * 0.78);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(6,5,10,0.72)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    // oxblood danger bloom — the dread the score is singing about
    if (snap.danger > 0.02) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      const d = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
      d.addColorStop(0, `rgba(123,18,32,${0.06 * snap.danger})`);
      d.addColorStop(1, `rgba(123,18,32,${(0.2 + 0.12 * pulse) * snap.danger})`);
      ctx.fillStyle = d;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
    void t;
  }

  /** Where the work is: the three nearest unfinished wards, always on screen. */
  private drawWayfinding(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snap: Snapshot,
    selfPos: Vec,
    zoom: number
  ) {
    const pending = snap.tasks.filter((t) => !t.done);
    if (!pending.length || snap.phase === "ended") return;
    const cx = w / 2;
    const cy = h / 2;
    const ring = Math.min(w, h) * 0.34;
    const items = pending
      .map((t) => ({ t, d: Math.hypot(t.x - selfPos.x, t.y - selfPos.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const { t, d } of items) {
      const sx = cx + (t.x - selfPos.x) * zoom;
      const sy = cy + (t.y - selfPos.y) * zoom;
      const onScreen = sx > 80 && sx < w - 80 && sy > 80 && sy < h - 120;
      const ang = Math.atan2(t.y - selfPos.y, t.x - selfPos.x);
      const px = onScreen ? sx : cx + Math.cos(ang) * ring;
      const py = onScreen ? sy : cy + Math.sin(ang) * ring;
      ctx.save();
      if (onScreen) {
        ctx.strokeStyle = "rgba(194,64,76,0.75)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, 34, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.fillStyle = "rgba(123,18,32,0.92)";
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(-9, -10);
        ctx.lineTo(-9, 10);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      const label = `${Math.round(d / 10)} m`;
      ctx.font = "500 12px 'Space Grotesk', system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(11,10,12,0.72)";
      ctx.fillRect(px - tw / 2 - 7, py + 14, tw + 14, 19);
      ctx.fillStyle = "#E8DFCF";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px, py + 24);
    }
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, w: number, h: number, snap: Snapshot, selfPos: Vec) {
    const mw = Math.min(260, w * 0.34);
    const mh = mw * (WORLD_H / WORLD_W);
    const x0 = w - mw - 18;
    const y0 = h - mh - 18;
    const sx = mw / WORLD_W;
    const sy = mh / WORLD_H;
    ctx.save();
    ctx.fillStyle = "rgba(11,10,12,0.78)";
    ctx.fillRect(x0 - 10, y0 - 10, mw + 20, mh + 20);
    ctx.strokeStyle = "rgba(232,223,207,0.42)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 - 10, y0 - 10, mw + 20, mh + 20);
    // terrain blocks
    ctx.fillStyle = "rgba(123,18,32,0.10)";
    ctx.fillRect(x0, y0, mw, mh);
    ctx.fillStyle = "rgba(232,223,207,0.14)";
    for (const o of OBSTACLES) ctx.fillRect(x0 + o.x * sx, y0 + o.y * sy, Math.max(2, o.w * sx), Math.max(2, o.h * sy));
    // square
    ctx.strokeStyle = "rgba(224,165,42,0.75)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + SQUARE.x * sx, y0 + SQUARE.y * sy, SQUARE.w * sx, SQUARE.h * sy);
    // wards
    for (const task of snap.tasks) {
      if (task.done) continue;
      ctx.fillStyle = "#7B1220";
      ctx.fillRect(x0 + task.x * sx - 2, y0 + task.y * sy - 2, 4, 4);
    }
    // teammates / seen players
    for (const p of snap.players) {
      if (p.x < -1000) continue;
      ctx.fillStyle = p.id === snap.self.id ? "#E8DFCF" : p.color;
      ctx.beginPath();
      ctx.arc(x0 + p.x * sx, y0 + p.y * sy, p.id === snap.self.id ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // self viewport ring
    ctx.strokeStyle = "rgba(159,182,198,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x0 + selfPos.x * sx, y0 + selfPos.y * sy, snap.visionRadius * sx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private grainCanvas: HTMLCanvasElement | null = null;
  private drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, reduced: boolean) {
    if (reduced || this.settings.graphics.quality === "low") return;
    if (!this.grainCanvas) {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 160;
      const g = c.getContext("2d");
      if (!g) return;
      const img = g.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 120 + Math.random() * 135;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 22;
      }
      g.putImageData(img, 0, 0);
      this.grainCanvas = c;
    }
    const pattern = ctx.createPattern(this.grainCanvas, "repeat");
    if (!pattern) return;
    ctx.save();
    const shift = Math.floor(t * 12) % 64;
    pattern.setTransform(new DOMMatrix().translate(shift, -shift));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

export const CAGE_POSITIONS = CAGES;
