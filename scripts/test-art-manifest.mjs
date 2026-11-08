// Checks that the SVG preload list (STATIC_ART in src/game/svg-assets.ts) matches the art the game draws:
//  1. every listed file exists under public/art and is listed once;
//  2. every literal drawSvg("...") path in src is listed;
//  3. every structure and house facade file is listed (those paths are built at runtime);
//  4. room layouts (rooms/<house>.svg) match the houses in buildings.ts, and every object they place
//     resolves to a furniture file with a unique id and a valid data-when.
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

// 4. room layouts
const layoutBlock = /export const ROOM_LAYOUTS[^=]*=\s*\[([^\]]*)\]/.exec(assets);
assert.ok(layoutBlock, "ROOM_LAYOUTS list found in svg-assets.ts");
const layouts = [...layoutBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const buildings = readFileSync(join(src, "game/buildings.ts"), "utf8");
const houses = [...buildings.matchAll(/\{ id: "([a-z-]+)", name:/g)].map((m) => m[1]);
assert.deepEqual([...layouts].sort(), [...houses].sort(), "ROOM_LAYOUTS lists every house in buildings.ts");
assert.ok(!statSync(join(art, "rooms.json"), { throwIfNoEntry: false }), "rooms.json is replaced by rooms/<house>.svg");

const attribute = (tag, name) => {
  const start = tag.indexOf(` ${name}="`);
  if (start < 0) return undefined;
  const from = start + name.length + 3;
  return tag.slice(from, tag.indexOf('"', from));
};
let objects = 0;
for (const house of layouts) {
  const rel = `rooms/${house}.svg`;
  const text = readFileSync(join(art, rel), "utf8");
  const ids = new Set();
  const body = text.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of body.matchAll(/<image\b[^>]*>/g)) {
    objects++;
    const tag = m[0];
    const id = attribute(tag, "id");
    const href = attribute(tag, "href");
    const when = attribute(tag, "data-when");
    assert.ok(id && !ids.has(id), `${rel}: object id "${id}" is present and unique`);
    ids.add(id);
    const asset = (href ?? "").replace(/^(\.\.\/)+/, "");
    assert.match(asset, /^furniture\/[a-z0-9][a-z0-9_-]*\.svg$/i, `${rel}: ${id} links a furniture file`);
    assert.ok(statSync(join(art, asset), { throwIfNoEntry: false })?.isFile(), `${rel}: ${id} -> ${asset} exists`);
    assert.ok(when === undefined || when === "done" || when === "unfinished", `${rel}: ${id} has a valid data-when`);
  }
}

console.log(`PASS ${layouts.length} room layouts match the ${houses.length} houses and place ${objects} objects`);
console.log(`PASS ${listed.length} preloaded SVGs exist, are unique, cover ${literal} literal draws and ${runtime.length} runtime-built structure and facade files`);
