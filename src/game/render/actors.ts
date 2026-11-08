// People on the street: the living, the caged, the ghosts, and the dead on the
// road. One rig per player (body, shadow, kit, key, timepiece, name, action,
// speech) is created on first sight and then only moved, retextured or hidden.
import { Container, Sprite } from "pixi.js";
import { artTexture, bakedTexture, ellipseTexture, labelTexture, lightTexture, travelerTexture, wrapText } from "./textures";
import { measureTextWidth } from "./paint";
import { getArtScale } from "../svg-assets";
import type { Snapshot } from "../types";
import type { View } from "./view";

/** Where a figure was last drawn, so facing and gait follow what is shown, not the server's view. */
export interface Motion { x: number; facing: number; movingUntil: number }

type Body = Snapshot["bodies"][number];

export interface ActorGroups {
  bodiesIn: Container;
  playersIn: Container;
  bodiesOut: Container;
  playersCaged: Container;
  playersOut: Container;
}

interface PlayerRig {
  root: Container;
  shadow: Sprite;
  body: Sprite;
  kit: Sprite;
  keyIcon: Sprite;
  tpLight: Sprite;
  tp: Sprite;
  label: Sprite;
  labelKey: string;
  action: Sprite;
  actionKey: string;
  bubble: Sprite;
  bubbleKey: string;
}

interface BodyRig {
  root: Container;
  blood: Sprite;
  flash: Sprite;
  slashes: Sprite;
  figure: Sprite;
  crows: Sprite[];
}

function spr(parent: Container, tex?: import("pixi.js").Texture): Sprite {
  const s = new Sprite(tex);
  parent.addChild(s);
  return s;
}

