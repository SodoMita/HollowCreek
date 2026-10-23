/**
 * HOLLOW CREEK — NIGHTJAR ADDITION — ward minigames (pure state machines, no UI imports).
 * Replaces "hold interact for TASK_HOLD_MS". Each of the 14 wards is a
 * different hand: discernment, timing, rhythm, breath, memory, restraint,
 * deduction, balance, listening. Deterministic given a seed so the server can
 * validate and the static + React clients can render the same game.
 *
 * Wire-up for the authoritative engine: instead of `t.progress += TICK/TASK_HOLD`,
 * accept `body.minigame = { act, v }` events and call `step()` here; feed the
 * returned `progress` into the existing ward progress/vigor drain path.
 */
import type { Station } from "./types";

/** The 14 ward kinds exactly as src/game/types.ts declares Station["kind"]. */
export type WardKind = Station["kind"];

export type Mechanic = "pick" | "meter" | "multi" | "order" | "band" | "memory" | "reflex" | "dials" | "balance" | "tune";

export interface WardGameSpec {
  kind: WardKind; mechanic: Mechanic; title: string; skill: string; brief: string; verb: string; need: number;
}

export const WARD_GAMES: Record<WardKind, WardGameSpec> = {
  pumpkins:  { kind: "pumpkins",  mechanic: "pick",    title: "Harvest the pumpkins",        skill: "Discernment", brief: "Cut 5 ripe pumpkins. Green are unripe, spotted are rotten — a rotten one in the cart spoils the load.", verb: "Cut", need: 5 },
  well:      { kind: "well",      mechanic: "meter",   title: "Draw water from the old well", skill: "Timing",      brief: "Crank runs. Stop the handle inside the brass band, three good turns, before the rope slips.", verb: "Lock the crank", need: 3 },
  beehive:   { kind: "beehive",   mechanic: "band",    title: "Smoke the beehives",           skill: "Breath",      brief: "Hold the bellows so the smoke sits in the cool band. Too thin and the bees rise; too thick and you suffocate the comb.", verb: "Hold bellows", need: 1 },
  woodpile:  { kind: "woodpile",  mechanic: "multi",   title: "Split the woodpile",           skill: "Rhythm",      brief: "Three rings to strike. Swing as the grain-mark crosses the notch — early or late and the axe bites the block.", verb: "Strike", need: 6 },
  lantern:   { kind: "lantern",   mechanic: "meter",   title: "Relight the street lanterns",   skill: "Precision",   brief: "The wick climbs fast. Trim it inside the gold, three times, or the glass soots over again.", verb: "Trim wick", need: 3 },
  chapel:    { kind: "chapel",    mechanic: "memory",  title: "Light the chapel candles",      skill: "Memory",      brief: "The sacristan taps the order on the altar rails. Repeat it — five this time, not four.", verb: "Light", need: 5 },
  laundry:   { kind: "laundry",   mechanic: "reflex",  title: "Bring in the laundry",          skill: " Reflex",     brief: "A gust is coming. Pull the pegs before the sheets tear off the line — six of them.", verb: "Grab", need: 6 },
  mill:      { kind: "mill",      mechanic: "multi",   title: "Oil the sawmill gears",         skill: "Timing",      brief: "Three cogs turn at different speeds. Oil each as its mark passes the top notch, or the teeth chatter.", verb: "Oil", need: 6 },
  silo:      { kind: "silo",      mechanic: "dials",   title: "Lock the grain silo",           skill: "Deduction",   brief: "The keeper carved today's code above the door. Set the three dials, then throw the bolt.", verb: "Throw bolt", need: 1 },
  gate:      { kind: "gate",      mechanic: "band",    title: "Bar the north gate",            skill: "Nerve",       brief: "Hold the chain so the bar hangs level in the slot while you slide the pin. Something is in the wood behind you.", verb: "Hold bar", need: 1 },
  graves:    { kind: "graves",    mechanic: "pick",    title: "Cover the open graves",         skill: "Restraint",   brief: "Shovel till seven graves are closed. Hit a stone and the spade rings — and the whole hollow hears it.", verb: "Shovel", need: 7 },
  bridge:    { kind: "bridge",    mechanic: "balance", title: "Mend the creek bridge",         skill: "Balance",     brief: "Kneel on the wet plank and nail the brace. Keep it level: tap the low side, hold the line, ten seconds.", verb: "Nail", need: 1 },
  radio:     { kind: "radio",     mechanic: "tune",    title: "Retune the radio tower",        skill: "Listening",   brief: "No picture, only signal. Slide the dial until the static parts and a voice comes through, then lock it.", verb: "Lock signal", need: 1 },
  scarecrow: { kind: "scarecrow", mechanic: "order",   title: "Mend the scarecrow",            skill: "Sequence",    brief: "Six patches, one thread. Stitch them in the order the twine is numbered or the seam pulls.", verb: "Stitch", need: 6 },
};

