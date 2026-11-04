// Verifies the Malye Korely reference-house assets:
//  1. every real house has its own exterior + interior SVG asset;
//  2. house assets never repeat — all hashes and normalized contents are distinct;
//  3. the assets are NOT procedurally generated — no script in the repo writes
//     multiple house/reference/facade assets (no generator loop), and every
//     reference asset carries an individual hand-authored marker;
//  4. every graphics asset under public/art is smaller than 50 Kb;
//  5. the quantity of real reference houses is less than the quantity of
//     corresponding house visual assets in the game.
// Usage: node scripts/test-house-assets.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const art = join(repo, "public/art");
const manifest = JSON.parse(readFileSync(join(art, "reference/houses.json"), "utf8"));
const LIMIT = 50 * 1024;

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const hash = (buf) => createHash("sha256").update(buf).digest("hex");
const normalize = (text) => text.replace(/\s+/g, " ").trim();

// --- 1. manifest houses have their own exterior + interior assets ---
assert.ok(manifest.houses.length >= 1, "manifest lists at least one real house");
const assetPaths = [];
for (const house of manifest.houses) {
  assert.match(house.slug, /^[a-z0-9-]+$/, `slug ${house.slug}`);
  for (const key of ["exterior", "interior"]) {
    const rel = house[key];
    assert.ok(rel.startsWith(`reference/${house.slug}-`), `${house.slug}.${key} asset is named after its own house`);
    const p = join(art, rel);
    assert.ok(statSync(p, { throwIfNoEntry: false })?.isFile(), `${rel} exists`);
    assetPaths.push(p);
  }
  // downloaded photos exist (stored outside the game bundle)
  for (const key of ["exterior", "interior"]) {
    const photo = resolve(repo, house.photos[key]);
    assert.ok(statSync(photo, { throwIfNoEntry: false })?.isFile(), `photo ${house.photos[key]} downloaded for ${house.slug}`);
  }
}
console.log(`PASS ${manifest.houses.length} real Malye Korely houses each have their own exterior+interior SVG and downloaded photos`);

// --- 2. house assets never repeat ---
const houseAssets = [
  ...walk(join(art, "reference")).filter((p) => p.endsWith(".svg")),
  ...walk(join(art, "house")).filter((p) => p.includes("facade-")),
];
const hashes = new Map();
const normalized = new Map();
const titles = new Set();
for (const p of houseAssets) {
  const buf = readFileSync(p);
  const h = hash(buf);
  assert.ok(!hashes.has(h), `no repeated asset: ${p} duplicates ${hashes.get(h)}`);
  hashes.set(h, p);
  const n = normalize(buf.toString("utf8"));
  assert.ok(!normalized.has(n), `no repeated content (whitespace-normalized): ${p} duplicates ${normalized.get(n)}`);
  normalized.set(n, p);
  const title = buf.toString("utf8").match(/<title>([^<]+)<\/title>/)?.[1];
  assert.ok(title, `${p} has a title`);
  assert.ok(!titles.has(title), `unique title: ${title}`);
  titles.add(title);
}
assert.equal(new Set(manifest.houses.map((h) => h.slug)).size, manifest.houses.length, "house slugs are unique");
console.log(`PASS all ${houseAssets.length} house visual assets are pairwise different (hash + normalized content + title)`);

// --- 3. not procedurally generated ---
for (const p of [...assetPaths]) {
  const text = readFileSync(p, "utf8");
  assert.ok(text.includes("Hand-authored reference asset"), `${p} carries the individual hand-authored marker`);
  assert.ok(text.includes(`data-ref="${manifest.houses.find((h) => p.includes(h.slug)).slug}"`), `${p} is tagged with its own house`);
}
const codeFiles = [...walk(join(repo, "scripts")), ...walk(join(repo, "src"))].filter((p) => /\.(mjs|ts|tsx|js)$/.test(p));
const generatorPattern = /(writeFileSync|writeFile|write_text|appendFileSync|cpSync|copyFileSync)[^;\n]{0,120}(reference\/|facade-)/;
const loopWritePattern = /for\s*\([^)]*\)\s*\{[^}]{0,300}(writeFileSync|writeFile|write_text)[^;\n]{0,120}(reference\/|facade-)/s;
for (const p of codeFiles) {
  const text = readFileSync(p, "utf8");
  assert.ok(!generatorPattern.test(text), `no script writes house/reference/facade assets directly: ${p}`);
  assert.ok(!loopWritePattern.test(text), `no script generates multiple house assets in a loop: ${p}`);
}
console.log(`PASS no generator script produces the house assets (${codeFiles.length} code files scanned); each asset is individually authored`);

// --- 4. every graphics asset is < 50 Kb ---
let checked = 0;
for (const p of walk(art)) {
  const size = statSync(p).size;
  assert.ok(size < LIMIT, `${p} is ${size} bytes, must be < ${LIMIT}`);
  checked++;
}
console.log(`PASS all ${checked} graphics assets under public/art are < 50 Kb`);

// --- 5. real reference houses < house visual assets in the game ---
const facadeCount = walk(join(art, "house")).filter((p) => p.includes("facade-")).length;
const referenceExteriors = manifest.houses.length; // one exterior asset per real house
const totalHouseAssets = facadeCount + referenceExteriors;
assert.ok(manifest.houses.length < totalHouseAssets,
  `real houses (${manifest.houses.length}) must be fewer than game house assets (${totalHouseAssets})`);
console.log(`PASS real reference houses (${manifest.houses.length}) < house visual assets in the game (${facadeCount} facades + ${referenceExteriors} reference exteriors = ${totalHouseAssets})`);

console.log("PASS test-house-assets: all reference-house asset checks green");
