// Builds the standalone static client into public/play/ — served by Next at
// /play, pushed to gh-pages, and zipped for Newgrounds. No React, no server
// rendering: one HTML file + one bundle talking to the authoritative API.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

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
copyFileSync("static-src/index.html", "public/play/index.html");
// one vector mark, no bitmap ladder — smallest thing that scales
copyFileSync("public/icon.svg", "public/play/icon.svg");
console.log("static client → public/play/ (index.html + game.js + icons)");