export const WARD_ORDER: WardKind[] = ["pumpkins","well","scarecrow","beehive","woodpile","lantern","chapel","laundry","mill","silo","gate","graves","bridge","radio"];

export interface Session {
  kind: WardKind; spec: WardGameSpec; seed: number; t: number;
  progress: number; done: boolean; failed: boolean; score: number; msg: string;
  d: Record<string, any>;
}

const rnd = (s: number) => { let x = s >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296 }; };

export function createSession(kind: WardKind, seed = 1): Session {
  const spec = WARD_GAMES[kind];
  const r = rnd(seed * 7919 + kind.length * 131 + 11);
  const base: Session = { kind, spec, seed, t: 0, progress: 0, done: false, failed: false, score: 0, msg: spec.brief, d: {} };
  if (spec.mechanic === "pick") {
    const n = 14, need = spec.need;
    const items = Array.from({ length: n }, (_, i) => i).map((i) => ({ i, good: false, r: r() }));
    const good = new Set<number>(); while (good.size < need + 2) good.add(Math.floor(r() * n));
    items.forEach((it) => (it.good = good.has(it.i)));
    base.d = { items, need, got: 0, slips: 0 };
  } else if (spec.mechanic === "meter") {
    base.d = { pos: 0, dir: 1, speed: kind === "lantern" ? 3.1 : 2.3, a: 40 + Math.floor(r() * 18), band: kind === "lantern" ? 11 : 15, hits: 0, need: spec.need };
  } else if (spec.mechanic === "multi") {
    base.d = { gears: [0, 1, 2].map((i) => ({ pos: r() * 100, sp: (kind === "mill" ? 1.5 : 1.2) + i * 0.55 })), hits: 0, need: spec.need, slips: 0 };
  } else if (spec.mechanic === "order") {
    const cells = Array.from({ length: 6 }, (_, i) => i + 1).sort(() => r() - 0.5);
    base.d = { cells, next: 1, slips: 0 };
  } else if (spec.mechanic === "band") {
    base.d = { level: 0.18, held: false, inBand: 0, need: kind === "beehive" ? 4.2 : 3.4, bees: 0, scare: kind === "gate" ? 1 : 0, ticks: 0 };
  } else if (spec.mechanic === "memory") {
    const len = spec.need; const seq = Array.from({ length: len }, () => Math.floor(r() * 4));
    base.d = { seq, phase: "show", idx: -1, input: [], slips: 0 };
  } else if (spec.mechanic === "reflex") {
    base.d = { slots: Array.from({ length: 6 }, () => ({ live: false, left: 0, t: 0 })), spawned: 0, got: 0, lost: 0, need: spec.need, nextIn: 0.35 };
  } else if (spec.mechanic === "dials") {
    base.d = { code: [1 + Math.floor(r() * 9), 1 + Math.floor(r() * 9), 1 + Math.floor(r() * 9)], dials: [1, 1, 1] };
  } else if (spec.mechanic === "balance") {
    base.d = { tilt: 0, hold: 0, left: 10, nails: 0, wob: 0.6 + r() * 0.5 };
  } else {
    base.d = { target: 26 + r() * 52, pos: 4, locked: false, drift: (r() - 0.5) * 0.06 };
  }
  return base;
}

