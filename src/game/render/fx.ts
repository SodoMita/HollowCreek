// Atmosphere over the scene: falling leaves, fireflies, low fog, foreground
// reeds, the lantern-light darkness, the past wash, the baked screen overlay
// (vignette + grade + grain) and the horror flicker. All pooled sprites and
// baked textures — the frame loop only moves and fades them.
import { Container, Sprite } from "pixi.js";
import { WORLD_MAX, WORLD_MIN, treeX } from "../buildings";
import { getArtScale } from "../svg-assets";
import { LEAF_COLORS } from "./palette";
import { bakeTextureUncached, bakedTexture, releaseTexture, circleTexture, darknessTexture, fogTexture, lightTexture, whiteTexture } from "./textures";
import { pick, type View } from "./view";

export interface FxLayers {
  world: Container;
  fog: Container;
  reeds: Container;
  dark: Container;
  past: Sprite;
  overlay: Sprite;
  flicker: Sprite;
}

export interface Leaf { x: number; y: number; vx: number; vy: number; r: number; c: string; s: number }

// Deterministic recycling: no Math.random() in the frame loop.
let leafSeed = 1;
const nextRand = () => ((leafSeed = (Math.imul(leafSeed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);

/** 110 falling leaves, scattered across the road at construction. */
export function makeLeaves(): Leaf[] {
  const leaves: Leaf[] = [];
  for (let i = 0; i < 110; i++) {
    leaves.push({
      x: WORLD_MIN + Math.random() * (WORLD_MAX - WORLD_MIN),
      y: Math.random() * 600,
      vx: -12 - Math.random() * 25,
      vy: 18 + Math.random() * 30,
      r: Math.random() * Math.PI * 2,
      c: LEAF_COLORS[i % LEAF_COLORS.length],
      s: 3 + Math.random() * 4,
    });
  }
  return leaves;
}

function spr(parent: Container, tex?: import("pixi.js").Texture): Sprite {
  const s = new Sprite(tex);
  parent.addChild(s);
  return s;
}

const leafTextures = new Map<string, import("pixi.js").Texture>();
function leafTexture(color: string): import("pixi.js").Texture {
  let tex = leafTextures.get(color);
  if (!tex) {
    tex = bakedTexture(`leaf|${color}`, 24, 14, 1, (g) => {
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(12, 7, 10, 5, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(40,18,10,.45)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(2, 7);
      g.lineTo(22, 7);
      g.stroke();
    });
    leafTextures.set(color, tex);
  }
  return tex;
}

export class Fx {
  private leafSprites: Sprite[] = [];
  private fireflies: { glow: Sprite; core: Sprite }[] = [];
  private fogSprites: Sprite[] = [];
  private reedTiles: Sprite[] = [];
  private darkGrad!: Sprite;
  private darkRects: Sprite[] = [];
  private warm!: Sprite;
  private overlayKey = "";
  private overlayTex: import("pixi.js").Texture | null = null;

  constructor(private layers: FxLayers, private leaves: Leaf[]) {
    for (let i = 0; i < leaves.length; i++) {
      const s = spr(layers.world, );
      s.anchor.set(0.5, 0.5);
      s.alpha = 0.72;
      s.texture = leafTexture(leaves[i].c);
      this.leafSprites.push(s);
    }
    for (let i = 0; i < 18; i++) {
      const glow = spr(layers.world, lightTexture(i % 3 !== 0 ? "255,200,110" : "190,230,140"));
      glow.anchor.set(0.5, 0.5);
      glow.width = 14;
      glow.height = 14;
      const core = spr(layers.world, circleTexture());
      core.anchor.set(0.5, 0.5);
      core.width = 3.2;
      core.height = 3.2;
      this.fireflies.push({ glow, core });
    }
    for (let i = 0; i < 4; i++) {
      const f = spr(layers.fog, fogTexture());
      f.height = 50;
      this.fogSprites.push(f);
    }
    const reedTex = bakedTexture(`reeds|${getArtScale()}`, Math.ceil(150 * getArtScale()), Math.ceil(70 * getArtScale()), getArtScale(), (g, pw, ph) => {
      const s = getArtScale();
      g.fillStyle = "#050308";
      g.strokeStyle = "#050308";
      // One 150-wide strip of blades and a cattail, matching the old path art.
      for (let seed = 0; seed < 3; seed++) {
        const bx = seed * 50;
        const count = 4 + (seed % 3);
        for (let b = 0; b < count; b++) {
          const x = (bx + b * 7 + (seed % 5)) * s;
          const bh = (13 + ((seed * 7 + b * 13) % 17)) * s;
          g.beginPath();
          g.moveTo(x, ph);
          g.quadraticCurveTo(x + 1 * s, ph - bh * 0.6, x + (b % 2 ? 3 : -3) * s, ph - bh);
          g.quadraticCurveTo(x + 2 * s, ph - bh * 0.5, x + 3.4 * s, ph);
          g.closePath();
          g.fill();
        }
      }
      g.lineWidth = 2.4 * s;
      g.beginPath();
      g.moveTo(46 * s, ph);
      g.quadraticCurveTo(48 * s, ph - 25 * s, 50 * s, ph - 42 * s);
      g.stroke();
      g.beginPath();
      g.ellipse(50 * s, ph - 48 * s, 3.2 * s, 8 * s, 0, 0, Math.PI * 2);
      g.fill();
    });
    for (let i = 0; i < 24; i++) {
      const tile = spr(layers.reeds, reedTex);
      tile.position.set(i * 150, -70);
      tile.width = 150;
      tile.height = 70;
      this.reedTiles.push(tile);
    }
    // Darkness: a gradient disc at the lantern plus four near-opaque rects
    // covering the rest of the screen (corners sit at the gradient's edge).
    this.darkGrad = spr(layers.dark, darknessTexture());
    this.darkGrad.anchor.set(0.5, 0.5);
    for (let i = 0; i < 4; i++) {
      const r = spr(layers.dark, whiteTexture());
      r.tint = 0x030106;
      r.alpha = 0.965;
      this.darkRects.push(r);
    }
    this.warm = spr(layers.dark, lightTexture("255,178,92"));
    this.warm.anchor.set(0.5, 0.5);
    this.warm.alpha = 0.07;
  }

  /** Advances every atmosphere layer. Returns the smoothed vision radius. */
  update(v: View, visionR: number): number {
    this.updateLeaves(v);
    this.updateFireflies(v);
    this.updateFogAndReeds(v);
    const nextVision = this.updateDarkness(v, visionR);
    this.layers.past.visible = v.snap.time?.mode === "past";
    if (this.layers.past.visible) {
      this.layers.past.width = v.cssW;
      this.layers.past.height = v.cssH;
    }
    this.updateOverlay(v);
    const since = v.now - v.snap.flickerAt;
    const flick = v.settings.graphics.flicker && !v.reduced && since >= 0 && since < 900;
    this.layers.flicker.visible = flick;
    if (flick) {
      const a = Math.random() < 0.5 ? 0.55 : 0.15;
      this.layers.flicker.alpha = a * (1 - since / 900);
      this.layers.flicker.width = v.cssW;
      this.layers.flicker.height = v.cssH;
    }
    return nextVision;
  }

  private updateLeaves(v: View): void {
    const count = v.settings.graphics.particles && !v.reduced ? pick(v.quality, 100, 55, 22) : 0;
    const groundWorld = v.h * 0.78;
    for (let i = 0; i < this.leafSprites.length; i++) {
      const s = this.leafSprites[i];
      if (i >= count) { s.visible = false; continue; }
      const l = this.leaves[i];
      l.x += l.vx * v.dt;
      l.y += l.vy * v.dt;
      l.r += v.dt * 2;
      if (l.y > groundWorld + 10) { l.y = -20; l.x = v.cam + nextRand() * v.w; }
      if (l.x < v.cam - 60) l.x = v.cam + v.w + 40;
      if (l.x < v.cam - 20 || l.x > v.cam + v.w + 20) { s.visible = false; continue; }
      s.visible = true;
      s.position.set(l.x, l.y * (v.h / 700) - groundWorld);
      s.rotation = l.r;
      s.width = l.s * 2.4;
      s.height = l.s * 1.4;
    }
  }

  private updateFireflies(v: View): void {
    const season = Math.max(0, 1 - v.night * 1.15);
    const count = v.settings.graphics.particles ? pick(v.quality, 18, 12, 6) : 0;
    for (let i = 0; i < this.fireflies.length; i++) {
      const f = this.fireflies[i];
      if (i >= count || season <= 0.02) { f.glow.visible = false; f.core.visible = false; continue; }
      const anchor = treeX(i * 5 - 6);
      const fx = anchor + Math.sin(v.t * (0.21 + (i % 5) * 0.05) + i * 2.4) * (46 + (i % 4) * 22);
      if (fx < v.cam - 20 || fx > v.cam + v.w + 20) { f.glow.visible = false; f.core.visible = false; continue; }
      const fy = -34 - (i % 6) * 16 + Math.sin(v.t * (0.5 + (i % 3) * 0.2) + i) * 12;
      const blink = Math.pow(Math.max(0, Math.sin(v.t * (0.9 + (i % 4) * 0.3) + i * 1.7)), 3);
      const a = blink * season * 0.85;
      if (a < 0.03) { f.glow.visible = false; f.core.visible = false; continue; }
      const warm = i % 3 !== 0;
      f.glow.visible = v.glow;
      f.glow.position.set(fx, fy);
      f.glow.alpha = a * 0.8;
      f.core.visible = true;
      f.core.position.set(fx, fy);
      f.core.tint = warm ? 0xffd98a : 0xc8e896;
      f.core.alpha = a;
    }
  }

  private updateFogAndReeds(v: View): void {
    const layers = v.settings.graphics.fog ? pick(v.quality, 4, 3, 1) : 0;
    for (let i = 0; i < this.fogSprites.length; i++) {
      const f = this.fogSprites[i];
      if (i >= layers) { f.visible = false; continue; }
      f.visible = true;
      const drift = Math.sin(v.t * 0.24 + i * 2) * 70;
      f.position.set(drift - 90, -24 - i * 25 - 25);
      f.width = v.w + 180;
      f.alpha = 0.075 + i * 0.018;
    }
    const showReeds = v.quality !== "low";
    const tiles = showReeds ? Math.min(this.reedTiles.length, Math.ceil(v.cssW / (150 * v.zoom)) + 2) : 0;
    for (let i = 0; i < this.reedTiles.length; i++) this.reedTiles[i].visible = i < tiles;
  }

  private updateDarkness(v: View, visionR: number): number {
    const targetR = v.snap.visionRadius;
    if (targetR >= 1500) {
      this.layers.dark.visible = false;
      return 420;
    }
    this.layers.dark.visible = true;
    const vr = visionR + (targetR - visionR) * Math.min(1, v.dt * 3.5);
    const rWorld = Math.max(80, vr + Math.sin(v.t * 7.3) * 6);
    const cx = (v.meX - v.cam) * v.zoom;
    const cy = v.cssH * 0.78 + v.lift * v.zoom - 50 * v.zoom;
    const r = rWorld * v.zoom;
    this.darkGrad.position.set(cx, cy);
    this.darkGrad.width = r * 2;
    this.darkGrad.height = r * 2;
    this.warm.position.set(cx, cy);
    this.warm.width = r * 1.4;
    this.warm.height = r * 1.4;
    // Rects around the gradient square: top, bottom, left, right.
    const [top, bottom, left, right] = this.darkRects;
    top.position.set(0, 0);
    top.width = v.cssW;
    top.height = Math.max(0, cy - r);
    top.visible = top.height > 0;
    bottom.position.set(0, cy + r);
    bottom.width = v.cssW;
    bottom.height = Math.max(0, v.cssH - (cy + r));
    bottom.visible = bottom.height > 0;
    left.position.set(0, Math.max(0, cy - r));
    left.width = Math.max(0, cx - r);
    left.height = Math.min(v.cssH, cy + r) - Math.max(0, cy - r);
    left.visible = left.width > 0 && left.height > 0;
    right.position.set(cx + r, Math.max(0, cy - r));
    right.width = Math.max(0, v.cssW - (cx + r));
    right.height = left.height;
    right.visible = right.width > 0 && right.height > 0;
    return vr;
  }

  private updateOverlay(v: View): void {
    const vignette = v.settings.graphics.vignette;
    const grade = v.quality !== "low";
    const grain = v.quality === "high" && !v.reduced;
    this.layers.overlay.visible = vignette || grade || grain;
    if (!this.layers.overlay.visible) return;
    const key = `ov|${v.cssW}x${v.cssH}|${v.res}|${v.nb}|${vignette}|${grade}|${grain}`;
    if (key !== this.overlayKey) {
      this.overlayKey = key;
      const res = v.res;
      const nb = v.nb;
      const tex = bakeTextureUncached(
        Math.max(2, Math.round(v.cssW * res)), Math.max(2, Math.round(v.cssH * res)), res, (g, pw, ph) => {
          if (grade) {
            const lg = g.createLinearGradient(0, 0, 0, ph);
            lg.addColorStop(0, `rgba(46,92,112,${0.12 + 0.06 * nb})`);
            lg.addColorStop(0.55, "rgba(60,50,70,0.05)");
            lg.addColorStop(1, "rgba(214,130,52,0.14)");
            g.fillStyle = lg;
            g.fillRect(0, 0, pw, ph);
          }
          if (vignette) {
            const vg = g.createRadialGradient(pw / 2, ph / 2, ph * 0.35, pw / 2, ph / 2, ph * 0.95);
            vg.addColorStop(0, "rgba(0,0,0,0)");
            vg.addColorStop(1, `rgba(4,2,7,${0.6 + 0.25 * nb})`);
            g.fillStyle = vg;
            g.fillRect(0, 0, pw, ph);
          }
          if (grain) {
            const tile = grainTileCanvas();
            const pattern = g.createPattern(tile, "repeat");
            if (pattern) {
              g.globalAlpha = 0.05;
              g.fillStyle = pattern;
              g.fillRect(0, 0, pw, ph);
              g.globalAlpha = 1;
            }
          }
        });
      if (this.overlayTex) releaseTexture(this.overlayTex);
      this.overlayTex = tex;
      this.layers.overlay.texture = tex;
    }
    this.layers.overlay.width = v.cssW;
    this.layers.overlay.height = v.cssH;
  }
}

let grainTile: HTMLCanvasElement | null = null;
function grainTileCanvas(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  const img = g.createImageData(128, 128);
  let s = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const value = 96 + (s % 64);
    img.data[i] = value;
    img.data[i + 1] = value;
    img.data[i + 2] = value;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}
