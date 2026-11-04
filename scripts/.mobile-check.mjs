import { chromium } from "playwright";
const browser = await chromium.launch();
const results = {};
for (const [name, vp] of [["360x640", { width: 360, height: 640 }], ["390x844", { width: 390, height: 844 }], ["short-360x500", { width: 360, height: 500 }]]) {
  const page = await browser.newPage({ viewport: vp, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // horizontal overflow check
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll("*")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
    }).slice(0, 8).map((el) => `${el.tagName}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { scrollW: doc.scrollWidth, innerW: window.innerWidth, wide };
  });
  await page.screenshot({ path: `/home/user/town-shots/mobile-${name}.png`, fullPage: false });
  results[name] = { overflow, errors: errors.slice(0, 3) };
  await page.close();
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
