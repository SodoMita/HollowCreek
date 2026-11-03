// Browser test for the single-player timepiece and causal repair practice.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on("pageerror", (error) => errors.push(error.message));
const waitX = (x, direction) => page.waitForFunction(([target, dir]) => {
  const n = Number(document.querySelector('[data-testid="tutorial-position"]')?.textContent);
  return dir > 0 ? n >= target : n <= target;
}, [x, direction], { timeout: 15000, polling: 25 });
try {
  await page.goto(`${base}/tutorial`, { waitUntil: "domcontentloaded" });
  await page.locator(".hc-time-root").waitFor({ state: "attached", timeout: 15000 });
  await page.getByRole("button", { name: "8", exact: true }).click();
  await page.getByText("Chapter VIII: A Minute Borrowed").waitFor();
  await page.keyboard.down("d"); await waitX(1220, 1); await page.keyboard.up("d");
  await page.keyboard.press("e");
  await page.getByText("You found the timepiece. Press M to choose a moment.").waitFor();
  await page.keyboard.press("m");
  const dialog = page.getByRole("dialog", { name: "Choose a moment in the past" });
  await dialog.waitFor();
  const slider = dialog.getByRole("slider", { name: "Moment in the past" });
  assert.ok(Number(await slider.getAttribute("max")) >= Number(await slider.getAttribute("min")));
  await dialog.getByRole("button", { name: "Enter the past" }).click();
  await page.getByTestId("past-countdown").waitFor();
  assert.ok((await page.getByTestId("past-countdown").textContent()).includes("past"));
  console.log("PASS single-player timepiece opens a recorded-time slider and countdown");
  await page.keyboard.down("a"); await waitX(920, -1); await page.keyboard.up("a");
  await page.keyboard.press("e");
  await page.getByText(/Took a repair kit/).waitFor();
  await page.keyboard.down("a"); await waitX(700, -1); await page.keyboard.up("a");
  await page.keyboard.press("e");
  await page.getByText(/Delivered kit to Rebuild the well winch/).waitFor();
  await page.keyboard.press("e");
  const panel = page.getByRole("dialog", { name: "Repair ward minigame" });
  await panel.waitFor();
  for (let turn = 0; turn < 90 && await panel.isVisible(); turn++) {
    const text = await panel.locator(".hc-ward-console").innerText();
    const match = text.match(/Bucket\s+(\d+)\/14.*?\((\d+)\/4\)/s);
    assert.ok(match, "well practice exposes position and tension");
    const left = await panel.locator(".band").evaluate((el) => parseFloat(el.style.left));
    const band = Math.round(left * 14 / 100) + 1;
    const position = Number(match[1]), tension = Number(match[2]);
    const move = position < band ? (tension >= 4 ? 1 : 0) : tension > 2 ? 1 : 2;
    await panel.locator(`[data-ward-move="${move}"]`).click();
  }
  await panel.waitFor({ state: "hidden", timeout: 4000 });
  await page.getByTestId("past-countdown").getByRole("button", { name: "Return now" }).click();
  await page.getByTestId("past-countdown").waitFor({ state: "hidden" });
  const status = await page.getByText("Repaired Wards:").locator("..").innerText();
  assert.match(status, /1\s*\/\s*13/);
  assert.equal(await page.getByRole("button", { name: /Timepiece · M/ }).count(), 0);
  console.log("PASS past repair carries forward and the timepiece is consumed");
  assert.deepEqual(errors, []);
  console.log("PASS no tutorial timepiece runtime errors");
} finally { await browser.close(); }
