// The static world as a retained Pixi scene: sky and hills baked to textures,
// every structure/house/station a sprite whose texture, alpha or visibility is
// updated in place. Nothing is rebuilt per frame; off-screen groups are hidden
// before any child work happens.
import { Container, Sprite, Texture } from "pixi.js";
import { BUILDINGS, TREE_MAX, TREE_MIN, WORLD_MIN, doorX, treeX, type Building } from "../buildings";
import { roomItems, spriteFor } from "../svg-assets";
import { BELL_X, CAGE_XS, MEETING_FROM, MEETING_TO, STATIONS, type Station, type TaskView } from "../types";
import { MEETING_HOUSE, NOTE_FAR, NOTE_NEAR } from "../units";
import { getArtScale } from "../svg-assets";
import { lightCanvas, makeCanvas, measureTextWidth } from "./paint";
import { GROUND_DUSK, GROUND_NIGHT, SKY_DUSK, SKY_NIGHT, lerpHex } from "./palette";
import {
  artTexture, bakeTextureUncached, bakedTexture, releaseTexture, circleTexture, diamondTexture, ellipseTexture, labelTexture,
  lightTexture, textureOf, whiteTexture, windowGlowTexture, wrapText,
} from "./textures";
import { clamp, type PinnedNote, type View } from "./view";

export interface StaticLayers {
  sky: Sprite;
  far: Container;
  hillsFar: Container;
  hillsNear: Container;
  trees: Container;
  dressing: Container;
  interiors: Container;
  stations: Container;
  cart: Container;
  kits: Container;
  notes: Container;
  bell: Container;
  cageBacks: Container;
  keys: Container;
  exteriors: Container;
  cageFronts: Container;
}

const WALL_HEIGHT = 112;
const ROOF_HEIGHT = 158;

function spr(parent: Container, tex?: Texture): Sprite {
  const s = new Sprite(tex);
  parent.addChild(s);
  return s;
}

/** Points a sprite at an art texture; invisible until the file has loaded. */
function setArt(s: Sprite, path: string, w: number, h: number): void {
  const tex = artTexture(path, w, h);
  if (tex) {
    if (s.texture !== tex) s.texture = tex;
    s.renderable = true;
  } else s.renderable = false;
}

/** A light-falloff sprite (the baked replacement for shadowBlur glows). */
function lightSpr(parent: Container, rgb: string, x: number, y: number, rx: number, ry: number, alpha: number): Sprite {
  const s = spr(parent, lightTexture(rgb));
  s.anchor.set(0.5, 0.5);
  s.position.set(x, y);
  s.width = rx * 2;
  s.height = ry * 2;
  s.alpha = alpha;
  return s;
}

const FENCE_XS = [-3520, -3300, -2950, -2760, -2180, -1460, -1250, -700, -120, 420, 760, 1560, 1860, 2560, 2960, 3320, 3780, 4180, 4420, 5100, 5260, 5980, 6280, 6900, 7180, 7480, 7760, 8260, 8480];

/** Each structure's box in world units, relative to the road point at (0, 0). */
const STRUCTURE_BOX = {
  "pumpkin-shed": [-90, -110, 180, 116],
  well: [-60, -100, 120, 106],
  scarecrow: [-60, -120, 120, 124],
  lantern: [-40, -115, 80, 119],
  chapel: [-140, -470, 280, 476],
  mill: [-95, -120, 190, 124],
  "mill-sails": [-46, -46, 92, 92],
  graves: [-75, -50, 200, 60],
  radio: [-70, -210, 140, 214],
  silo: [-45, -180, 90, 184],
  "cage-back": [-40, -112, 80, 112],
  "cage-front": [-40, -112, 80, 112],
  "bell-tower": [-50, -186, 100, 190],
  bell: [-18, -8, 36, 40],
} as const;
type StructureName = keyof typeof STRUCTURE_BOX;

function structurePath(name: StructureName, variant?: "broken" | "trim"): string {
  return `structures/${variant ? `${name}-${variant}` : name}.svg`;
}

/* ------------------------------------------------------------------ notes */

interface NoteRig { spr: Sprite; big: boolean }

/** Bakes a pinned page: a scribble from the road, real words under the glass. */
function noteTexture(note: PinnedNote | undefined, big: boolean): Texture {
  const asc = getArtScale();
  const { w, h } = big ? NOTE_NEAR : NOTE_FAR;
  const key = big && note ? `note|${note.id}|${note.text}|${asc}` : `note|far|${asc}`;
  return bakedTexture(key, Math.ceil(w * asc), Math.ceil(h * asc), asc, (g, pw, ph) => {
    const s = asc;
    g.fillStyle = "rgba(0,0,0,0.4)";
    g.fillRect((big ? 2.5 : 1) * s, (big ? 5 : 2) * s, pw, ph);
    g.fillStyle = big ? "#f4ead2" : "#e9dfc4";
    g.strokeStyle = "#8a6f4d";
    g.lineWidth = (big ? 1.6 : 1) * s;
    g.beginPath();
    g.rect(0, 0, w * s, h * s);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(w * s, 0);
    g.lineTo(w * s, h * 0.2 * s);
    g.lineTo(w * 0.8 * s, 0);
    g.closePath();
    g.fillStyle = "#d8c9a8";
    g.fill();
    g.stroke();
    if (big && note?.text) {
      g.font = `italic ${6.5 * s}px Georgia, serif`;
      g.fillStyle = "#43301f";
      g.textAlign = "left";
      const lines = wrapText(note.text, w - 14, "italic 6.5px Georgia, serif", 10);
      lines.forEach((line, i) => g.fillText(line, 7 * s, (15 + i * 8) * s));
      g.font = `italic ${5.5 * s}px Georgia, serif`;
      g.fillStyle = "#6e5638";
      g.textAlign = "right";
      g.fillText(`— ${note.author}`, (w - 7) * s, (h - 6) * s, (w - 14) * s);
    } else {
      const lines = big ? 8 : 3;
      g.strokeStyle = "#7a6a52";
      g.lineWidth = (big ? 1.4 : 1) * s;
      g.beginPath();
      for (let i = 1; i <= lines; i++) {
        const ly = (h / (lines + 1)) * i * s;
        g.moveTo(w * 0.16 * s, ly);
        g.lineTo(w * (0.84 - (i % 3) * 0.08) * s, ly);
      }
      g.stroke();
    }
  });
}

