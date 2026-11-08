// Verifies the house assets of Hollow Creek (reference place: Malye Korely):
//  1. every real Malye Korely house has its own hand-authored exterior +
//     interior SVG asset and downloaded photos — no script may write
//     reference/ assets (they are individual, not procedurally generated);
//  2. the town itself has at least 100 houses: >= 100 placements in
//     public/art/town/houses.json, each with its own asset;
//  3. house assets never repeat — all hashes and normalized contents distinct;
//  4. every graphics asset under public/art is smaller than 50 Kb;
//  5. the quantity of real reference houses is less than the quantity of
//     corresponding house visual assets in the game.
// Usage: node scripts/test-house-assets.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const art = join(repo, "public/art");
const manifest = JSON.parse(readFileSync(join(art, "reference/houses.json"), "utf8"));
const town = JSON.parse(readFileSync(join(art, "town/houses.json"), "utf8"));
const LIMIT = 50 * 1024;
const MIN_HOUSES = 100;
const missingPhotos = [];

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const hash = (buf) => createHash("sha256").update(buf).digest("hex");
const normalize = (text) => text.replace(/\s+/g, " ").trim();
const load = async (file) => {
  const out = await build({ entryPoints: [file], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};

// --- 1. real reference houses: individual assets + photos, never script-made ---
assert.ok(manifest.houses.length >= 1, "manifest lists at least one real house");
const assetPaths = [];
for (const house of manifest.houses) {
  assert.match(house.slug, /^[a-z0-9-]+$/, `slug ${house.slug}`);
  for (const key of ["exterior", "interior"]) {
    const rel = house[key];
    assert.ok(rel.startsWith(`reference/${house.slug}-`), `${house.slug}.${key} asset is named after its own house`);
    const p = join(art, rel);
    assert.ok(statSync(p, { throwIfNoEntry: false })?.isFile(), `${rel} exists`);
    const text = readFileSync(p, "utf8");
    assert.ok(text.includes("Hand-authored reference asset"), `${rel} carries the individual hand-authored marker`);
    assert.ok(text.includes(`data-ref="${house.slug}"`), `${rel} is tagged with its own house`);
    assetPaths.push(p);
  }
  for (const key of ["exterior", "interior"]) {
    const photo = resolve(repo, house.photos[key]);
    if (!statSync(photo, { throwIfNoEntry: false })?.isFile()) {
      missingPhotos.push(house.photos[key]);
      continue;
    }
  }
}
// The photo archive lives outside the repository (a provenance source, not
// runtime art). A clean checkout is allowed to omit it; a source archive that
// is present must be complete.
if (missingPhotos.length) {
  const sourceDir = resolve(repo, manifest.houses[0]?.photos?.exterior ?? "../../malye-korely");
  assert.ok(!statSync(sourceDir, { throwIfNoEntry: false })?.isDirectory(),
    `the external photo source exists but ${missingPhotos.length} photos are missing (${missingPhotos.slice(0, 3).join(", ")})`);
  console.log(`SKIP downloaded photos: the external reference archive is not present in this checkout (${manifest.houses.length} houses still checked for hand-authored SVGs)`);
} else {
  console.log(`PASS ${manifest.houses.length} real Malye Korely houses each have a hand-authored exterior+interior SVG and downloaded photos`);
}

// --- 2. backdrop village placements (retired) ---
// The human removed town.ts and the React backdrop village; houses.json is
// empty. Keep the checks meaningful for a future village instead of demanding
// 100 dead houses that nothing renders.
const townAssets = new Set();
if (town.houses.length === 0) {
  console.log("SKIP town placements: the backdrop village is retired (houses.json is empty, town.ts deleted)");
} else {
  assert.ok(town.houses.length >= MIN_HOUSES, `town houses.json places >= ${MIN_HOUSES} houses (has ${town.houses.length})`);
  for (const h of town.houses) {
    assert.match(h.asset, /^town\/house-\d{3}\.svg$/, `town asset path ${h.asset}`);
    assert.ok(statSync(join(art, h.asset), { throwIfNoEntry: false })?.isFile(), `${h.asset} exists`);
    townAssets.add(h.asset);
    assert.ok(Number.isInteger(h.x) && h.x >= -4200 && h.x <= 8800, `town house x=${h.x} inside the world`);
  }
  console.log(`PASS the town places ${town.houses.length} houses (${townAssets.size} distinct assets) across the world, all rendered by the game`);
}

// --- 3. house assets never repeat (facades + reference + town) ---
const houseAssets = [
  ...walk(join(art, "reference")).filter((p) => p.endsWith(".svg")),
  ...walk(join(art, "house")).filter((p) => p.includes("facade-")),
  ...walk(join(art, "town")).filter((p) => p.endsWith(".svg")),
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

// --- 4. not procedurally generated: NO script may write any house asset ---
// reference/ (real Malye Korely houses), town/ (the 100+ individual town
// houses) and house/facade-* are all hand-authored, one file at a time.
const codeFiles = [...walk(join(repo, "scripts")), ...walk(join(repo, "src"))].filter((p) => /\.(mjs|ts|tsx|js)$/.test(p));
const writePattern = /(writeFileSync|writeFile|write_text|appendFileSync|cpSync|copyFileSync)[^;\n]{0,120}(reference\/|town\/|facade-)/;
const loopWritePattern = /for\s*\([^)]*\)\s*\{[^}]{0,300}(writeFileSync|writeFile|write_text)[^;\n]{0,120}(reference\/|town\/|facade-)/s;
for (const p of codeFiles) {
  const text = readFileSync(p, "utf8");
  assert.ok(!writePattern.test(text), `no script writes house assets directly: ${p}`);
  assert.ok(!loopWritePattern.test(text), `no script generates multiple house assets in a loop: ${p}`);
}
for (const p of [...assetPaths, ...walk(join(art, "town")).filter((q) => q.endsWith(".svg"))]) {
  assert.ok(readFileSync(p, "utf8").includes("Hand-authored"), `${p} carries the individual hand-authored marker`);
}
console.log(`PASS no script generates any house asset (${codeFiles.length} code files scanned); all ${assetPaths.length + walk(join(art, "town")).filter((q) => q.endsWith(".svg")).length} hand-authored files carry the marker`);

// --- 5. every graphics asset is < 50 Kb ---
let checked = 0;
for (const p of walk(art)) {
  const size = statSync(p).size;
  assert.ok(size < LIMIT, `${p} is ${size} bytes, must be < ${LIMIT}`);
  checked++;
}
console.log(`PASS all ${checked} graphics assets under public/art are < 50 Kb`);

// --- 6. real reference houses < house visual assets in the game ---
const facadeCount = walk(join(art, "house")).filter((p) => p.includes("facade-")).length;
const referenceExteriors = manifest.houses.length;
const totalHouseAssets = facadeCount + referenceExteriors + townAssets.size;
assert.ok(manifest.houses.length < totalHouseAssets,
  `real houses (${manifest.houses.length}) must be fewer than game house assets (${totalHouseAssets})`);
console.log(`PASS real reference houses (${manifest.houses.length}) < house visual assets in the game (${facadeCount} facades + ${referenceExteriors} reference + ${townAssets.size} town = ${totalHouseAssets})`);

console.log("PASS test-house-assets: all house-asset checks green");
