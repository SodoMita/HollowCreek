// Checks that the SVG preload list (STATIC_ART in src/game/svg-assets.ts) matches the art the game draws:
//  1. every listed file exists under public/art and is listed once;
//  2. every literal drawSvg("...") path in src is listed;
//  3. every structure and house facade file is listed (those paths are built at runtime).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const art = join(repo, "public/art");
const src = join(repo, "src");

const assets = readFileSync(join(src, "game/svg-assets.ts"), "utf8");
const block = /export const STATIC_ART[^=]*=\s*\[([\s\S]*?)\];/.exec(assets);
assert.ok(block, "STATIC_ART list found in svg-assets.ts");
const listed = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

// 1. exists on disk, no duplicates
assert.equal(new Set(listed).size, listed.length, "STATIC_ART has no duplicate entries");
for (const path of listed) {
  assert.ok(statSync(join(art, path), { throwIfNoEntry: false })?.isFile(), `${path} exists under public/art`);
}

// Walk src for .ts/.tsx files.
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
const files = walk(src);

// 2. every literal drawSvg path is listed
let literal = 0;
for (const file of files) {
  if (file.endsWith("svg-assets.ts")) continue;
  for (const m of readFileSync(file, "utf8").matchAll(/drawSvg\(\s*\w+,\s*"([^"]+)"/g)) {
    literal++;
    assert.ok(listed.includes(m[1]), `${m[1]} (drawn in ${relative(repo, file)}) is in STATIC_ART`);
  }
}

// 3. runtime-built paths: every structure and house facade file is listed
const onDisk = (dir, pattern) => readdirSync(join(art, dir)).filter((n) => pattern.test(n)).map((n) => `${dir}/${n}`);
const runtime = [...onDisk("structures", /\.svg$/), ...onDisk("house", /^facade-.*\.svg$/)];
for (const path of runtime) assert.ok(listed.includes(path), `${path} is preloaded`);

console.log(`PASS ${listed.length} preloaded SVGs exist, are unique, cover ${literal} literal draws and ${runtime.length} runtime-built structure and facade files`);
