// Browser regression for editable SVG assets and the two doorway states.
// Usage: node scripts/smoke-art.mjs [baseUrl]
import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const loaded = new Set(), errors = [];
page.on("response", (response) => { if (response.status() === 200 && response.url().includes("/art/")) loaded.add(new URL(response.url()).pathname); });
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem("hc_settings_v1", JSON.stringify({ graphics: { worldZoom: 1, cameraSmoothing: false, reducedMotion: true, particles: false, fog: false, vignette: false, glow: false }, interface: { playerNames: false } }));
});
const position = async () => Number(await page.getByTestId("tutorial-position").textContent());
const waitX = (x) => page.waitForFunction((target) => Number(document.querySelector('[data-testid="tutorial-position"]')?.textContent) <= target, x, { timeout: 12000, polling: 25 });
async function aperturePixels() {
  const x = Math.round(640 + (-338 - await position()));
  return page.locator("canvas").evaluate((canvas, screenX) => {
    const pixels = canvas.getContext("2d").getImageData(screenX - 7, Math.round(800 * 0.78) - 60, 10, 48).data;
    return Array.from(pixels);
  }, x);
}
try {
  await page.goto(`${base}/play/tutorial.html`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("tutorial-position").waitFor();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByText("Chapter VII: The Houses Beyond").waitFor();
  await page.keyboard.down("a"); await waitX(-175); await page.keyboard.up("a"); await page.keyboard.press("e");
  await page.getByText("You found the brass tollhouse key.").waitFor();
  await page.keyboard.down("a"); await waitX(-300); await page.keyboard.up("a"); await page.waitForTimeout(1000);
  const closed = await aperturePixels();
  await page.keyboard.press("e"); await page.getByText("Tollhouse opens. Walk through the doorway.").waitFor(); await page.waitForTimeout(700);
  const open = await aperturePixels();
  let difference = 0, brightness = 0;
  for (let i = 0; i < open.length; i += 4) {
    difference += Math.abs(open[i] - closed[i]) + Math.abs(open[i + 1] - closed[i + 1]) + Math.abs(open[i + 2] - closed[i + 2]);
    brightness += open[i] + open[i + 1] + open[i + 2];
  }
  difference /= open.length / 4 * 3; brightness /= open.length / 4 * 3;
  assert.ok(difference > 3, `open and closed doorway pixels should differ (${difference.toFixed(1)})`);
  assert.ok(brightness > 22, `open doorway should reveal the room, not a black panel (${brightness.toFixed(1)})`);
  console.log(`PASS open doorway reveals the room; its pixels change (${difference.toFixed(1)})`);
  for (const path of ["/art/rooms/tollhouse.svg", "/art/characters/traveler.svg", "/art/scenery/autumn-tree.svg", "/art/house/facade-tollhouse.svg", "/art/house/door-frame.svg", "/art/house/door-closed.svg", "/art/house/door-open.svg", "/art/furniture/hearth.svg"]) {
    assert.ok(loaded.has(path), `${path} was actually loaded`);
  }
  console.log("PASS game loads the editable SVG artwork and room layout");
  const standalone = await page.request.get(`${base}/play/art/house/door-open.svg`);
  assert.equal(standalone.status(), 200);
  assert.ok((await standalone.text()).includes("door-leaf-swung-out"));
  const standaloneLayout = await page.request.get(`${base}/play/art/rooms/tollhouse.svg`);
  assert.equal(standaloneLayout.status(), 200);
  console.log("PASS standalone client has the same SVG files and layout");
  // The standalone lobby already preloads the art, so listen from before the page loads.
  const artResponse = page.waitForResponse((response) => response.url().includes("/play/art/") && response.status() === 200, { timeout: 12000 });
  await page.goto(`${base}/play`, { waitUntil: "domcontentloaded" });
  await page.locator("#name").fill("ArtSmoke");
  await page.locator("#create").click();
  await page.locator("#game").waitFor({ state: "visible", timeout: 12000 });
  await artResponse;
  const testCode = await page.locator("#copycode").textContent();
  await page.evaluate(async (code) => {
    await fetch("/api/game/leave", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, playerId: localStorage.getItem("hc_pid") }) });
  }, testCode);
  console.log("PASS standalone lobby renders using its own relative SVG paths");
  await page.goto(`${base}/play/tutorial.html`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "⚙" }).click();
  await page.getByRole("tab", { name: "Graphics" }).click();
  const slider = page.locator('[data-setting="graphics.worldZoom"]');
  assert.equal(await slider.inputValue(), "100");
  await slider.fill("130");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("hc_settings_v1")).graphics.worldZoom), 1.3);
  console.log("PASS world zoom is adjustable and saved");
  assert.deepEqual(errors, []);
  console.log("PASS no browser runtime errors");
} finally {
  await browser.close();
}
