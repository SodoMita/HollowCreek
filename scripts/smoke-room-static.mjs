// Smoke for the room on the standalone client (public/play/?room=CODE) against a
// live town server. The React room is gone; /room/CODE must redirect here, and the
// creek-strip minimap must draw from the server snapshot. Usage (server on 3100):
//   node scripts/smoke-room-static.mjs http://127.0.0.1:3100
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const origin = new URL(base).host;
const pids = Array.from({ length: 4 }, () => randomUUID());
const names = ["Ada", "Bram", "Cora", "Dov"];

async function api(path, body) {
  const res = await fetch(base + path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function state(code, pid) {
  const { data } = await api(`/api/game/state?code=${code}&playerId=${pid}`);
  return data;
}

// 1. The old route redirects into the standalone client (not a 404, not React).
{
  const res = await fetch(`${base}/room/abcd`, { redirect: "manual" });
  assert.ok(res.status >= 300 && res.status < 400, `/room/CODE should redirect, got ${res.status}`);
  const loc = res.headers.get("location") ?? "";
  assert.ok(loc.toUpperCase().endsWith("/PLAY/?ROOM=ABCD"), `redirect target: ${loc}`);
  console.log(`PASS /room/CODE redirects to the standalone client (${res.status} → ${loc.replace(base, "")})`);
}

// 2. Town of four, started by the host (the last joiner) through the API.
const created = await api("/api/game/create", { playerId: pids[0], name: names[0] });
assert.ok(created.data.code, `create: ${JSON.stringify(created.data)}`);
const code = created.data.code;
for (let i = 1; i < 4; i++) {
  const j = await api("/api/game/join", { code, playerId: pids[i], name: names[i] });
  assert.ok(j.data.ok, `join ${names[i]}: ${JSON.stringify(j.data)}`);
}
// The lantern (host) passes to the last joiner, so that soul begins the tale.
const started = await api("/api/game/input", { code, playerId: pids[3], action: "start" });
assert.ok(started.data.ok !== false, `start: ${JSON.stringify(started.data)}`);
let snap = null;
for (let i = 0; i < 50; i++) {
  snap = await state(code, pids[0]);
  if (snap.phase === "playing") break;
  await new Promise((r) => setTimeout(r, 200));
}
assert.equal(snap?.phase, "playing", "the town should reach the playing phase");
console.log(`PASS town ${code} started (${snap.tasks.length} wards, ${snap.cages.length} cages)`);

// 2b. The landing page (React) hands both create and join to the standalone room.
{
  const landing = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const lp = await landing.newPage({ viewport: { width: 1280, height: 720 } });
  const lpErrors = [];
  lp.on("pageerror", (e) => lpErrors.push(String(e)));
  try {
    await lp.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await lp.getByRole("button", { name: /Found a new town/ }).click();
    await lp.waitForURL((u) => /\/play\/(index\.html)?$/.test(u.pathname) && u.searchParams.has("room"), { timeout: 15000 });
    console.log(`PASS landing "Found a new town" opens the standalone room (${new URL(lp.url()).searchParams.get("room")})`);

    const lobbyPid = randomUUID();
    const lobby = await api("/api/game/create", { playerId: lobbyPid, name: "Eli" });
    await lp.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await lp.getByLabel("Town code").fill(lobby.data.code);
    // The code box's Join comes first; the room list has its own Join buttons.
    await lp.getByRole("button", { name: "Join", exact: true }).first().click();
    await lp.waitForURL((u) => /\/play\/(index\.html)?$/.test(u.pathname) && u.searchParams.get("room") === lobby.data.code, { timeout: 15000 });
    console.log(`PASS landing "Join" with a code opens that town in the standalone room (${lobby.data.code})`);
    await api("/api/game/leave", { code: lobby.data.code, playerId: lobbyPid }).catch(() => {});
    assert.deepEqual(lpErrors, [], `landing runtime errors: ${lpErrors.join(" | ")}`);
  } finally {
    await landing.close();
  }
}

// 3. The standalone room shows the minimap, drawn from the snapshot.
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const offOrigin = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("request", (r) => { const u = new URL(r.url()); if (u.host !== origin && !/fonts\.(googleapis|gstatic)\.com$/.test(u.host)) offOrigin.push(r.url()); });
await page.addInitScript((pid) => {
  if (!localStorage.getItem("hc_pid")) localStorage.setItem("hc_pid", pid);
  if (!localStorage.getItem("hc_name")) localStorage.setItem("hc_name", "Ada");
}, pids[0]);

try {
  await page.goto(`${base}/room/${code}`, { waitUntil: "domcontentloaded" });
  // The standalone rewrites its own URL to /play/index.html?room=CODE&server=… once it joins.
  await page.waitForURL((u) => /\/play\/(index\.html)?$/.test(u.pathname) && u.searchParams.get("room") === code, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById("game")?.style.display === "block", null, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById("minimap")?.classList.contains("hc-on"), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("#minimap .mm-you"), null, { timeout: 15000 });
  console.log("PASS /room/CODE lands in the standalone room with the minimap showing");

  const counts = await page.evaluate(() => ({
    wards: document.querySelectorAll("#minimap .mm-ward").length,
    cages: document.querySelectorAll("#minimap .mm-cage").length,
    souls: document.querySelectorAll("#minimap .mm-soul").length,
    cart: document.querySelectorAll("#minimap .mm-cart").length,
    bell: document.querySelectorAll("#minimap .mm-bell").length,
  }));
  assert.equal(counts.wards, snap.tasks.length, "one minimap mark per ward");
  assert.equal(counts.cages, snap.cages.length, "one minimap mark per cage");
  assert.equal(counts.cart, 1, "one cart mark");
  assert.equal(counts.bell, 1, "one bell mark");
  // Souls on the strip are exactly the others the server lets this viewer see (idle souls, so stable).
  const visibleOthers = snap.players.filter((p) => p.id !== snap.self.id).length;
  assert.equal(counts.souls, visibleOthers, "souls drawn are exactly the visible others");
  console.log(`PASS minimap marks match the snapshot (wards ${counts.wards}, cages ${counts.cages}, visible souls ${counts.souls} of ${snap.players.length - 1} others, cart, bell)`);

  // 4. Raising the spyglass hides the strip; lowering it shows the strip again.
  await page.keyboard.press("KeyZ");
  await page.waitForFunction(() => !document.getElementById("minimap")?.classList.contains("hc-on"), null, { timeout: 5000 });
  assert.equal(await page.locator("#noteoverlay").isVisible(), true, "the spyglass overlay should open");
  await page.keyboard.press("KeyZ");
  await page.waitForFunction(() => document.getElementById("minimap")?.classList.contains("hc-on"), null, { timeout: 5000 });
  console.log("PASS spyglass hides the minimap and lowering it brings it back");

  // 5. The strip is an aria-hidden decoration; a click must never reach it.
  assert.equal(await page.locator("#minimap").getAttribute("aria-hidden"), "true");
  console.log("PASS minimap is decorative (aria-hidden)");

  assert.deepEqual(offOrigin, [], `no cross-origin requests: ${offOrigin.join(" | ")}`);
  console.log("PASS no cross-origin requests");
  assert.deepEqual(errors, [], `no runtime errors: ${errors.join(" | ")}`);
  console.log("PASS no browser runtime errors");
  console.log("\nSTATIC ROOM CHECKS PASSED");
} finally {
  await browser.close();
  await api("/api/game/leave", { code, playerId: pids[0] }).catch(() => {});
}