const keyIconTex = () => bakedTexture(`keyicon|${getArtScale()}`, Math.ceil(24 * getArtScale()), Math.ceil(24 * getArtScale()), getArtScale(), (g, pw, ph) => {
  g.font = `${12 * getArtScale()}px serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("🗝", pw / 2, ph / 2);
  void pw; void ph;
});

const crowTex = () => bakedTexture("crow", 28, 16, 1, (g) => {
  g.strokeStyle = "#0a0608";
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(2, 6);
  g.quadraticCurveTo(14, 12, 26, 6);
  g.stroke();
});

const slashTex = () => bakedTexture("slashes", 96, 96, 1, (g) => {
  g.strokeStyle = "#f1b1a0";
  g.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(13 + i * 12, 5);
    g.quadraticCurveTo(56 + i * 12, 45, 83 + i * 12, 85);
    g.stroke();
  }
});

export class Actors {
  private rigs = new Map<string, PlayerRig>();
  private bodyRigs: BodyRig[] = [];

  constructor(private groups: ActorGroups) {
    groups.playersIn.sortableChildren = true;
    groups.playersOut.sortableChildren = true;
    groups.playersCaged.sortableChildren = true;
  }

  private playerRig(): PlayerRig {
    const root = new Container();
    const shadow = spr(root, ellipseTexture());
    shadow.anchor.set(0.5, 0.5);
    shadow.position.set(0, 2);
    shadow.width = 34;
    shadow.height = 8;
    shadow.tint = 0x000000;
    shadow.alpha = 0.35;
    const body = spr(root);
    body.anchor.set(0.5, 1);
    const kit = spr(root);
    kit.position.set(-42, -44);
    kit.width = 38;
    kit.height = 28;
    const keyIcon = spr(root, keyIconTex());
    keyIcon.anchor.set(0.5, 0.5);
    keyIcon.position.set(16, -58);
    keyIcon.width = 14;
    keyIcon.height = 14;
    const tpLight = spr(root, lightTexture("156,218,211"));
    tpLight.anchor.set(0.5, 0.5);
    tpLight.position.set(20, -52);
    tpLight.width = 28;
    tpLight.height = 32;
    tpLight.alpha = 0.5;
    const tp = spr(root);
    tp.position.set(12, -62);
    tp.width = 15;
    tp.height = 20;
    const label = spr(root);
    label.anchor.set(0.5, 1);
    label.position.set(0, -58);
    const action = spr(root);
    action.anchor.set(0.5, 1);
    action.position.set(0, -82);
    const bubble = spr(root);
    bubble.anchor.set(0.5, 1);
    return { root, shadow, body, kit, keyIcon, tpLight, tp, label, labelKey: "", action, actionKey: "", bubble, bubbleKey: "" };
  }

  /** Draws every player into its layer group, in the viewer-last order of `sorted`. */
  update(v: View, motion: Map<string, Motion>): void {
    const seen = new Set<string>();
    let zIn = 0;
    let zCaged = 0;
    let zOut = 0;
    for (const p of v.sorted) {
      seen.add(p.id);
      let rig = this.rigs.get(p.id);
      if (!rig) {
        rig = this.playerRig();
        this.rigs.set(p.id, rig);
      }
      const group = p.caged ? this.groups.playersCaged : p.inside ? this.groups.playersIn : this.groups.playersOut;
      if (rig.root.parent !== group) group.addChild(rig.root);
      rig.root.zIndex = p.caged ? zCaged++ : p.inside ? zIn++ : zOut++;
      this.updatePlayer(v, motion, rig, p);
    }
    for (const [id, rig] of this.rigs) if (!seen.has(id)) rig.root.visible = false;
    this.updateBodies(v);
  }

  private updatePlayer(v: View, motion: Map<string, Motion>, rig: PlayerRig, p: View["sorted"][number]): void {
    const shownX = v.displayX.get(p.id) ?? p.x;
    const ghost = !p.alive;
    if (ghost && v.snap.self.alive) { rig.root.visible = false; return; } // the living cannot see ghosts
    if (shownX < v.cam - 100 || shownX > v.cam + v.w + 100) { rig.root.visible = false; return; }
    rig.root.visible = true;
    const isMate = v.snap.self.teammates.includes(p.id);
    const floatY = ghost ? -14 + Math.sin(v.t * 2 + p.x) * 5 : 0;

    let seenMotion = motion.get(p.id);
    if (!seenMotion) {
      seenMotion = { x: shownX, facing: p.facing, movingUntil: 0 };
      motion.set(p.id, seenMotion);
    }
    const dx = shownX - seenMotion.x;
    if (Math.abs(dx) > 0.6) {
      seenMotion.facing = dx > 0 ? 1 : -1;
      seenMotion.movingUntil = v.t + 0.12;
    } else if (p.moving && p.id !== v.snap.self.id) {
      seenMotion.movingUntil = Math.max(seenMotion.movingUntil, v.t + 0.05);
    }
    seenMotion.x = shownX;

    rig.root.position.set(shownX, floatY);
    const moving = v.t < seenMotion.movingUntil;
    const gait = Math.sin(v.t * 11 + shownX * 0.1);
    const bob = ghost ? 0 : moving ? gait * 1.8 : Math.sin(v.t * 1.7 + shownX) * 0.35;
    const pose = moving ? (gait > 0.25 ? 1 : gait < -0.25 ? -1 : 0) : 0;
    const tex = travelerTexture(p.color, isMate || (p.id === v.snap.self.id && v.snap.self.role === "hollow"), ghost, pose);
    if (tex) {
      if (rig.body.texture !== tex) rig.body.texture = tex;
      rig.body.renderable = true;
    } else rig.body.renderable = false;
    rig.body.position.set(0, bob);
    rig.body.scale.x = seenMotion.facing;
    rig.body.alpha = ghost ? 0.45 : p.echo ? 0.52 : 1;
    rig.shadow.visible = !ghost;

    const kitTex = p.hasSupply ? artTexture("props/supply-kit.svg", 38, 28) : null;
    rig.kit.visible = !!kitTex;
    if (kitTex && rig.kit.texture !== kitTex) rig.kit.texture = kitTex;
    rig.kit.position.set(-42, -44 + floatY - floatY); // kit rides at ground level in rig space
    rig.kit.position.y = -44;
    rig.keyIcon.visible = p.hasKey || (p.doorKeys?.length ?? 0) > 0;
    const tpTex = p.hasTimepiece ? artTexture("props/timepiece.svg", 15, 20) : null;
    rig.tp.visible = !!tpTex;
    if (tpTex && rig.tp.texture !== tpTex) rig.tp.texture = tpTex;
    rig.tpLight.visible = !!tpTex && v.glow;

    // Name, action and speech are optional HUD layers; figures stay identifiable by colour.
    const showLabels = !v.glassUp;
    if (showLabels && v.settings.interface.playerNames) {
      const label = p.name + (p.echo ? " · echo" : v.snap.phase === "meeting" && p.voted ? " ✓" : "");
      const colorKey = p.id === v.snap.self.id ? "self" : p.echo ? "echo" : isMate ? "mate" : "other";
      const key = `${colorKey}|${label}`;
      if (rig.labelKey !== key) {
        rig.labelKey = key;
        const baked = labelTexture(`name|${key}`, label, "600 12px system-ui, sans-serif",
          colorKey === "self" ? "#ffd98a" : colorKey === "echo" ? "#b9d9d5" : colorKey === "mate" ? "#ff7a6a" : "rgba(245,235,220,0.96)",
          { bg: "rgba(5,3,8,0.55)", h: 17, padX: 5 });
        rig.label.texture = baked.tex;
      }
      rig.label.visible = true;
    } else rig.label.visible = false;

    if (showLabels && p.action && p.action.until > v.now) {
      if (rig.actionKey !== p.action.text) {
        rig.actionKey = p.action.text;
        const baked = labelTexture(`action|${p.action.text}`, p.action.text, "600 10px system-ui, sans-serif",
          p.echo ? "#bde6dc" : "#f2d1a2", { bg: "rgba(20,27,29,0.9)", h: 16, padX: 6 });
        rig.action.texture = baked.tex;
      }
      rig.action.visible = true;
    } else rig.action.visible = false;

    if (showLabels && p.bubble && v.settings.interface.speechBubbles && p.bubble.text) {
      if (rig.bubbleKey !== p.bubble.text) {
        rig.bubbleKey = p.bubble.text;
        rig.bubble.texture = bubbleTexture(p.bubble.text);
      }
      rig.bubble.visible = true;
      rig.bubble.alpha = Math.max(0.15, Math.min(1, (p.bubble.until - v.now) / 800));
      rig.bubble.position.set(0, (p.action ? -100 : -72) + 7);
    } else rig.bubble.visible = false;
  }

  private updateBodies(v: View): void {
    const bodies = v.snap.bodies;
    while (this.bodyRigs.length < bodies.length) {
      const root = new Container();
      const blood = spr(root);
      blood.position.set(-30, -9);
      blood.width = 60;
      blood.height = 14;
      const flash = spr(root, lightTexture("220,40,28"));
      flash.anchor.set(0.5, 0.5);
      flash.position.set(0, -45);
      const slashes = spr(root, slashTex());
      slashes.position.set(-48, -110);
      slashes.width = 96;
      slashes.height = 96;
      const figure = spr(root);
      figure.anchor.set(0.5, 1);
      figure.rotation = Math.PI / 2;
      figure.position.set(0, -10);
      const crows: Sprite[] = [];
      for (let i = 0; i < 3; i++) {
        const crow = spr(root, crowTex());
        crow.anchor.set(0.5, 0.5);
        crow.width = 14;
        crow.height = 8;
        crows.push(crow);
      }
      this.bodyRigs.push({ root, blood, flash, slashes, figure, crows });
    }
    for (let i = 0; i < this.bodyRigs.length; i++) {
      const rig = this.bodyRigs[i];
      if (i >= bodies.length) { rig.root.visible = false; continue; }
      const b: Body = bodies[i];
      const group = b.inside ? this.groups.bodiesIn : this.groups.bodiesOut;
      if (rig.root.parent !== group) group.addChild(rig.root);
      if (b.x < v.cam - 160 || b.x > v.cam + v.w + 160) { rig.root.visible = false; continue; }
      rig.root.visible = true;
      rig.root.position.set(b.x, 0);
      const bloodTex = artTexture("props/blood-pool.svg", 60, 14);
      if (bloodTex && rig.blood.texture !== bloodTex) rig.blood.texture = bloodTex;
      rig.blood.renderable = !!bloodTex;
      const figTex = travelerTexture(b.color, false, false, 0);
      if (figTex && rig.figure.texture !== figTex) rig.figure.texture = figTex;
      rig.figure.renderable = !!figTex;
      const age = b.at ? v.now - b.at : 9999;
      const showFlash = age >= 0 && age < 950 && !v.reduced;
      rig.flash.visible = showFlash;
      rig.slashes.visible = showFlash && age / 950 < 0.55;
      if (showFlash) {
        const p = age / 950;
        const r = (70 + p * 80) * 2;
        rig.flash.width = r;
        rig.flash.height = r;
        rig.flash.alpha = (1 - p) * 0.7 * 0.9;
        rig.slashes.alpha = 1 - p;
      }
      for (let c = 0; c < 3; c++) {
        const a = v.t * (0.9 + c * 0.2) + c * 2.1;
        rig.crows[c].position.set(
          Math.cos(a) * (34 + c * 14),
          -120 - c * 16 + Math.sin(a * 1.7) * 10,
        );
      }
    }
  }
}

/** A speech bubble (plate, tail, wrapped lines) baked per text. */
function bubbleTexture(text: string): import("pixi.js").Texture {
  const asc = getArtScale();
  const font = "12px system-ui, sans-serif";
  const lines = wrapText(text, 150, font, 4);
  const bw = (lines.length ? Math.max(...lines.map((l) => measureTextWidth(l, font))) : 0) + 16;
  const bh = lines.length * 15 + 10;
  return bakedTexture(`bubble|${text}|${asc}`, Math.ceil(bw * asc), Math.ceil((bh + 7) * asc), asc, (g, pw, ph) => {
    const s = asc;
    g.fillStyle = "rgba(245,240,228,0.95)";
    g.beginPath();
    g.roundRect(0, 0, bw * s, bh * s, 8 * s);
    g.moveTo((bw / 2 - 5) * s, bh * s);
    g.lineTo((bw / 2 + 5) * s, bh * s);
    g.lineTo((bw / 2) * s, ph);
    g.fill();
    g.fillStyle = "#241a14";
    g.font = `${12 * s}px system-ui, sans-serif`;
    g.textAlign = "center";
    lines.forEach((l, i) => g.fillText(l, pw / 2, (17 + i * 15) * s));
    void ph;
  });
}
