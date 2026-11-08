// Browser integration for the multiplayer timepiece and pinned pages on the
// standalone room client (public/play/index.html?room=CODE). The React room is
// gone; /room/CODE redirects to the standalone client, so this drives it directly.
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
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
  // A young match must still offer a valid range, or the timepiece silently does nothing.
  const young = await state(id);
  assert.ok(young.time.latest >= young.time.earliest, "time range is valid right after the start");
  assert.ok((await send(id, { action: "interact" })).ok);
  assert.ok((await state(id)).self.hasTimepiece);
  // The range is floored to five-second steps, so wait until it has real width (latest > earliest).
  // A fixed sleep was flaky: a fast walk left the match under five seconds old and the slider had one moment.
  for (let wait = 0; wait < 60; wait++) {
    const t = (await state(id)).time;
    if (t.latest > t.earliest) break;
    await sleep(250);
  }
  return { ids, id, name, code, state, send };
}

// Opens the standalone room as one soul. The page's own URL is the real entry point.
async function openRoom(browser, room, viewport, mobile = false) {
  const page = await browser.newPage({ viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ id, name }) => { localStorage.setItem("hc_pid", id); localStorage.setItem("hc_name", name); }, { id: room.id, name: room.name });
  await page.goto(`${base}/room/${room.code}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.searchParams.get("room") === room.code, { timeout: 15000 });
  await page.locator("#timebtn").waitFor({ state: "visible", timeout: 15000 });
  return { page, errors };
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const rooms = [];
try {
  // 1. Timepiece: cancel keeps the item, the slider picks a moment, the past shows and returns.
  const timeRoom = await setup("TimeUI"); rooms.push(timeRoom);
  const { page, errors } = await openRoom(browser, timeRoom, { width: 1280, height: 800 });
  await page.locator("#timebtn").click();
  const modal = page.getByRole("dialog", { name: "Choose a moment in the past" });
  await modal.waitFor();
  await modal.getByRole("button", { name: "Keep the timepiece" }).click();
  assert.equal((await timeRoom.state(timeRoom.id)).self.hasTimepiece, true, "canceling does not consume the item");
  await page.locator("#timebtn").click();
  await modal.waitFor();
  const slider = modal.getByRole("slider", { name: "Moment in the past" });
  const min = Number(await slider.getAttribute("min")), max = Number(await slider.getAttribute("max")), step = Number(await slider.getAttribute("step"));
  assert.ok(max > min, "the slider offers more than one recorded moment");
  const earliest = (await timeRoom.state(timeRoom.id)).time.earliest;
  await slider.fill(String(min + Math.floor((max - min) / (2 * step)) * step));
  const selected = earliest + Number(await slider.inputValue());
  await modal.getByRole("button", { name: "Enter the past" }).click();
  await page.locator("#status").getByText(/In the past/).waitFor({ timeout: 8000 });
  const past = await timeRoom.state(timeRoom.id);
  assert.equal(past.time.mode, "past");
  assert.ok(Math.abs(past.time.cursor - selected) < 1800, "the selected point controls the past cursor");
  await page.locator("#timebtn").click(); // "Return · M"
  await page.locator("#status").waitFor({ state: "hidden", timeout: 8000 });
  assert.equal((await timeRoom.state(timeRoom.id)).time.mode, "present");
  assert.deepEqual(errors, []);
  console.log("PASS standalone multiplayer slider, cancel, past status and return");
  await page.close();

  // 2. Pinned pages: pin beside a wall (API), then read through the spyglass.
  const noteRoom = await setup("NoteUI"); rooms.push(noteRoom);
  for (let attempt = 0; attempt < 300; attempt++) {
    const s = await noteRoom.state(noteRoom.id), x = s.players.find((p) => p.id === noteRoom.id).x;
    if (Math.abs(x + 185) < 20) { await noteRoom.send(noteRoom.id, { dir: 0 }); break; }
    await noteRoom.send(noteRoom.id, { dir: x < -185 ? 1 : -1 }); await sleep(110);
  }
  assert.ok((await noteRoom.send(noteRoom.id, { action: "pin_note", noteText: "Read me at dusk." })).ok, "API pin beside the tollhouse wall works");
  const note = await openRoom(browser, noteRoom, { width: 1280, height: 800 });
  await note.page.locator("#readnote").waitFor({ state: "visible", timeout: 15000 });
  await note.page.waitForFunction(() => document.getElementById("readnote")?.dataset.noteId, null, { timeout: 8000 });
  await note.page.locator("#readnote").click();
  const reader = note.page.getByTestId("note-reader");
  await reader.waitFor({ state: "attached" });
  await note.page.waitForFunction(() => (document.querySelector('[data-testid="note-reader"]')?.textContent ?? "").includes("Read me at dusk."), null, { timeout: 8000 });
  assert.ok((await reader.textContent()).includes(noteRoom.name), "the page names its author");
  await note.page.locator("#noteclose").click();
  await reader.waitFor({ state: "hidden", timeout: 8000 });
  // Pin from the UI: the pin panel creates a real note on the wall.
  await note.page.locator("#pinbtn").click();
  const panel = note.page.getByTestId("pin-note-panel");
  await panel.waitFor();
  await panel.locator("textarea").fill("Pinned from the UI.");
  await panel.getByTestId("pin-note-submit").click();
  await sleep(800);
  const noteState = await noteRoom.state(noteRoom.id);
  assert.ok((noteState.notes ?? []).some((n) => n.text === "Pinned from the UI."), "the UI pin panel creates a real note on the wall");
  assert.deepEqual(note.errors, []);
  console.log("PASS pinned-page reader (spyglass, author, close) and pin panel");
  await note.page.close();

  // 3. Phone: the time slider fits the viewport and the return control works.
  const mobileRoom = await setup("TimeMB"); rooms.push(mobileRoom);
  const mobile = await openRoom(browser, mobileRoom, { width: 390, height: 844 }, true);
  await sleep(800); // let the first snapshot settle before a touch-sized tap
  await mobile.page.locator("#timebtn").click();
  const mobileModal = mobile.page.getByRole("dialog", { name: "Choose a moment in the past" });
  await mobileModal.waitFor();
  const bounds = await mobileModal.locator(".hc-time-panel").boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, "mobile time slider fits the viewport");
  await mobileModal.getByRole("button", { name: "Enter the past" }).click();
  await mobile.page.locator("#status").getByText(/In the past/).waitFor({ timeout: 8000 });
  await mobile.page.locator("#timebtn").click();
  await mobile.page.locator("#status").waitFor({ state: "hidden", timeout: 8000 });
  assert.deepEqual(mobile.errors, []);
  console.log("PASS phone time slider fits and returns");
  await mobile.page.close();
  console.log("\nSTANDALONE ROOM TIME CHECKS PASSED");
} finally {
  await browser.close();
  for (const room of rooms) await Promise.all(room.ids.map((id) => post("/api/game/leave", { code: room.code, playerId: id }).catch(() => {})));
}
