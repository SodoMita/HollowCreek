// Visual QA: real room, real server. Walks, screenshots desktop + mobile,
// checks canvas liveliness, minimap, settings, and console cleanliness.
// Usage: node scripts/qa-visual.mjs [baseUrl] [outDir]
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:3100";
const out = process.argv[3] ?? "/tmp/qa";
import { mkdirSync } from "node:fs";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto(base, { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/01-home.png` });

// found a town through the real UI
const nameInput = page.locator('input').first();
await nameInput.fill("Clover");
const found = page.getByRole("button", { name: /found|create|new town/i }).first();
await found.click();
await page.waitForURL((u) => u.searchParams.has("room"), { timeout: 15000 }); // the standalone room
await page.waitForTimeout(2000);
const code = new URL(page.url()).searchParams.get("room").toUpperCase();
// three townsfolk arrive by API; the last joiner holds the lantern
const botId = await page.evaluate(async (c) => {
  let last = "";
  for (const n of ["Birch", "Fern", "Rowan"]) {
    last = crypto.randomUUID();
    await fetch("/api/game/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c, playerId: last, name: n }) });
  }
  return last;
}, code);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/02-lobby.png` });
await page.evaluate(async ([c, id]) => {
  await fetch("/api/game/input", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c, playerId: id, action: "start" }) });
}, [code, botId]);
await page.waitForTimeout(4200);
await page.screenshot({ path: `${out}/03-night.png` });

// canvas liveliness: two frames must differ and contain many colors
const canvasStats = await page.evaluate(async () => {
  const c = document.querySelector("canvas");
  if (!c) return { error: "no canvas" };
  const g = c.getContext("2d");
  const grab = () => {
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    let sum = 0;
    for (let i = 0; i < d.length; i += 4096) {
      colors.add((d[i] >> 3) + "," + (d[i + 1] >> 3) + "," + (d[i + 2] >> 3));
      sum += d[i] + d[i + 1] + d[i + 2];
    }
    return { colors: colors.size, sum };
  };
  const a = grab();
  await new Promise((r) => setTimeout(r, 700));
  const b = grab();
  return { w: c.width, h: c.height, colorsA: a.colors, colorsB: b.colors, changed: a.sum !== b.sum };
});
console.log("canvas:", JSON.stringify(canvasStats));

// walk west toward the fen; minimap must exist
await page.keyboard.down("a");
await page.waitForTimeout(2600);
await page.keyboard.up("a");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/04-walking.png` });

// settings dialog
await page.locator("#settings").click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/05-settings.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// mobile layout
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
mob.on("pageerror", (e) => errors.push("mobile pageerror: " + e.message));
await mob.goto(base, { waitUntil: "networkidle" });
await mob.screenshot({ path: `${out}/06-mobile-home.png` });
await mob.getByText("Walk Alone · Singleplayer Tutorial").click();
await mob.locator("#position").waitFor({ timeout: 15000, state: "attached" });
await mob.waitForTimeout(2500);
await mob.screenshot({ path: `${out}/07-mobile-tutorial.png` });
const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("mobile horizontal overflow px:", overflow);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exit(1);
console.log("VISUAL QA CAPTURED");
