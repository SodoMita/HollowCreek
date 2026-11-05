import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
const out = {};
for (const path of ["/", "/tutorial", "/art", "/stats", "/chronicle/TEST"]) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const res = await page.goto(`http://localhost:3101${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1800);
  out[path] = { status: res?.status(), pageErrors: errs.length, text: (await page.evaluate(() => document.body.innerText.slice(0, 60).replace(/\n/g, " "))) };
  page.removeAllListeners("pageerror");
}
console.log(JSON.stringify(out, null, 1));
await b.close();
