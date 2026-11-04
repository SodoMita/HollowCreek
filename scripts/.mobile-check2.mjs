import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
const report = {};
for (const path of ["/", "/room/TEST"]) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`http://localhost:3101${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  report[path] = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    bodyText: document.body.innerText.slice(0, 80),
  }));
  report[path].pageErrors = errs;
}
console.log(JSON.stringify(report, null, 1));
await b.close();
