import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:3101/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1200);
const homeOk = await page.evaluate(() => document.querySelector("h1")?.textContent?.includes("Hollow"));
await page.screenshot({ path: "/home/user/town-shots/smoke-home.png" });
// room page without DB: join will 500 -> error screen should render (exercises GameClient + hud imports)
await page.goto("http://localhost:3101/room/TEST", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);
const roomText = await page.evaluate(() => document.body.innerText.slice(0, 200));
await page.screenshot({ path: "/home/user/town-shots/smoke-room.png" });
// SSE route should answer 404 for unknown town, not hang
await page.goto("http://localhost:3101/api/game/state/stream?code=NOPE&playerId=x", { timeout: 10000 }).catch(() => {});
const sseStatus = await page.evaluate(async () => {
  const r = await fetch("/api/game/state/stream?code=NOPE&playerId=x");
  return r.status;
});
console.log(JSON.stringify({ homeOk, roomText: roomText.replace(/\n/g, " | "), sseStatus, errors: errors.slice(0, 5) }, null, 1));
await browser.close();
