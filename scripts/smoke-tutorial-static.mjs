// Smoke for the offline singleplayer tutorial (static-src/tutorial.ts → public/play/tutorial.html).
// It must work with no game server: the page may not call /api or any host but its own
// (fonts aside). Usage:
//   node scripts/smoke-tutorial-static.mjs http://127.0.0.1:8090   (a static server over public/play)
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:8090").replace(/\/$/, "");
const origin = new URL(base).host;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const requests = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("request", (r) => requests.push(new URL(r.url())));

const position = async () => Number(await page.locator("#position").innerText());
const chapterTitle = async () => (await page.locator("#chapTitle").textContent()).trim();

try {
  await page.goto(`${base}/tutorial.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("chapTitle")?.textContent?.length);
  assert.equal(await chapterTitle(), "Chapter I: The Autumn Lane");
  console.log("PASS tutorial opens on chapter I");

  // Walking changes the position (the step loop runs on the page).
  const start = await position();
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(1200);
  await page.keyboard.up("KeyD");
  const moved = await position();
  assert.ok(moved > start + 20, `walking right should move the player (${start} -> ${moved})`);
  console.log(`PASS walking moves the player (${start} -> ${moved})`);

  // Walking past 220 units from the start unlocks chapter II.
  await page.keyboard.down("KeyD");
  await page.waitForFunction(() => document.getElementById("chapTitle")?.textContent?.startsWith("Chapter II"), null, { timeout: 15000 });
  await page.keyboard.up("KeyD");
  console.log("PASS walking past the first landmark advances to chapter II");

  // The practice workbench opens and closes.
  await page.locator("#practiceBtn").click();
  assert.equal(await page.locator("#practice").isVisible(), true);
  assert.ok((await page.locator("#practiceTitle").innerText()).length > 0);
  await page.locator("#practiceClose").click();
  assert.equal(await page.locator("#practice").isVisible(), false);
  console.log("PASS practice workbench opens and closes");

  // No React or Next in the page, and no server traffic.
  assert.equal(await page.evaluate(() => Boolean(document.getElementById("__next") || window.__NEXT_DATA__)), false);
  const serverCalls = requests.filter((u) => u.pathname.startsWith("/api") || (u.host !== origin && !/fonts\.(googleapis|gstatic)\.com$/.test(u.host)));
  assert.deepEqual(serverCalls.map((u) => u.href), [], "the tutorial must make no server or cross-origin calls");
  console.log(`PASS no server calls (${requests.length} requests, all same-origin or fonts)`);

  assert.deepEqual(errors, [], `no runtime errors: ${errors.join(" | ")}`);
  console.log("PASS no browser runtime errors");
  console.log("\nSTATIC TUTORIAL CHECKS PASSED");
} finally {
  await browser.close();
}
