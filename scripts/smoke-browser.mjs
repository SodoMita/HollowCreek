// Browser smoke test for the actual tutorial, including continuous house entry.
// Usage: node scripts/smoke-browser.mjs [baseUrl]
import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const position = async () => Number(await page.getByTestId("tutorial-position").textContent());
const waitX = (x, direction) => page.waitForFunction(([value, dir]) => {
  const el = document.querySelector('[data-testid="tutorial-position"]');
  const current = Number(el?.textContent);
  return dir < 0 ? current <= value : current >= value;
}, [x, direction], { timeout: 12000, polling: 25 });
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  assert.ok(await page.getByText("Hollow", { exact: false }).count());
  await page.getByText("Walk Alone · Singleplayer Tutorial").click();
  await page.getByTestId("tutorial-position").waitFor();
  const start = await position();
  await page.keyboard.down("a");
  await page.waitForTimeout(1200);
  await page.keyboard.up("a");
  const travelled = start - await position();
  assert.ok(travelled > 160 && travelled < 300, `single-player speed was ${travelled} units in 1.2 seconds`);
  console.log(`PASS single-player movement covers ${travelled} units in 1.2 seconds`);
  await page.keyboard.down("a"); await waitX(-175, -1); await page.keyboard.up("a");
  await page.keyboard.press("e");
  await page.getByText("You found the brass tollhouse key.").waitFor({ timeout: 3000 });
  console.log("PASS tutorial picks up the distinct tollhouse key");
  await page.keyboard.down("a"); await waitX(-300, -1); await page.keyboard.up("a");
  await page.keyboard.press("e");
  await page.getByText("Tollhouse opens. Walk through the doorway.").waitFor({ timeout: 3000 });
  await page.keyboard.press("e");
  await page.getByText("Tollhouse door closes, but stays unlocked.").waitFor({ timeout: 3000 });
  await page.keyboard.press("e");
  await page.getByText("Tollhouse door opens.").waitFor({ timeout: 3000 });
  console.log("PASS a closed, unlocked door can be reopened");
  const before = await position();
  await page.keyboard.down("a"); await waitX(-370, -1); await page.keyboard.up("a");
  assert.equal(await page.getByTestId("tutorial-location").textContent(), "Tollhouse");
  assert.ok(before - await position() < 110, "entering must not teleport");
  console.log("PASS walk into the house without a position jump");
  await page.keyboard.down("a"); await waitX(-475, -1); await page.keyboard.up("a");
  await page.keyboard.press("e");
  const panel = page.getByRole("dialog", { name: "Repair ward minigame" });
  await panel.waitFor({ timeout: 3000 });
  assert.ok(await panel.getByText("The Cold Hearth").count());
  for (let i = 0; i < 3; i++) {
    const vent = panel.locator(`[data-ward-move="${i}"]`);
    for (let attempt = 0; attempt < 4; attempt++) {
      const label = await vent.getAttribute("aria-label");
      const match = label.match(/: (\d), target (\d)/);
      assert.ok(match, "vent exposes current and target positions");
      if (match[1] === match[2]) break;
      await vent.click();
    }
  }
  await panel.getByRole("button", { name: "Light the hearth" }).click();
  await panel.waitFor({ state: "hidden", timeout: 3000 });
  console.log("PASS furnished house contains a playable repair task");
  await page.keyboard.down("d"); await waitX(-300, 1); await page.keyboard.up("d");
  assert.equal(await page.getByTestId("tutorial-location").textContent(), "The road");
  console.log("PASS walk back outside without a scene change");
  await page.getByRole("button", { name: /Practice Any Ward/ }).click();
  const stopped = await position();
  await page.keyboard.down("a"); await page.waitForTimeout(350); await page.keyboard.up("a");
  assert.equal(await position(), stopped, "practice dialog releases movement");
  await page.getByRole("button", { name: "The Stopped Clock" }).click();
  const practice = page.locator(".hc-ward-console").filter({ hasText: "The note says" });
  const readClock = async () => {
    const match = (await practice.innerText()).match(/note says (\d+:\d{2}).*reads (\d+:\d{2})/s);
    assert.ok(match, "clock practice shows its target and current time");
    return [match[1], match[2]];
  };
  for (let i = 0; i < 12; i++) {
    const [target, current] = await readClock();
    if (target.split(":")[0] === current.split(":")[0]) break;
    await page.getByRole("button", { name: "Move hour hand forward" }).click();
  }
  for (let i = 0; i < 4; i++) {
    const [target, current] = await readClock();
    if (target.split(":")[1] === current.split(":")[1]) break;
    await page.getByRole("button", { name: "Move minute hand forward" }).click();
  }
  await page.getByRole("button", { name: "Wind the clock" }).click();
  assert.ok(await page.getByText("Ward Solved Successfully!").count());
  await page.getByRole("button", { name: /Close/ }).click();
  console.log("PASS house puzzles are playable in the practice workbench");
  const colors = await page.locator("canvas").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const unique = new Set();
    for (let i = 0; i < pixels.length; i += Math.max(4, Math.floor(pixels.length / 2500 / 4) * 4)) unique.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return unique.size;
  });
  assert.ok(colors > 20, `canvas should be painted, got ${colors} colors`);
  console.log(`PASS canvas renders the street (${colors} sampled colors)`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/play/tutorial.html`, { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  console.log("PASS mobile tutorial has no horizontal overflow");
  await page.goto(`${base}/play`, { waitUntil: "domcontentloaded" });
  assert.ok(await page.getByText("Enter the town").count());
  console.log("PASS standalone client opens");
  assert.deepEqual(errors, []);
  console.log("PASS no browser runtime errors");
} finally {
  await browser.close();
}
