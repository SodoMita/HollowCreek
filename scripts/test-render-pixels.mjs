// Pixel regression harness for the canvas renderer (src/game/render*).
//
// Renders fixed snapshot scenarios with the given renderer entry point in
// headless Chromium and prints one "scenario frame hash" line per frame.
// Use it as an A/B check around refactors: run it on both trees, then diff.
//
//   node scripts/test-render-pixels.mjs src/game/render.ts > before.txt
//   node scripts/test-render-pixels.mjs src/game/render/index.ts > after.txt
//   diff before.txt after.txt && echo IDENTICAL
//   RENDER_PNG_DIR=shots node scripts/test-render-pixels.mjs ...   (also saves one PNG per scenario)
//
// Determinism: Math.random is seeded per scenario, art is served locally and
// settled before the measured frames, and every frame is hashed from the
// canvas pixels. Hashes are only comparable on the same machine and browser.
import { chromium } from "playwright";
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entryArg = process.argv[2] ?? "src/game/render.ts";
const entry = resolve(repo, entryArg);
const W = 900, H = 560;
const ORIGIN = "http://harness.local";

// 1. Bundle the renderer plus the fixtures it needs into one browser script.
const cacheDir = join(repo, ".cache", "render-harness");
mkdirSync(cacheDir, { recursive: true });
const wrapper = join(cacheDir, "entry.ts");
writeFileSync(wrapper, [
  `export * from ${JSON.stringify(entry)};`,
  `export { createDefaultSettings } from ${JSON.stringify(join(repo, "src/game/settings.ts"))};`,
  `export { STATIONS, CAGE_XS } from ${JSON.stringify(join(repo, "src/game/types.ts"))};`,
  `export { BUILDINGS } from ${JSON.stringify(join(repo, "src/game/buildings.ts"))};`,
].join("\n"));
const bundle = await build({
  entryPoints: [wrapper], bundle: true, write: false, format: "iife", globalName: "H",
  target: "es2022", logLevel: "silent",
});
const js = bundle.outputFiles[0].text;

const pageHtml = `<!doctype html><html><head><meta charset="utf-8">
<meta name="hc-art-base" content="${ORIGIN}/art/"></head>
<body style="margin:0;background:#000"><canvas id="c" width="${W}" height="${H}"></canvas>
<script src="${ORIGIN}/bundle.js"></script></body></html>`;

// Seeded RNG installed before any page script runs.
const SEED_INIT = `
  (function () {
    let s = 1;
    Math.random = function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__reseed = function (seed) { s = seed | 0; };
  })();`;

