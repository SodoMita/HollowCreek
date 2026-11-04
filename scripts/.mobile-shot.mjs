import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1800);
await page.screenshot({ path: "/home/user/town-shots/mobile-360x640-fixed.png" });
await browser.close();
console.log("shot saved");