/** Advance real-time parts of a game. dt in seconds. Pure-ish: returns new session. */
export function step(s: Session, dt: number): Session {
  if (s.done || s.failed) return s;
  const n: Session = { ...s, t: s.t + dt, d: { ...s.d } };
  const m = n.spec.mechanic, d = n.d;
  if (m === "meter") {
    let p = d.pos + d.dir * d.speed * dt * 30;
    if (p > 100) { p = 100; d.dir = -1 } if (p < 0) { p = 0; d.dir = 1 }
    d.pos = p;
  } else if (m === "multi") {
    // a ring's grease dries once it comes back round: each needs oiling again
    d.gears = d.gears.map((g: any) => {
      let p = g.pos + g.sp * dt * 46, oiled = g.oiled;
      if (p >= 100) { p -= 100; oiled = false }
      return { ...g, pos: p, oiled };
    });
  } else if (m === "band") {
    const grav = d.held ? 0.55 : -0.75;
    d.level = clamp01(d.level + (grav + (d.held ? (0.5 - d.level) * 1.4 : 0)) * dt);
    const inBand = d.level > 0.42 && d.level < 0.68;
    if (inBand) { d.inBand += dt; d.bees = Math.max(0, d.bees - dt * 0.8) } else { d.bees += dt * (d.level <= 0.42 ? 0.9 : 1.5) }
    n.progress = clamp01(d.inBand / d.need);
    if (d.bees > 3.2) { n.failed = true; n.msg = d.scare ? "The bar slammed down and something answered from the treeline. Back off." : "Bees up in a black rope — run, or breathe and try again." }
    if (n.progress >= 1) finish(n, Math.round(100 - d.bees * 9));
  } else if (m === "memory") {
    if (d.phase === "show") {
      d.t = (d.t || 0) + dt;
      if (d.t > 0.62) { d.t = 0; d.idx++; if (d.idx >= d.seq.length) { d.phase = "input"; n.msg = "Now the order, from memory." } }
    }
  } else if (m === "reflex") {
    d.nextIn -= dt;
    if (d.nextIn <= 0 && d.spawned < d.need + 4) {
      d.spawned++; d.nextIn = 0.62 + Math.random() * 0.45;
      const free = d.slots.map((x: any, i: number) => (x.live ? -1 : i)).filter((i: number) => i >= 0);
      if (free.length) { const i = free[Math.floor(Math.random() * free.length)]; d.slots = d.slots.map((x: any, j: number) => j === i ? { live: true, left: 1.5, t: 0 } : x) }
    }
    d.slots = d.slots.map((x: any) => x.live ? { ...x, left: x.left - dt } : x);
    const dropped = d.slots.filter((x: any) => x.live && x.left <= 0).length;
    if (dropped) { d.lost += dropped; n.msg = `${dropped} sheet(s) torn into the treeline. Restring and go again.` }
    d.slots = d.slots.map((x: any) => x.live && x.left <= 0 ? { live: false, left: 0, t: 0 } : x);
    n.progress = clamp01(d.got / d.need);
    if (d.lost >= 3) { n.failed = true; n.msg = "The line is bare. The wind wins this round." }
  } else if (m === "balance") {
    d.left -= dt;
    const push = Math.sin(n.t * d.wob * 3.4) * 0.9 + (Math.random() - 0.5) * 1.6;
    d.tilt = clamp(-3.2, 3.2, d.tilt + (push - d.hold * 1.9) * dt);
    d.hold = Math.max(0, d.hold - dt * 1.6);
    n.progress = clamp01(1 - d.left / 10);
    if (Math.abs(d.tilt) > 3.1) { n.failed = true; n.msg = "Off the plank into the creek. Cold, and loud." }
    if (d.left <= 0) finish(n, Math.round(88 + (Math.abs(d.tilt) < 0.6 ? 12 : 0)));
  } else if (m === "tune") {
    d.pos = clamp01((d.pos + d.drift * dt * 12) / 100) * 100;
    n.progress = clamp01(1 - Math.abs(d.pos - d.target) / 60);
  }
  if (n.t > 42 && !n.done && !n.failed) { n.failed = true; n.msg = "Too slow — the ward stays dark and something walked past while you fussed." }
  return n;
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clamp = (a: number, b: number, v: number) => Math.max(a, Math.min(b, v));
function finish(s: Session, score: number) { s.done = true; s.progress = 1; s.score = Math.max(55, Math.min(100, score)); s.msg = "Ward lit. The dark gives an inch."; }

/** Player event. `act` names a control, `v` an index/value. */
export function act(s: Session, action: string, v = 0): Session {
  if (s.done || s.failed) return s;
  const n: Session = { ...s, d: { ...s.d } }; const d = n.d, m = n.spec.mechanic;
  if (m === "pick" && action === "take") {
    if (d.items[v].good && !d.items[v].taken) { d.items = d.items.map((x: any, i: number) => i === v ? { ...x, taken: true } : x); d.got++; n.msg = `${d.got}/${d.need} ripe in the cart.`; if (d.got >= d.need) finish(n, 100 - d.slips * 12) }
    else if (!d.items[v].good) { d.slips++; n.msg = d.items[v].r > 0.5 ? "Rotten — the cart will smell." : "Unripe. It will never sweeten." }
    n.progress = clamp01(d.got / d.need);
  } else if (m === "meter" && action === "stop") {
    const inZone = d.pos >= d.a - d.band / 2 && d.pos <= d.a + d.band / 2;
    if (inZone) { d.hits++; d.a = 20 + Math.random() * 62; n.msg = `${d.hits}/${d.need} good turns — steady hand.`; if (d.hits >= d.need) finish(n, 96) }
    else { d.speed += 0.22; n.msg = "Clunk. The rope slipped; crank's running faster now." }
  } else if (m === "multi" && action === "hit") {
    const i = v; const g = d.gears[i]; const near = Math.abs(((g.pos + 50) % 100) - 50) < 9;
    if (near && !g.oiled) { d.gears = d.gears.map((x: any, j: number) => j === i ? { ...x, oiled: true } : x); d.hits++; n.msg = `Ring ${i + 1} greased (${d.hits}/${d.need}).`; if (d.hits >= d.need) finish(n, 100 - d.slips * 8) }
    else if (!near) { d.slips++; n.msg = "Teeth chatter — you struck off-beat." }
    n.progress = clamp01(d.hits / d.need);
  } else if (m === "order" && action === "stitch") {
    if (d.cells[v] === d.next) { d.next++; n.progress = clamp01((d.next - 1) / 6); n.msg = `Seam ${d.next - 1}/6 pulled tight.`; if (d.next > 6) finish(n, 100 - d.slips * 10) }
    else { d.slips++; n.msg = "Wrong hole — the thread knots. Restart the pull."; d.next = 1; n.progress = 0 }
  } else if (m === "band") { d.held = action === "down"; if (action === "down") n.msg = "Smoke rising… keep it in the cool band."; }
  else if (m === "memory") {
    if (d.phase !== "input") return n;
    if (d.seq[d.input.length] === v) { d.input = [...d.input, v]; n.msg = `${d.input.length}/${d.seq.length} candles burning.`; if (d.input.length === d.seq.length) finish(n, 94) }
    else { d.slips++; d.input = []; d.phase = "show"; d.idx = -1; d.t = -0.9; n.msg = "Wrong candle — the sacristan taps it again." }
  } else if (m === "reflex" && action === "grab") {
    if (d.slots[v].live) { d.slots = d.slots.map((x: any, i: number) => i === v ? { live: false, left: 0, t: 0 } : x); d.got++; n.progress = clamp01(d.got / d.need); n.msg = `${d.got}/${d.need} off the line.`; if (d.got >= d.need) finish(n, 92) }
  } else if (m === "dials") {
    if (action === "turn") { d.dials = d.dials.map((x: number, i: number) => i === v ? (x % 9) + 1 : x) }
    else if (action === "bolt") { if (d.dials.join() === d.code.join()) finish(n, 97); else { n.msg = "The bolt jams. Read the carving again."; d.tries = (d.tries || 0) + 1; if (d.tries > 3) { n.failed = true; n.msg = "Keeper changed the code on you. Back to the porch." } } }
  } else if (m === "balance") { if (action === "lean") d.hold = v ? 1 : -1; else if (action === "nail" && Math.abs(d.tilt) < 0.75) { d.nails++; n.msg = `Brace nailed (${d.nails}).` } }
  else if (m === "tune") {
    if (action === "dial") d.pos = clamp(0, 100, v);
    else if (action === "lock") { if (Math.abs(d.pos - d.target) < 3.2) finish(n, 99); else { n.msg = "Only static. The voice was somewhere else."; d.target = 20 + Math.random() * 62 } }
    n.progress = clamp01(1 - Math.abs(d.pos - d.target) / 60);
  }
  return n;
}