const artRoot = join(repo, "public", "art");
const contentType = (p) => ({ ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" }[extname(p)] ?? "application/octet-stream");

// ---------------------------------------------------------------------------
// Scenario fixtures (plain snapshot objects in the shape the renderer reads).
// Built inside the page so they can use the bundled STATIONS / BUILDINGS.
// ---------------------------------------------------------------------------
const FIXTURES = `
window.__scenarios = function (H) {
  const { STATIONS, CAGE_XS, BUILDINGS } = H;
  const me = (over) => ({
    id: "me", role: "crew", alive: true, caged: false, hasKey: false, hasSupply: false,
    doorKeys: [], hasTimepiece: false, bellUsed: false, killCooldownMs: 0, canKill: false,
    stamina: 0.8, exhausted: false, blackoutCooldownMs: 0, canBlackout: false,
    sabotageCooldownMs: 0, canSabotage: false, teammates: [], ...over,
  });
  const player = (id, name, color, x, over) => ({
    id, name, color, x, facing: 1, moving: false, alive: true, caged: false, hasKey: false,
    hasSupply: false, inside: null, voted: false, bubble: null, isHost: false, ...over,
  });
  const tasks = (phase) => STATIONS.map((st, i) => ({
    id: st.id, name: st.name, x: st.x, inside: st.inside, done: i % 3 === 0,
    delivered: i % 2 === 0, sabotaged: i === 5, progress: (i % 4) / 4,
  }));
  const doors = () => BUILDINGS.map((b, i) => ({
    id: b.id, locked: i % 2 === 1, open: i % 2 === 0, keyX: i === 2 ? 900 : null, holder: null,
  }));
  const base = (over) => ({
    code: "TEST", phase: "playing", round: 2, now: 500000,
    self: me({}), players: [], bodies: [], doors: doors(), keyX: null, timepieceX: null,
    timepieces: [], time: undefined, supplyDrops: [], notes: [], cartX: 1400, cartPushers: 0,
    cages: [], tasks: tasks(), minigame: null, taskBar: { done: 2, total: 6 }, meeting: null,
    feed: [], winner: null, winReason: null, results: null, bellAt: 0, flickerAt: 0,
    blackoutUntil: 0, danger: 0, visionRadius: 420, hint: null, abilityLabel: "", abilityReady: false,
    hostId: "me", playerCount: 4, nightT: 0.5, ...over,
  });
  const notes = [
    { id: "n1", x: 1000, kind: "wall", house: null, author: "Olga", text: "The bell rang twice before the lamps went out, and nobody came up the road." },
    { id: "n2", x: 1500, kind: "tree", house: null, author: "Piotr", text: "Trust the quiet ones." },
    { id: "n3", x: BUILDINGS[0].x + 40, kind: "wall", house: BUILDINGS[0].id, author: "Marta", text: "Kept the key under the third stone." },
  ];
  const crowd = (over) => [
    player("me", "Marta", "#7ab0c9", 1080, { isHost: true, ...over.me }),
    player("p2", "Nils", "#d9a441", 1300, { moving: true, facing: -1, hasKey: true, voted: true }),
    player("p3", "Olga", "#8ec46f", 1700, { alive: false, moving: false }),
    player("p4", "Piotr", "#c97fb0", 1950, { caged: true, bubble: { text: "Who rang the bell?", until: 500000 + 4000 } }),
    player("p5", "Hanna", "#e0785a", 3000, { inside: BUILDINGS[1].id, action: { text: "Working", until: 500000 + 2000 } }),
    player("p6", "Kasia", "#a9a0e8", 1790, { echo: true, hasTimepiece: true, action: { text: "Walking the past", until: 500000 + 900 } }),
  ];
  const playing = (over) => base({
    players: crowd({ me: {} }),
    keyX: 700, supplyDrops: [620], cartX: 1400, cartPushers: 2, timepieces: [1900],
    bellAt: 500000 - 1000, flickerAt: 500000 - 200, blackoutUntil: 500000 + 2000, nightT: 0.65,
    notes, bodies: [{ x: 1200, color: "#c44a3a", name: "Olga", id: "p3", at: 500000 - 300, inside: null }],
    cages: CAGE_XS.map((x, i) => ({ x, occupant: i === 0 ? "p4" : null })),
    danger: 0.7, ...over,
  });
  return [
    { name: "lobby", frames: [{ t: 3, dt: 0.016, snap: base({ phase: "lobby", nightT: 0.1, players: crowd({ me: {} }).slice(0, 2), tasks: tasks() }) }] },
    { name: "playing-night", frames: [{ t: 12.3, dt: 0.016, snap: playing({}) }] },
    { name: "playing-multiframe", frames: [0, 1, 2, 3, 4].map((i) => ({ t: 20 + i * 0.05, dt: 0.05, snap: playing({ now: 500000 + i * 50, nightT: 0.55 + i * 0.01 }) })) },
    { name: "meeting", frames: [{ t: 7.5, dt: 0.016, snap: playing({ phase: "meeting", nightT: 0.9, meeting: { endsAt: 530000, reason: "body", inArea: true }, bodies: [] }) }] },
    { name: "past-time", frames: [{ t: 9, dt: 0.016, snap: playing({ time: { mode: "past", earliest: 0, latest: 1000 }, nightT: 0.7 }) }] },
    { name: "glass-focus", focus: 1000, zoom: 2.4, frames: [{ t: 11, dt: 0.016, snap: playing({}) }] },
    { name: "vision-200-bubbles", frames: [{ t: 14, dt: 0.016, snap: playing({ visionRadius: 200, players: crowd({ me: { bubble: { text: "The creek is rising again tonight, so keep to the lanterns.", until: 500800 } } }) }) }] },
    { name: "low-quality", settings: { quality: "low", particles: false, fog: false, vignette: false, flicker: false }, frames: [{ t: 5, dt: 0.016, snap: playing({ nightT: 0.3 }) }] },
    { name: "medium-glow-off", settings: { quality: "medium", glow: false, playerNames: false, speechBubbles: false }, frames: [{ t: 6, dt: 0.016, snap: playing({ nightT: 0.4 }) }] },
    { name: "reduced-motion", settings: { reducedMotion: true }, frames: [{ t: 8, dt: 0.016, snap: playing({}) }] },
    { name: "ended-and-lobby-tasks", frames: [{ t: 4, dt: 0.016, snap: playing({ phase: "ended", winner: "crew", nightT: 0.2, notes: [] }) }] },
    // Camera parked over each station group so every station kind is drawn at least once.
    ...[["harvest-well", 450], ["chapel-cages", 1700], ["mill-graves", 2900], ["radio-silo", 3700]].map(([name, x]) => ({
      name, frames: [{ t: 16, dt: 0.016, snap: playing({ players: crowd({ me: { x } }) }) }],
    })),
  ];
};`;

// ---------------------------------------------------------------------------
// Browser side: run every scenario on a freshly seeded page, hash each frame.
// ---------------------------------------------------------------------------
const RUNNER = `
window.__run = async function (scenario, seed) {
  const H = window.H;
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const hash = () => {
    const d = ctx.getImageData(0, 0, ${W}, ${H}).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  const apply = (r) => {
    if (scenario.focus !== undefined) r.setFocus(scenario.focus);
    if (scenario.zoom) r.setViewZoom(scenario.zoom);
  };
  const settingsFor = () => {
    const s = H.createDefaultSettings();
    for (const [k, v] of Object.entries(scenario.settings ?? {})) {
      if (["quality"].includes(k)) s.graphics[k] = v;
      else if (["playerNames", "speechBubbles"].includes(k)) s.interface[k] = v;
      else s.graphics[k] = v;
    }
    return s;
  };
  // Warm-up: trigger art loads, let them settle, then start the measured run.
  const warm = new H.Renderer();
  warm.setSettings(settingsFor());
  apply(warm);
  const first = scenario.frames[0];
  warm.render(ctx, ${W}, ${H}, first.snap, new Map(), first.t, first.dt);
  await new Promise((res) => setTimeout(res, 1500));
  window.__reseed(seed);
  const r = new H.Renderer();
  r.setSettings(settingsFor());
  apply(r);
  const out = [];
  for (const f of scenario.frames) {
    const dx = new Map(f.snap.players.map((p) => [p.id, p.x]));
    r.render(ctx, ${W}, ${H}, f.snap, dx, f.t, f.dt);
    out.push(hash());
  }
  return out;
};`;

const scenarioNames = (fixtures) => fixtures;

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  await context.addInitScript(SEED_INIT);
  // Serve the page, the bundle and public/art from a local origin.
  await context.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/bundle.js") {
      return route.fulfill({ status: 200, contentType: "application/javascript", body: `${js}\n${FIXTURES}\n${RUNNER}` });
    }
    if (url.pathname.startsWith("/art/")) {
      const file = join(artRoot, decodeURIComponent(url.pathname.slice(5)));
      if (existsSync(file)) return route.fulfill({ status: 200, contentType: contentType(file), body: readFileSync(file) });
      return route.fulfill({ status: 404, body: "missing" });
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: pageHtml });
  });

  // One page per scenario so the seeded random stream always starts identically.
  const probe = await context.newPage();
  await probe.goto(`${ORIGIN}/index.html`);
  const names = await probe.evaluate(() => { const list = window.__scenarios(window.H); return list.map((s) => s.name); });
  await probe.close();

  let seed = 1;
  for (const name of scenarioNames(names)) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${ORIGIN}/index.html`);
    const hashes = await page.evaluate(async ({ name, seed }) => {
      const scenario = window.__scenarios(window.H).find((s) => s.name === name);
      return window.__run(scenario, seed);
    }, { name, seed });
    if (errors.length) throw new Error(`${name}: page errors: ${errors.join("; ")}`);
    hashes.forEach((h, i) => console.log(`${name} ${i} ${h}`));
    // Optional visual check: RENDER_PNG_DIR=dir saves the last frame of each scenario.
    if (process.env.RENDER_PNG_DIR) {
      mkdirSync(process.env.RENDER_PNG_DIR, { recursive: true });
      await page.locator("#c").screenshot({ path: join(process.env.RENDER_PNG_DIR, `${name}.png`) });
    }
    await page.close();
    seed += 7;
  }
  await browser.close();
}

main().catch((error) => {
  console.error("RENDER PIXEL HARNESS FAILED", error);
  process.exit(1);
});
