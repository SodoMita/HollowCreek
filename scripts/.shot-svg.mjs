// Render one SVG asset to a PNG on the game's dusk backdrop, for visual review.
// Usage: node /home/user/shot-svg.mjs <svg-path> <out-png>
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const [, , svgPath, out] = process.argv;
const svg = readFileSync(svgPath, "utf8");
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
await page.setContent(`<body style="margin:0;background:linear-gradient(#171224,#241a2e 70%,#2b1a12);display:flex;align-items:flex-end;justify-content:center;height:100vh">${svg.replace("<svg ", '<svg style="height:86vh;width:auto" ')}</body>`);
await page.waitForTimeout(500);
await page.screenshot({ path: out });
await browser.close();
console.log("shot:", out);
