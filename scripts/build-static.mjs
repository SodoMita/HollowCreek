// Builds the standalone static client into public/play/ — served by Next at
// /play, pushed to gh-pages, and zipped for Newgrounds. No React, no server
// rendering: one HTML file + one bundle talking to the authoritative API.
import { build } from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";

mkdirSync("public/play", { recursive: true });
await build({
  entryPoints: ["static-src/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "public/play/game.js",
  logLevel: "info",
});
// Hall of Records, the Chronicle, the tutorial and the offline Repair Bench:
// plain pages that reuse the shared game modules.
for (const page of ["records", "chronicle", "tutorial", "bench"]) {
  await build({
    entryPoints: [`static-src/${page}.ts`],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    outfile: `public/play/${page}.js`,
    logLevel: "info",
  });
  copyFileSync(`static-src/${page}.html`, `public/play/${page}.html`);
}
copyFileSync("static-src/index.html", "public/play/index.html");
if (existsSync("public/art")) cpSync("public/art", "public/play/art", { recursive: true });
// icons: canonical ladder lives in public/ (see release/README.md)
for (const [source, target] of [["public/favicon.ico", "public/play/favicon.ico"], ["public/icon-192.png", "public/play/icon.png"], ["public/icon-512.png", "public/play/icon-512.png"], ["public/icon-1024.png", "public/play/icon-1024.png"]]) {
  if (existsSync(source)) copyFileSync(source, target);
}
console.log("static client → public/play/ (index.html + game.js + icons)");