function updateNote(rig: NoteRig, v: View, note: PinnedNote, worldX: number): void {
  const big = v.focused && v.focusX === note.x;
  rig.big = big;
  rig.spr.texture = noteTexture(big ? note : undefined, big);
  rig.spr.position.set(worldX, note.kind === "wall" ? -118 : -74);
  rig.spr.rotation = (note.kind === "tree" ? 0.1 : -0.05)
    + Math.sin(v.t * 1.7 + worldX * 0.05) * (big ? 1.2 : 1.1) * 0.012;
}

/* ----------------------------------------------------------------- houses */

const cutaways = new Map<string, HTMLCanvasElement>();

/** Facade with the windows and doorway cut out, baked once per house and size. */
function cutawayCanvas(b: Building, boxW: number, overhang: number, scaleX: number): HTMLCanvasElement | null {
  const facade = spriteFor(`house/facade-${b.id}.svg`, boxW, ROOF_HEIGHT);
  if (!facade) return null;
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
  if (cutaways.size > 24) cutaways.clear();
  cutaways.set(key, canvas);
  return canvas;
}

interface FurnitureRig { item: ReturnType<typeof roomItems>[number]; spr: Sprite }
interface HouseRig {
  b: Building;
  rootIn: Container;
  rootOut: Container;
  furniture: FurnitureRig[] | null;
  workLight: Sprite;
  workMark: Sprite;
  facade: Sprite;
  windows: Sprite;
  spills: Sprite[];
  doorSpill: Sprite;
  doorFrame: Sprite;
  doorClosed: Sprite;
  doorOpenSpr: Sprite;
  notes: Map<string, NoteRig>;
}

/* --------------------------------------------------------------- stations */

interface StationRig {
  st: Station;
  root: Container;
  structure: Sprite;
  trim: Sprite | null;
  variant: string;
  wins: Sprite[];
  winLights: Sprite[];
  flame: Sprite | null;
  flameLight: Sprite | null;
  halo: Sprite | null;
  sails: Sprite | null;
  radioCore: Sprite | null;
  radioLight: Sprite | null;
  kit: Sprite;
  marker: Container;
  markerDiamond: Sprite;
  markerLabel: Sprite;
  markerKey: string;
  barBack: Sprite;
  barFront: Sprite;
}

/* ----------------------------------------------------------------- statics */

export class Statics {
  private skyKey = "";
  private hillsKey = "";
  private houses = new Map<string, HouseRig>();
  private stations = new Map<string, StationRig>();
  private streetNotes = new Map<string, NoteRig>();
  private doorOpen = new Map<string, number>();
  private cullItems: { spr: Container; x: number; half: number }[] = [];
  private trees: { spr: Sprite; wx: number }[] = [];
  private rutTiles: Sprite[] = [];
  private moonHalo!: Sprite;
  private moonCore!: Sprite;
  private moon!: Sprite;
  private rays: Sprite[] = [];
  private clouds: Sprite[] = [];
  private bellGroup!: Container;
  private bellSwing!: Container;
  private bellArcs!: Sprite;
  private rope!: Sprite;
  private cartSpr!: Sprite;
  private cartLabel!: Sprite;
  private pushLabel!: Sprite;
  private keyLight!: Sprite;
  private keySpr!: Sprite;
  private kitsPool: Sprite[] = [];
  private timepiecesPool: { light: Sprite; spr: Sprite }[] = [];
  private doorKeyRigs = new Map<string, { light: Sprite; spr: Sprite }>();
  private glints: Sprite[] = [];
  private meetingSpr!: Sprite;
  private cageRigs: { back: Sprite; front: Sprite }[] = [];
  private gatedDressing!: Container;
  private skyTex: Texture | null = null;
  private hillTexFar: Texture | null = null;
  private hillTexNear: Texture | null = null;

  constructor(private layers: StaticLayers) {
    this.buildFar();
    this.buildDressing();
    this.buildBellAndCages();
    this.buildCartAndKeys();
    for (const b of BUILDINGS) this.buildHouse(b);
    for (const st of STATIONS) if (!st.inside) this.buildStation(st);
  }

  /* ---------------------------------------------------------- construction */

