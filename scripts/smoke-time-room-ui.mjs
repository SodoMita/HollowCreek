// Browser integration for the React and standalone multiplayer timepiece controls.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = async (path, body) => {
  const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
};
async function setup(prefix) {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const code = (await post("/api/game/create", { playerId: ids[0], name: `${prefix}A` })).code;
  for (let i = 1; i < ids.length; i++) assert.ok((await post("/api/game/join", { code, playerId: ids[i], name: `${prefix}${i}` })).ok);
  const send = (id, intent) => post("/api/game/input", { code, playerId: id, ...intent });
  const state = async (id) => (await fetch(`${base}/api/game/state?code=${code}&playerId=${id}`)).json();
  assert.ok((await send(ids[3], { action: "start" })).ok);
  const states = await Promise.all(ids.map((id) => state(id)));
  const index = ids.map((id, i) => ({ i, distance: Math.abs(states[i].players.find((p) => p.id === id).x - 1260) })).sort((a, b) => a.distance - b.distance)[0].i;
  const id = ids[index], name = index === 0 ? `${prefix}A` : `${prefix}${index}`;
  for (let attempt = 0; attempt < 250; attempt++) {
    const s = await state(id), x = s.players.find((p) => p.id === id).x;
    if (Math.abs(x - 1260) < 20) { await send(id, { dir: 0 }); break; }
    await send(id, { dir: x < 1260 ? 1 : -1 }); await sleep(110);
  }
  assert.ok((await send(id, { action: "interact" })).ok);
  assert.ok((await state(id)).self.hasTimepiece);
  await sleep(1200); // leave more than one recorded moment for the slider
  return { ids, id, name, code, state, send };
}
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const rooms = [];
try {
  const react = await setup("TimeUI"); rooms.push(react);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ id, name }) => { localStorage.setItem("hc_pid", id); localStorage.setItem("hc_name", name); }, { id: react.id, name: react.name });
  await page.goto(`${base}/room/${react.code}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Timepiece · M" }).waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Timepiece · M" }).click();
  const modal = page.getByRole("dialog", { name: "Choose a moment in the past" });
  await modal.waitFor();
  await modal.getByRole("button", { name: "Keep the timepiece" }).click();
  assert.equal((await react.state(react.id)).self.hasTimepiece, true, "canceling does not consume the item");
  await page.getByRole("button", { name: "Timepiece · M" }).click();
  await modal.waitFor();
  const slider = modal.getByRole("slider", { name: "Moment in the past" });
  const min = Number(await slider.getAttribute("min")), max = Number(await slider.getAttribute("max")), step = Number(await slider.getAttribute("step"));
  assert.ok(max > min, "the slider offers more than one recorded moment");
  const earliest = (await react.state(react.id)).time.earliest;
  await slider.fill(String(min + Math.floor((max - min) / (2 * step)) * step));
  const selected = earliest + Number(await slider.inputValue());
  await modal.getByRole("button", { name: "Enter the past" }).click();
  await page.getByTestId("past-countdown").waitFor({ timeout: 8000 });
  const past = await react.state(react.id);
  assert.equal(past.time.mode, "past");
  assert.ok(Math.abs(past.time.cursor - selected) < 1800, "the selected point controls the past cursor");
  await page.getByTestId("past-countdown").getByRole("button", { name: "Return now" }).click();
  await page.getByTestId("past-countdown").waitFor({ state: "hidden", timeout: 8000 });
  assert.equal((await react.state(react.id)).time.mode, "present");
  assert.deepEqual(errors, []);
  console.log("PASS React multiplayer slider, countdown and return");
  await page.close();

  const staticRoom = await setup("TimeST"); rooms.push(staticRoom);
  const standalone = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const staticErrors = []; standalone.on("pageerror", (error) => staticErrors.push(error.message));
  await standalone.addInitScript(({ id, name }) => { localStorage.setItem("hc_pid", id); localStorage.setItem("hc_name", name); }, { id: staticRoom.id, name: staticRoom.name });
  await standalone.goto(`${base}/play/index.html?room=${staticRoom.code}&server=${encodeURIComponent(base)}`, { waitUntil: "domcontentloaded" });
  await standalone.locator("#timebtn").waitFor({ state: "visible", timeout: 12000 });
  await standalone.locator("#timebtn").click();
  const staticModal = standalone.getByRole("dialog", { name: "Choose a moment in the past" });
  await staticModal.waitFor();
  await staticModal.getByRole("button", { name: "Enter the past" }).click();
  await standalone.locator("#status").getByText(/In the past/).waitFor({ timeout: 8000 });
  assert.equal((await staticRoom.state(staticRoom.id)).time.mode, "past");
  await standalone.locator("#timebtn").click();
  await standalone.locator("#status").waitFor({ state: "hidden", timeout: 8000 });
  assert.equal((await staticRoom.state(staticRoom.id)).time.mode, "present");
  assert.deepEqual(staticErrors, []);
  console.log("PASS standalone multiplayer slider, countdown and return");
  await standalone.close();

  const mobileRoom = await setup("TimeMB"); rooms.push(mobileRoom);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript(({ id, name }) => { localStorage.setItem("hc_pid", id); localStorage.setItem("hc_name", name); }, { id: mobileRoom.id, name: mobileRoom.name });
  await mobile.goto(`${base}/room/${mobileRoom.code}`, { waitUntil: "domcontentloaded" });
  await mobile.getByRole("button", { name: "Timepiece · M" }).waitFor({ timeout: 12000 });
  await mobile.getByRole("button", { name: "Timepiece · M" }).click();
  const mobileModal = mobile.getByRole("dialog", { name: "Choose a moment in the past" });
  await mobileModal.waitFor();
  const bounds = await mobileModal.locator(".hc-time-panel").boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, "mobile time slider fits the viewport");
  await mobileModal.getByRole("button", { name: "Enter the past" }).click();
  await mobile.getByTestId("past-countdown").waitFor({ timeout: 8000 });
  await mobile.getByTestId("past-countdown").getByRole("button", { name: "Return now" }).click();
  await mobile.getByTestId("past-countdown").waitFor({ state: "hidden", timeout: 8000 });
  console.log("PASS mobile time slider and return controls fit the viewport");
  await mobile.close();
} finally {
  await browser.close();
  for (const room of rooms) await Promise.all(room.ids.map((id) => post("/api/game/leave", { code: room.code, playerId: id }).catch(() => {})));
}
