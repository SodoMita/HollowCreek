// Renders an SVG asset and computes MSE against a reference image (e.g. a
// diffusion concept from generate_image), both normalized to 256x256 RGB.
// Usage: node scripts/.mse.mjs <svg> <ref-image> [label]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const [, , svgPath, refPath, label = ""] = process.argv;
const svg = readFileSync(svgPath, "utf8");
const refB64 = readFileSync(refPath).toString("base64");
const refMime = refPath.endsWith(".png") ? "image/png" : "image/jpeg";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
const mse = await page.evaluate(async ([svgText, refData, refMime, label]) => {
  const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  const renderSvg = await new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
  });
  const ref = await load(`data:${refMime};base64,${refData}`);
  const N = 64; // low-res structural MSE (downscale blurs texture, keeps layout+color)
  // The SVG fills its viewBox; diffusion concepts have margins — crop the
  // concept to its house region so both are compared on the building itself.
  const cropRef = (im) => {
    const c = document.createElement("canvas");
    c.width = Math.round(im.width * 0.76); c.height = Math.round(im.height * 0.84);
    const x = c.getContext("2d");
    x.drawImage(im, im.width * 0.12, im.height * 0.10, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  };
  const draw = (im) => {
    const c = document.createElement("canvas"); c.width = N; c.height = N;
    const x = c.getContext("2d");
    x.fillStyle = "#171224"; x.fillRect(0, 0, N, N);
    const s = Math.min(N / im.width, N / im.height) * 0.98;
    x.drawImage(im, (N - im.width * s) / 2, (N - im.height * s) / 2, im.width * s, im.height * s);
    return x.getImageData(0, 0, N, N).data;
  };
  const a = draw(renderSvg), b = draw(cropRef(ref));
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += (a[i] - b[i]) ** 2 + (a[i + 1] - b[i + 1]) ** 2 + (a[i + 2] - b[i + 2]) ** 2;
  }
  return sum / (a.length / 4) / 3;
}, [svg, refB64, refMime, label]);
await browser.close();
console.log(`MSE ${label} ${svgPath} vs ${refPath}: ${mse.toFixed(2)}`);