  private buildFar(): void {
    const far = this.layers.far;
    this.moonHalo = lightSpr(far, "244,222,181", 0, 0, 145, 145, 0.2);
    this.moonCore = lightSpr(far, "240,225,190", 0, 0, 70, 70, 0.5);
    for (let i = 0; i < 3; i++) {
      const ray = spr(far, bakedTexture("ray", 256, 64, 1, (g) => {
        const grad = g.createLinearGradient(0, 0, 256, 0);
        grad.addColorStop(0, "rgba(232,214,178,1)");
        grad.addColorStop(1, "rgba(232,214,178,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(0, 30);
        g.lineTo(256, 0);
        g.lineTo(256, 64);
        g.lineTo(0, 34);
        g.closePath();
        g.fill();
      }));
      ray.anchor.set(0, 0.5);
      this.rays.push(ray);
    }
    this.moon = spr(far);
    const blob = bakedTexture("cloud", 256, 64, 1, (g) => {
      g.fillStyle = "rgba(27,19,36,0.55)";
      g.beginPath();
      g.ellipse(100, 34, 96, 12, -0.05, 0, Math.PI * 2);
      g.ellipse(168, 38, 68, 9, 0.04, 0, Math.PI * 2);
      g.fill();
    });
    for (let i = 0; i < 4; i++) {
      const c = spr(far, blob);
      c.anchor.set(0.5, 0.5);
      c.width = 300;
      c.height = 34;
      c.alpha = 0.4;
      this.clouds.push(c);
    }
  }

  private buildDressing(): void {
    const d = this.layers.dressing;
    // Ruts: a two-period tile, pooled across the visible stretch.
    const rutTex = bakedTexture(`rut|${getArtScale()}`, Math.ceil(740 * getArtScale()), Math.ceil(44 * getArtScale()), getArtScale(), (g, pw) => {
      const s = pw / 740;
      g.strokeStyle = "rgba(218,164,100,0.13)";
      g.lineWidth = 2 * s;
      for (const off of [5, 20]) {
        g.beginPath();
        for (let x = 0; x <= 740; x += 15) {
          const y = (off + Math.sin(x * 0.017) * 2) * s;
          if (x === 0) g.moveTo(0, y);
          else g.lineTo(x * s, y);
        }
        g.stroke();
      }
    });
    for (let i = 0; i < 10; i++) {
      const tile = spr(d, rutTex);
      tile.position.set(0, 14);
      tile.width = 740;
      tile.height = 44;
      this.rutTiles.push(tile);
    }
    const addCull = (path: string, x: number, y: number, w: number, h: number, half: number) => {
      const s = spr(d);
      s.position.set(x, y);
      s.width = w;
      s.height = h;
      setArt(s, path, w, h);
      this.cullItems.push({ spr: s, x: x + w / 2, half });
      return s;
    };
    for (let i = TREE_MIN; i <= TREE_MAX; i++) {
      const sx = treeX(i);
      addCull("scenery/stump.svg", sx - 30, 2, 60, 12, 90);
      addCull("scenery/leaf-pile.svg", sx - 24, 1, 44, 8, 80);
    }
    for (const fx of FENCE_XS) addCull("props/fence.svg", fx, -46, 140, 46, 160);
    for (const b of BUILDINGS) addCull("props/lantern-post.svg", doorX(b) + b.side * 46 - 15, -96, 30, 96, 60);
    for (const px of [-3378, 7252]) addCull("props/lantern-post.svg", px - 15, -96, 30, 96, 60);
    for (const wx of [-3000, -560, 5300, 7860]) addCull("props/woodpile.svg", wx - 32, -44, 64, 44, 90);
    for (const mx of [-3320, 4350, 6620, 8330]) addCull("props/windmill.svg", mx - 65, -160, 130, 160, 170);
    for (const gx of [3110, 3265, 3345, 7222, 7382]) addCull("props/gravestone.svg", gx - 17, -46, 34, 46, 70);
    for (const hx of [195, 352]) addCull("props/haystack.svg", hx - 35, -52, 70, 52, 100);
    // Quality-gated dressing (hidden on low).
    const gated = new Container();
    d.addChild(gated);
    this.gatedDressing = gated;
    for (let i = 0; i < 34; i++) {
      const s = spr(gated);
      s.position.set(WORLD_MIN + i * 320 - 6, 48 + (i % 3) * 3 - 34);
      s.width = 86;
      s.height = 38;
      setArt(s, "props/broken-fence.svg", 86, 38);
      this.cullItems.push({ spr: s, x: WORLD_MIN + i * 320, half: 100 });
    }
    for (let i = 0; i < 42; i++) {
      const rx = 4 + (i % 5);
      const s = spr(gated);
      s.position.set(WORLD_MIN + i * 260 + 60 - rx, 25);
      s.width = rx * 2;
      s.height = 4;
      setArt(s, "scenery/pebble.svg", rx * 2, 4);
    }
    // Creek: bridge, dark pool, and seven glints.
    const bridge = spr(d);
    bridge.position.set(-2660, -6);
    bridge.width = 260;
    bridge.height = 64;
    setArt(bridge, "props/creek-bridge.svg", 260, 64);
    const pool = spr(d, ellipseTexture());
    pool.anchor.set(0.5, 0.5);
    pool.position.set(-2660 + 130, 34);
    pool.width = 300;
    pool.height = 32;
    pool.tint = 0x0a1014;
    pool.alpha = 0.5;
    const glintTex = bakedTexture("glint", 32, 4, 1, (g) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 1, 32, 2);
    });
    for (let i = 0; i < 7; i++) {
      const gl = spr(d, glintTex);
      gl.anchor.set(0, 0.5);
      gl.width = 15;
      gl.height = 3;
      gl.tint = 0x9cdad3;
      this.glints.push(gl);
    }
    // Meeting-square highlight.
    this.meetingSpr = spr(d);
    this.meetingSpr.position.set(MEETING_FROM, -200);
    this.meetingSpr.width = MEETING_TO - MEETING_FROM;
    this.meetingSpr.height = 240;
    setArt(this.meetingSpr, "scenery/meeting-square.svg", MEETING_TO - MEETING_FROM, 240);
    this.meetingSpr.visible = false;
    // Treeline (parallax layer): one sprite per horizon tree.
    for (let i = 0; i < 92; i++) {
      const wx = WORLD_MIN + i * 155 + ((i * 97) % 60);
      const th = 74 + ((i * 53) % 56);
      this.addTree(wx, th, i);
      if (wx < -2650 || wx > 7350) this.addTree(wx + 62, th * 0.82, i + 7);
    }
  }

  private addTree(wx: number, th: number, seed: number): void {
    const s = spr(this.layers.trees);
    s.anchor.set(0.5, 1);
    s.position.set(wx, 0);
    s.width = th * 0.75;
    s.height = th;
    if (seed % 2 === 1) s.scale.x = -Math.abs(s.scale.x);
    setArt(s, "scenery/autumn-tree.svg", th * 0.75, th);
    this.trees.push({ spr: s, wx });
  }

  private buildBellAndCages(): void {
    const bell = this.layers.bell;
    this.bellGroup = new Container();
    this.bellGroup.position.set(BELL_X, 0);
    bell.addChild(this.bellGroup);
    const tower = spr(this.bellGroup);
    const [tx, ty, tw, th] = STRUCTURE_BOX["bell-tower"];
    tower.position.set(tx, ty);
    tower.width = tw;
    tower.height = th;
    setArt(tower, structurePath("bell-tower"), tw, th);
    this.bellSwing = new Container();
    // The bell swings from the belfry: the pivot is the belfry floor, not the tower base.
    this.bellSwing.position.set(0, -143);
    this.bellGroup.addChild(this.bellSwing);
    // The bell SVG's viewBox (-18 -8 36 40) already carries its offset, so the sprite is
    // placed at the origin and sized only — adding the box again would shift it.
    const [, , bw, bh] = STRUCTURE_BOX["bell"];
    const bellSpr = spr(this.bellSwing);
    bellSpr.position.set(0, 0);
    bellSpr.width = bw;
    bellSpr.height = bh;
    setArt(bellSpr, structurePath("bell"), bw, bh);
    this.bellArcs = spr(this.bellSwing, bakedTexture("arcs", 96, 96, 1, (g) => {
      g.strokeStyle = "rgba(255,215,130,0.5)";
      g.lineWidth = 2;
      for (const r of [26, 38]) {
        g.beginPath(); g.arc(48, 60, r, -0.6, 0.6); g.stroke();
        g.beginPath(); g.arc(48, 60, r, Math.PI - 0.6, Math.PI + 0.6); g.stroke();
      }
    }));
    this.bellArcs.anchor.set(0.5, 0.5);
    this.bellArcs.position.set(0, 26);
    this.rope = spr(this.bellGroup, whiteTexture());
    this.rope.anchor.set(0.5, 0);
    this.rope.position.set(6, -120);
    this.rope.width = 2;
    this.rope.height = 90;
    this.rope.tint = 0x5a4a30;
    // Prison cages: a back frame behind the figure, bars in front of it.
    for (let i = 0; i < CAGE_XS.length; i++) {
      const back = spr(this.layers.cageBacks);
      const [cx, cy, cw, ch] = STRUCTURE_BOX["cage-back"];
      back.position.set(CAGE_XS[i] + cx, cy);
      back.width = cw;
      back.height = ch;
      setArt(back, structurePath("cage-back"), cw, ch);
      const front = spr(this.layers.cageFronts);
      const [fx2, fy2, fw, fh] = STRUCTURE_BOX["cage-front"];
      front.position.set(CAGE_XS[i] + fx2, fy2);
      front.width = fw;
      front.height = fh;
      setArt(front, structurePath("cage-front"), fw, fh);
      this.cageRigs.push({ back, front });
    }
  }

  private buildCartAndKeys(): void {
    const cart = new Container();
    this.layers.cart.addChild(cart);
    this.cartSpr = spr(cart);
    this.cartSpr.position.set(-50, -82);
    this.cartSpr.width = 100;
    this.cartSpr.height = 82;
    setArt(this.cartSpr, "props/supply-cart.svg", 100, 82);
    const label = labelTexture("supplies", "SUPPLIES", "bold 11px Georgia, serif", "#e4cba8", { h: 14, padX: 2 });
    this.cartLabel = spr(cart, label.tex);
    this.cartLabel.anchor.set(0.5, 1);
    this.cartLabel.position.set(0, -68);
    this.pushLabel = spr(cart, label.tex);
    this.pushLabel.anchor.set(0.5, 1);
    this.pushLabel.position.set(0, -82);
    this.keyLight = lightSpr(this.layers.keys, "255,215,106", 0, 0, 18, 18, 0.45);
    this.keySpr = spr(this.layers.keys);
    this.keySpr.width = 18;
    this.keySpr.height = 32;
    setArt(this.keySpr, "props/key.svg", 18, 32);
  }

  private buildHouse(b: Building): void {
    const rootIn = new Container();
    rootIn.position.set(b.x, 0);
    this.layers.interiors.addChild(rootIn);
    const shadow = spr(rootIn, ellipseTexture());
    shadow.anchor.set(0.5, 0.5);
    shadow.position.set(0, 2);
    shadow.width = b.width * 1.04;
    shadow.height = 14;
    shadow.tint = 0x040306;
    shadow.alpha = 0.38;
    const interior = spr(rootIn);
    interior.position.set(-b.width / 2, -WALL_HEIGHT);
    interior.width = b.width;
    interior.height = WALL_HEIGHT;
    setArt(interior, "house/interior.svg", b.width, WALL_HEIGHT);
    const workLight = lightSpr(rootIn, "217,154,61", 0, -90, 14, 14, 0.5);
    const workMark = spr(rootIn, labelTexture("workmark", "◇", "bold 13px system-ui, sans-serif", "#ffffff", { h: 16, padX: 2 }).tex);
    workMark.anchor.set(0.5, 0.5);
    workMark.position.set(0, -90);

    const rootOut = new Container();
    rootOut.position.set(b.x, 0);
    this.layers.exteriors.addChild(rootOut);
    const barrel = spr(rootOut);
    barrel.position.set(-b.width / 2 - 30, -34);
    barrel.width = 26;
    barrel.height = 34;
    setArt(barrel, "furniture/barrel.svg", 26, 34);
    const crate = spr(rootOut);
    crate.position.set(b.width / 2 + 8, -26);
    crate.width = 30;
    crate.height = 26;
    setArt(crate, "furniture/crate.svg", 30, 26);
    const spills: Sprite[] = [];
    const scaleX = b.width / 300;
    for (const wxs of [61, 197]) {
      const spill = lightSpr(rootOut, "255,178,92", (wxs + 13.5) * scaleX - b.width / 2, 6, 46 * scaleX + 18, 12, 0.2);
      spills.push(spill);
    }
    const facade = spr(rootOut);
    const windows = spr(rootOut);
    windows.position.set(-b.width / 2, -ROOF_HEIGHT);
    windows.width = b.width;
    windows.height = ROOF_HEIGHT;
    setArt(windows, "house/windows.svg", b.width, ROOF_HEIGHT);
    const doorSpill = spr(rootOut, ellipseTexture());
    doorSpill.anchor.set(0.5, 0.5);
    doorSpill.width = 56;
    doorSpill.height = 10;
    doorSpill.tint = 0xe6aa69;
    const doorGroup = new Container();
    doorGroup.position.set(doorX(b) - b.x, -WALL_HEIGHT);
    doorGroup.scale.x = b.side;
    rootOut.addChild(doorGroup);
    const mkDoor = () => {
      const s = spr(doorGroup);
      s.position.set(-20, 0);
      s.width = 64;
      s.height = WALL_HEIGHT;
      return s;
    };
    const doorFrame = mkDoor();
    setArt(doorFrame, "house/door-frame.svg", 64, WALL_HEIGHT);
    const doorClosed = mkDoor();
    setArt(doorClosed, "house/door-closed.svg", 64, WALL_HEIGHT);
    const doorOpenSpr = mkDoor();
    setArt(doorOpenSpr, "house/door-open.svg", 64, WALL_HEIGHT);
    const sign = spr(rootOut);
    sign.position.set(-56, -145);
    sign.width = 112;
    sign.height = 18;
    setArt(sign, "house/sign.svg", 112, 18);
    const name = labelTexture(`house|${b.id}`, b.name.toUpperCase(), "600 10px system-ui, sans-serif", "#f1d7b7", { h: 14, padX: 2 });
    const nameSpr = spr(rootOut, name.tex);
    nameSpr.anchor.set(0.5, 0.5);
    nameSpr.position.set(0, -136);
    nameSpr.width = Math.min(name.w, 103);

    this.houses.set(b.id, {
      b, rootIn, rootOut, furniture: null, workLight, workMark, facade, windows, spills,
      doorSpill, doorFrame, doorClosed, doorOpenSpr, notes: new Map(),
    });
  }

  private buildStation(st: Station): void {
    const root = new Container();
    root.position.set(st.x, 0);
    this.layers.stations.addChild(root);
    const structure = spr(root);
    const [sx, sy, sw, sh] = STRUCTURE_BOX[st.kind === "pumpkins" ? "pumpkin-shed" : st.kind as StructureName] ?? [0, 0, 0, 0];
    structure.position.set(sx, sy);
    structure.width = sw;
    structure.height = sh;
    let trim: Sprite | null = null;
    if (st.kind === "pumpkins" || st.kind === "mill" || st.kind === "chapel") {
      trim = spr(root);
      trim.position.set(sx, sy);
      trim.width = sw;
      trim.height = sh;
    }
    const wins: Sprite[] = [];
    const winLights: Sprite[] = [];
    const addWin = (x: number, y: number, w: number, h: number) => {
      const glowSpr = spr(root, windowGlowTexture());
      glowSpr.position.set(x, y);
      glowSpr.width = w;
      glowSpr.height = h;
      wins.push(glowSpr);
      const li = lightSpr(root, "255,151,55", x + w / 2, y + h / 2, w * 0.9 + 6, h * 0.6 + 6, 0.3);
      winLights.push(li);
    };
    let flame: Sprite | null = null;
    let flameLight: Sprite | null = null;
    let halo: Sprite | null = null;
    let sails: Sprite | null = null;
    let radioCore: Sprite | null = null;
    let radioLight: Sprite | null = null;
    if (st.kind === "pumpkins") addWin(-20, -50, 18, 20);
    if (st.kind === "mill") { addWin(-50, -60, 20, 22); addWin(28, -60, 20, 22); }
    if (st.kind === "chapel") {
      const M = MEETING_HOUSE;
      const winTop = -M.wallHeight + (M.wallHeight - M.windowHeight) * 0.45;
      addWin(-M.width / 2 + M.width * 0.14, winTop, M.windowWidth, M.windowHeight);
      addWin(M.width / 2 - M.width * 0.14 - M.windowWidth, winTop, M.windowWidth, M.windowHeight);
      addWin(-M.doorWidth / 2, -M.doorHeight - 16, M.doorWidth, 12);
    }
    if (st.kind === "lantern") {
      halo = lightSpr(root, "255,187,83", 0, -78, 112, 110, 0.2);
      flameLight = lightSpr(root, "255,180,80", 0, -97, 18, 18, 0.7);
      flame = spr(root, whiteTexture());
      flame.position.set(-8, -106);
      flame.width = 16;
      flame.height = 18;
      flame.tint = 0xffbe5a;
    }
    if (st.kind === "mill") {
      sails = spr(root);
      const [ax, ay, aw, ah] = STRUCTURE_BOX["mill-sails"];
      sails.anchor.set(0.5, 0.5);
      sails.position.set(0, -50);
      sails.width = aw;
      sails.height = ah;
      void ax; void ay;
    }
    if (st.kind === "radio") {
      radioLight = lightSpr(root, "255,60,50", 0, -194, 12, 12, 0.6);
      radioCore = spr(root, circleTexture());
      radioCore.anchor.set(0.5, 0.5);
      radioCore.position.set(0, -194);
      radioCore.width = 8;
      radioCore.height = 8;
      radioCore.tint = 0xff3c32;
    }
    const kit = spr(root);
    kit.position.set(85 - 19, -28);
    kit.width = 38;
    kit.height = 28;
    setArt(kit, "props/supply-kit.svg", 38, 28);
    // Marker: light, diamond, label plate, progress bar.
    const marker = new Container();
    root.addChild(marker);
    const markerLight = lightSpr(marker, "255,205,90", 0, 0, 14, 14, 0.55);
    markerLight.position.set(0, -235);
    const markerDiamond = spr(marker, diamondTexture());
    markerDiamond.anchor.set(0.5, 0.5);
    markerDiamond.position.set(0, -235);
    markerDiamond.width = 15;
    markerDiamond.height = 15;
    const markerLabel = spr(marker);
    markerLabel.anchor.set(0.5, 0);
    markerLabel.position.set(0, -259);
    const barBack = spr(marker, whiteTexture());
    barBack.position.set(-30, -215);
    barBack.width = 60;
    barBack.height = 8;
    barBack.tint = 0x000000;
    barBack.alpha = 0.5;
    const barFront = spr(marker, whiteTexture());
    barFront.position.set(-29, -214);
    barFront.width = 58;
    barFront.height = 6;
    barFront.tint = 0xffcd5a;

    this.stations.set(st.id, {
      st, root, structure, trim, variant: "", wins, winLights, flame, flameLight, halo,
      sails, radioCore, radioLight, kit, marker, markerDiamond, markerLabel, markerKey: "", barBack, barFront,
    });
  }

  /* -------------------------------------------------------------- per-frame */

  update(v: View): void {
    this.updateSky(v);
    this.updateHills(v);
    this.updateFar(v);
    this.updateDressing(v);
    this.updateHouses(v);
    this.updateStations(v);
    this.updateBellCartKeys(v);
    this.updateNotes(v);
  }

  private updateSky(v: View): void {
    const skyBottomCss = v.cssH * 0.78 + v.lift * v.zoom;
    const key = `sky|${v.cssW}x${v.cssH}|${v.res}|${v.nb}|${Math.round(skyBottomCss)}|${v.zoom.toFixed(2)}`;
    if (key !== this.skyKey) {
      this.skyKey = key;
      const res = v.res;
      const pw = Math.max(2, Math.round(v.cssW * res));
      const ph = Math.max(2, Math.round(v.cssH * res));
      const skyBottom = Math.round(skyBottomCss * res);
      const zoom = v.zoom;
      const nb = v.nb;
      const starCount = v.quality === "high" ? 95 : v.quality === "medium" ? 48 : 18;
      const tex = bakeTextureUncached(pw, ph, res, (g) => {
        const sky = g.createLinearGradient(0, 0, 0, skyBottom);
        sky.addColorStop(0, lerpHex(SKY_DUSK[0], SKY_NIGHT[0], nb));
        sky.addColorStop(0.38, lerpHex(SKY_DUSK[1], SKY_NIGHT[1], nb));
        sky.addColorStop(0.72, lerpHex(SKY_DUSK[2], SKY_NIGHT[2], nb));
        sky.addColorStop(0.9, lerpHex(SKY_DUSK[3], SKY_NIGHT[3], nb));
        sky.addColorStop(1, lerpHex(SKY_DUSK[4], SKY_NIGHT[4], nb));
        g.fillStyle = sky;
        g.fillRect(0, 0, pw, skyBottom);
        const road = g.createLinearGradient(0, skyBottom, 0, ph);
        road.addColorStop(0, lerpHex(GROUND_DUSK[0], GROUND_NIGHT[0], nb));
        road.addColorStop(0.12, lerpHex(GROUND_DUSK[1], GROUND_NIGHT[1], nb));
        road.addColorStop(1, lerpHex(GROUND_DUSK[2], GROUND_NIGHT[2], nb));
        g.fillStyle = road;
        g.fillRect(0, skyBottom, pw, ph - skyBottom);
        // Stars, batched by brightness and colour as in the canvas renderer.
        const groundWorld = v.h * 0.78;
        for (let k = 0; k < 10; k++) {
          const warm = k >= 5;
          const level = k % 5;
          g.globalAlpha = (0.25 + level * 0.1) * (0.3 + 0.7 * nb);
          g.fillStyle = warm ? "#ffd9a0" : "#d9d8ed";
          g.beginPath();
          for (let i = 0; i < starCount; i++) {
            if (i % 5 !== level || (i % 9 === 0) !== warm) continue;
            const sx = (((i * 197.3 + 41) % (v.w + 160)) - 80) * zoom * res;
            const sy = (18 + ((i * 83.7) % Math.max(60, groundWorld * 0.52)) + v.lift) * zoom * res;
            const r = (0.45 + (i % 7 === 0 ? 0.85 : 0.25)) * zoom * res;
            g.moveTo(sx + r, sy);
            g.arc(sx, sy, Math.max(0.4, r), 0, Math.PI * 2);
          }
          g.fill();
        }
        g.globalAlpha = 1;
      });
      if (this.skyTex) releaseTexture(this.skyTex);
      this.skyTex = tex;
      this.layers.sky.texture = tex;
    }
    this.layers.sky.width = v.cssW;
    this.layers.sky.height = v.cssH;
  }

  private updateHills(v: View): void {
    const bucket = Math.round(v.w / 64) * 64;
    const key = `hills|${bucket}|${getArtScale()}`;
    if (key !== this.hillsKey) {
      this.hillsKey = key;
      const asc = getArtScale();
      const stripW = bucket + 2000;
      const bakeStrip = (stripH: number, rise: (wx: number) => number, color: string) => {
        return bakeTextureUncached(Math.ceil(stripW * asc), Math.ceil(stripH * asc), asc, (g, pw, ph) => {
          g.fillStyle = color;
          g.beginPath();
          g.moveTo(0, ph);
          for (let x = 0; x <= stripW; x += 20) {
            g.lineTo(x * asc, ph - rise(x - 500) * asc);
          }
          g.lineTo(pw, ph);
          g.closePath();
          g.fill();
        });
      };
      const farTex = bakeStrip(212,
        (wx) => 135 + Math.sin(wx * 0.0021 + 1) * 48 + Math.sin(wx * 0.006) * 22, "#2a1828");
      const nearTex = bakeStrip(176,
        (wx) => 82 + Math.sin(wx * 0.004) * 38 + Math.sin(wx * 0.0013 + 3) * 48, "#1b121d");
      if (this.hillTexFar) releaseTexture(this.hillTexFar);
      if (this.hillTexNear) releaseTexture(this.hillTexNear);
      this.hillTexFar = farTex;
      this.hillTexNear = nearTex;
      this.setStrip(this.layers.hillsFar, farTex, stripW, 212);
      this.setStrip(this.layers.hillsNear, nearTex, stripW, 176);
    }
  }

  private setStrip(layer: Container, tex: Texture, stripW: number, stripH: number): void {
    let s = layer.children[0] as Sprite | undefined;
    if (!s) {
      s = spr(layer);
      s.position.set(-500, -stripH);
    }
    s.texture = tex;
    s.width = stripW;
    s.height = stripH;
  }

  private updateFar(v: View): void {
    const mx = v.w * 0.78 - v.cam * 0.03;
    const my = v.h * 0.18;
    this.moonHalo.position.set(mx, my);
    this.moonHalo.alpha = v.glow ? 0.18 + 0.12 * v.night : 0;
    this.moonCore.position.set(mx, my);
    this.moonCore.alpha = v.glow ? 0.5 : 0;
    this.moon.position.set(mx - 42, my - 42);
    this.moon.width = 84;
    this.moon.height = 84;
    setArt(this.moon, "scenery/moon.svg", 84, 84);
    for (let i = 0; i < 3; i++) {
      const ray = this.rays[i];
      const ang = 1.85 + i * 0.24 + Math.sin(v.t * 0.05 + i * 2.1) * 0.03;
      ray.position.set(mx, my);
      ray.rotation = ang;
      ray.width = 330 + i * 60;
      ray.height = (26 + i * 10) * 2;
      ray.alpha = v.glow && v.quality !== "low" ? (0.028 + 0.03 * v.night) * 6 : 0;
    }
    for (let i = 0; i < 4; i++) {
      const c = this.clouds[i];
      c.position.set(((i * 410 + v.t * (3 + i)) % (v.w + 500)) - 250, 80 + i * 58);
      c.visible = v.quality !== "low";
    }
    // Treeline culling in parallax space.
    const left = v.cam * 0.45 - 200;
    const right = v.cam * 0.45 + v.w + 200;
    for (const t of this.trees) t.spr.visible = t.wx > left && t.wx < right;
  }

  private updateDressing(v: View): void {
    const left = v.cam - 220;
    const right = v.cam + v.w + 220;
    for (const item of this.cullItems) item.spr.visible = item.x + item.half > left && item.x - item.half < right;
    const gated = this.layers.dressing.getChildByName("gated");
    if (gated) gated.visible = v.quality !== "low";
    // Rut tiles across the visible stretch.
    const start = Math.floor(v.cam / 740) - 1;
    for (let i = 0; i < this.rutTiles.length; i++) {
      const tile = this.rutTiles[i];
      tile.position.x = (start + i) * 740;
      tile.visible = tile.position.x < right && tile.position.x + 740 > left;
    }
    // Creek glints.
    for (let i = 0; i < 7; i++) {
      const gl = this.glints[i];
      gl.position.set(-2660 + 22 + i * 34 + Math.sin(v.t * 1.1 + i * 1.9) * 9, 26 + (i % 3) * 7);
      gl.alpha = 0.05 + 0.07 * Math.max(0, Math.sin(v.t * 1.6 + i * 2.3));
    }
    this.meetingSpr.visible = v.snap.phase === "meeting";
    if (this.meetingSpr.visible) this.meetingSpr.alpha = 0.08 + Math.sin(v.t * 3) * 0.03;
  }

  private updateHouses(v: View): void {
    for (const rig of this.houses.values()) {
      const { b } = rig;
      const vis = b.x > v.cam - b.width - 120 && b.x < v.cam + v.w + b.width + 120;
      rig.rootIn.visible = vis;
      rig.rootOut.visible = vis;
      if (!vis) continue;
      const occupied = v.occupied.has(b.id);
      const task = v.houseTask.get(b.id);
      // Furniture appears once the room layout has been read.
      if (!rig.furniture) {
        const items = roomItems(b.id);
        if (items.length) {
          rig.furniture = items.map((item) => {
            const s = spr(rig.rootIn);
            s.position.set(item.x, item.y);
            s.width = item.width;
            s.height = item.height;
            setArt(s, item.asset, item.width, item.height);
            return { item, spr: s };
          });
        }
      }
      if (rig.furniture) {
        for (const f of rig.furniture) {
          f.spr.visible = !(f.item.when === "done" && !task?.done) && !(f.item.when === "unfinished" && task?.done);
        }
      }
      const showWork = occupied && !!task && !task.done;
      rig.workLight.visible = showWork && v.glow;
      rig.workMark.visible = showWork;
      if (showWork && task) {
        rig.workLight.position.set(task.x - b.x, -90);
        rig.workMark.position.set(task.x - b.x, -90);
        rig.workMark.tint = task.delivered ? 0xf0c276 : 0xdc8a64;
      }
      // Notes pinned on this house's walls.
      const notes = v.notesByHouse.get(b.id) ?? [];
      const seen = new Set<string>();
      for (const note of notes) {
        seen.add(note.id);
        let rigNote = rig.notes.get(note.id);
        if (!rigNote) {
          const s = spr(rig.rootIn);
          s.anchor.set(0.5, 1);
          rigNote = { spr: s, big: false };
          rig.notes.set(note.id, rigNote);
        }
        rigNote.spr.visible = true;
        updateNote(rigNote, v, note, note.x - b.x);
      }
      for (const [id, rigNote] of rig.notes) if (!seen.has(id)) rigNote.spr.visible = false;

      // Exterior state.
      const door = v.doors.get(b.id);
      const target = door?.open ? 1 : 0;
      const previous = this.doorOpen.get(b.id) ?? target;
      const amount = v.reduced ? target : previous + (target - previous) * Math.min(1, v.dt * 10);
      this.doorOpen.set(b.id, amount);
      const scaleX = b.width / 300;
      const overhang = 16 * scaleX;
      const boxW = b.width + overhang * 2;
      const cut = cutawayCanvas(b, boxW, overhang, scaleX);
      if (cut) {
        const tex = textureOf(cut, cut.width / boxW);
        if (rig.facade.texture !== tex) rig.facade.texture = tex;
        rig.facade.renderable = true;
        rig.facade.position.set(-overhang - b.width / 2, -ROOF_HEIGHT);
        rig.facade.width = boxW;
        rig.facade.height = ROOF_HEIGHT;
      } else rig.facade.renderable = false;
      rig.facade.alpha = occupied ? 0.24 : 1;
      rig.windows.alpha = occupied ? 0.78 : 1;
      for (const spill of rig.spills) spill.visible = !occupied && v.glow;
      const dx = doorX(b) - b.x;
      rig.doorSpill.position.set(dx + b.side * 12, 1);
      rig.doorSpill.alpha = amount * 0.16;
      rig.doorSpill.visible = amount > 0.01;
      const doorAlpha = occupied ? 0.86 : 1;
      rig.doorFrame.alpha = doorAlpha;
      rig.doorClosed.alpha = doorAlpha * (1 - amount);
      rig.doorOpenSpr.alpha = doorAlpha * amount;
    }
  }

  private updateStations(v: View): void {
    const now = v.now;
    const blackout = now < v.snap.blackoutUntil;
    const night = v.snap.time?.mode === "past" ? 0.05 : clamp(v.snap.nightT ?? 0.2, 0, 1);
    for (const rig of this.stations.values()) {
      const { st } = rig;
      const vis = st.x > v.cam - 320 && st.x < v.cam + v.w + 320;
      rig.root.visible = vis;
      if (!vis) continue;
      const task = v.tasks.get(st.id);
      const broken = v.snap.phase === "lobby" || (!!task && !task.done);
      const supplied = !!task?.delivered;
      const flick = v.settings.graphics.flicker && !v.reduced && now - v.snap.flickerAt < 900 ? Math.random() * 0.6 : 0;
      const variant = broken ? "broken" : "ok";
      if (rig.variant !== variant) {
        rig.variant = variant;
        const name = (st.kind === "pumpkins" ? "pumpkin-shed" : st.kind) as StructureName;
        const [sx, sy, sw, sh] = STRUCTURE_BOX[name];
        void sx; void sy;
        setArt(rig.structure, structurePath(name, broken ? "broken" : undefined), sw, sh);
        if (rig.trim) setArt(rig.trim, structurePath(name, "trim"), sw, sh);
        if (rig.sails) {
          const [, , aw, ah] = STRUCTURE_BOX["mill-sails"];
          setArt(rig.sails, structurePath("mill-sails", broken ? "broken" : undefined), aw, ah);
        }
      }
      const lit = !blackout && !broken;
      const winAlpha = blackout || broken ? 0.02 : Math.max(0.05, (0.75 - flick) * (0.45 + 0.55 * night));
      for (const w of rig.wins) w.alpha = winAlpha;
      for (const wl of rig.winLights) wl.visible = lit && v.glow;
      if (rig.halo) rig.halo.visible = lit && v.glow;
      if (rig.halo) rig.halo.alpha = 0.1 + 0.18 * night;
      if (rig.flame) {
        rig.flame.alpha = blackout || broken ? 0.03 : Math.max(0.03, 0.3 + 0.45 * night + Math.sin(v.t * 5) * 0.1 - flick);
      }
      if (rig.flameLight) rig.flameLight.visible = lit && v.glow;
      if (rig.sails) rig.sails.rotation = broken ? 0 : v.t * 0.6;
      if (rig.radioCore) rig.radioCore.alpha = broken ? 0.03 : Math.sin(v.t * 3) > 0 ? 0.9 : 0.2;
      if (rig.radioLight) rig.radioLight.visible = !broken && v.glow;
      rig.kit.visible = !!task && !task.done && supplied;
      // Marker.
      const showMarker = !!task && !task.done && v.snap.phase === "playing";
      rig.marker.visible = showMarker;
      if (showMarker && task) {
        const M = MEETING_HOUSE;
        const baseY = st.kind === "chapel" ? -(M.wallHeight + M.roofRise + M.towerBase - 18) : -235;
        const bob = Math.sin(v.t * 3 + st.x) * 4;
        rig.markerDiamond.position.y = baseY + bob;
        rig.markerDiamond.tint = supplied ? 0xb3d59a : task.sabotaged ? 0xd87762 : 0xffcd5a;
        const key = `${supplied ? "p" : task.sabotaged ? "s" : "n"}|${getArtScale()}`;
        if (rig.markerKey !== key) {
          rig.markerKey = key;
          const label = labelTexture(`marker|${key}`, supplied ? "PUZZLE" : task.sabotaged ? "SABOTAGED" : "NEEDS KIT",
            "bold 10px system-ui, sans-serif", supplied ? "#b3d59a" : task.sabotaged ? "#d87762" : "#ffcd5a",
            { bg: "rgba(12,8,16,0.78)", h: 16, padX: 6 });
          rig.markerLabel.texture = label.tex;
        }
        rig.markerLabel.position.y = baseY - 24;
        rig.markerLabel.visible = !v.glassUp;
        rig.barBack.position.y = baseY + 20;
        rig.barFront.position.y = baseY + 21;
        const showBar = task.progress > 0;
        rig.barBack.visible = showBar;
        rig.barFront.visible = showBar;
        if (showBar) rig.barFront.width = 58 * task.progress;
        // marker light follows the diamond
        const lightChild = rig.marker.children[0] as Sprite;
        lightChild.position.y = baseY + bob;
        lightChild.visible = v.glow;
      }
    }
  }

  private updateBellCartKeys(v: View): void {
    // Bell.
    const ringing = v.now - v.snap.bellAt < 4000;
    const swing = ringing ? Math.sin(v.t * 9) * 0.5 : Math.sin(v.t * 0.8) * 0.04;
    this.bellSwing.rotation = swing;
    this.bellArcs.visible = ringing;
    this.rope.rotation = Math.atan2(ringing ? Math.sin(v.t * 9) * 6 : 0, 90);
    // Cart.
    const cart = this.layers.cart.children[0] as Container;
    cart.position.set(v.snap.cartX, 0);
    cart.visible = v.snap.cartX > v.cam - 120 && v.snap.cartX < v.cam + v.w + 120;
    this.pushLabel.visible = v.snap.cartPushers > 0;
    if (this.pushLabel.visible) {
      const label = labelTexture(`push|${v.snap.cartPushers}`, `${v.snap.cartPushers} PUSHING`,
        "bold 10px system-ui, sans-serif", "#e9dfcf", { h: 13, padX: 2 });
      if (this.pushLabel.texture !== label.tex) this.pushLabel.texture = label.tex;
    }
    // Loose kits on the road.
    const drops = v.snap.supplyDrops;
    while (this.kitsPool.length < drops.length) {
      const s = spr(this.layers.kits);
      s.width = 38;
      s.height = 28;
      setArt(s, "props/supply-kit.svg", 38, 28);
      this.kitsPool.push(s);
    }
    for (let i = 0; i < this.kitsPool.length; i++) {
      const s = this.kitsPool[i];
      if (i < drops.length) {
        s.visible = true;
        s.position.set(drops[i] - 19, -28);
      } else s.visible = false;
    }
    // The cage key.
    const showKey = v.snap.keyX !== null;
    this.keyLight.visible = showKey && v.glow;
    this.keySpr.visible = showKey;
    if (showKey) {
      const bob = Math.sin(v.t * 3) * 4;
      this.keyLight.position.set(v.snap.keyX!, -16 + bob);
      this.keySpr.position.set(v.snap.keyX! - 9, -32 + bob);
    }
    // Timepieces, pooled by index.
    const pieces: number[] = Array.isArray(v.snap.timepieces) && v.snap.timepieces.length ? v.snap.timepieces
      : typeof v.snap.timepieceX === "number" ? [v.snap.timepieceX] : [];
    while (this.timepiecesPool.length < pieces.length) {
      const light = lightSpr(this.layers.keys, "156,218,211", 0, 0, 22, 26, 0.5);
      const s = spr(this.layers.keys);
      s.width = 36;
      s.height = 48;
      setArt(s, "props/timepiece.svg", 36, 48);
      this.timepiecesPool.push({ light, spr: s });
    }
    for (let i = 0; i < this.timepiecesPool.length; i++) {
      const rig = this.timepiecesPool[i];
      if (i < pieces.length) {
        const bob = Math.sin(v.t * 2.4 + pieces[i]) * 3;
        rig.spr.visible = true;
        rig.spr.position.set(pieces[i] - 18, -48 + bob);
        rig.light.visible = v.glow;
        rig.light.position.set(pieces[i], -24 + bob);
      } else {
        rig.spr.visible = false;
        rig.light.visible = false;
      }
    }
    // Per-house door keys (created lazily, one rig per door).
    for (const d of v.snap.doors ?? []) {
      let rig = this.doorKeyRigs.get(d.id);
      if (!rig) {
        const light = lightSpr(this.layers.keys, "255,213,120", 0, 0, 14, 14, 0.45);
        const s = spr(this.layers.keys);
        s.width = 18;
        s.height = 32;
        setArt(s, "props/key.svg", 18, 32);
        rig = { light, spr: s };
        this.doorKeyRigs.set(d.id, rig);
      }
      const show = d.keyX !== null;
      rig.spr.visible = show;
      rig.light.visible = show && v.glow;
      if (show) {
        const bob = Math.sin(v.t * 3) * 3;
        rig.spr.position.set(d.keyX! - 9, -32 + bob);
        rig.light.position.set(d.keyX!, -16 + bob);
      }
    }
  }

  private updateNotes(v: View): void {
    const seen = new Set<string>();
    for (const note of v.snap.notes ?? []) {
      if (note.house) continue;
      seen.add(note.id);
      let rig = this.streetNotes.get(note.id);
      if (!rig) {
        const s = spr(this.layers.notes);
        s.anchor.set(0.5, 1);
        rig = { spr: s, big: false };
        this.streetNotes.set(note.id, rig);
      }
      rig.spr.visible = note.x > v.cam - 120 && note.x < v.cam + v.w + 120;
      if (rig.spr.visible) updateNote(rig, v, note, note.x);
    }
    for (const [id, rig] of this.streetNotes) if (!seen.has(id)) rig.spr.visible = false;
  }
}
