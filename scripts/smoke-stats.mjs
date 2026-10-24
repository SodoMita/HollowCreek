// Smoke test: shared broken wards, physical repair kits, stamina, chronicle and stats.
// Usage: node scripts/smoke-stats.mjs [baseUrl]
const B = process.argv[2] ?? "http://127.0.0.1:3000";
const post = (p, b) => fetch(B + p, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
}).then((r) => r.json());
const state = (c, p) => fetch(`${B}/api/game/state?code=${c}&playerId=${p}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS" : "FAIL") + " " + name); };

const stamp = Date.now().toString(36);
const ids = [1, 2, 3, 4].map((i) => `sm${stamp}-${i}`);
const { code } = await post("/api/game/create", { playerId: ids[0], name: "SmokeA" });
for (let i = 1; i < 4; i++) await post("/api/game/join", { code, playerId: ids[i], name: "Smoke" + "ABCD"[i] });
await post("/api/game/input", { code, playerId: ids[3], action: "start" });
await sleep(300);

const initial = await Promise.all(ids.map((id) => state(code, id)));
const s0 = initial[0];
check("game started", s0.phase === "playing");
check("role and match results remain sealed", s0.results === null && !s0.players.some((p) => "role" in p));
check("every ward initially broken", s0.tasks.length === 9 && s0.tasks.every((t) => !t.done && !t.delivered && !t.progress));
check("shared pool identical for every seat", initial.every((s) => s.tasks.map((t) => t.id).join(",") === s0.tasks.map((t) => t.id).join(",")));
check("stamina and kit start in the right state", initial.every((s) => s.self.stamina === 1 && !s.self.hasSupply));

// The Hollow may pretend to work but cannot repair; always choose an actual crew seat.
const crew = initial.find((s) => s.self.role === "crew");
const pid = crew.self.id;
const myState = () => state(code, pid);
const input = (body) => post("/api/game/input", { code, playerId: pid, ...body });
const where = (s) => s.players.find((p) => p.id === pid).x;
const cartStart = crew.cartX;
const task = crew.tasks
  .filter((t) => Math.abs(t.x - cartStart) > 165)
  .sort((a, b) => Math.abs(a.x - cartStart) - Math.abs(b.x - cartStart))[0];

async function walkTo(x) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const s = await myState();
    const at = where(s);
    if (Math.abs(at - x) < 42) { await input({ dir: 0, interactHeld: false }); return; }
    await input({ dir: x > at ? 1 : -1, interactHeld: false });
    await sleep(210);
  }
  throw new Error(`Could not walk to ${x}`);
}

await walkTo(task.x);
await input({ dir: 0, interactHeld: true });
await sleep(700);
check("cannot repair without a delivered kit", (await myState()).tasks.find((t) => t.id === task.id).progress === 0);
await walkTo((await myState()).cartX);
await input({ action: "interact", interactHeld: false });
check("kit picked up at the one supply cart", (await myState()).self.hasSupply);
await walkTo(task.x);
check("hauling spends vigor", (await myState()).self.stamina < 1);
await input({ action: "drop_supply" });
const onGround = await myState();
check("kit can be dropped", !onGround.self.hasSupply && onGround.supplyDrops.length > 0);
await input({ action: "interact", interactHeld: false });
check("dropped kit can be recovered", (await myState()).self.hasSupply);
await input({ action: "interact", interactHeld: true });
const delivered = await myState();
check("kit delivered to broken ward", delivered.tasks.find((t) => t.id === task.id).delivered && !delivered.self.hasSupply);
check("repair board opens immediately on delivery", delivered.minigame?.stationId === task.id);
await sleep(900);
check("holding E cannot auto-complete a puzzle", (await myState()).tasks.find((t) => t.id === task.id).progress === 0);
await input({ interactHeld: false });
const beforeWork = (await myState()).self.stamina;
for (let turn = 0; turn < 75; turn++) {
  const board = (await myState()).minigame;
  if (!board) break;
  check("well has The Long Draw", board.kind === "well");
  const [position, tension] = board.values;
  const catchBand = board.targets[board.step];
  const moveIndex = position < catchBand ? tension >= 4 ? 1 : 0 : tension > 2 ? 1 : 2;
  const move = await input({ action: "ward_move", wardId: task.id, move: moveIndex });
  if (!move.ok) throw new Error(`Bucket catch rejected: ${move.error}`);
}
const mid = await myState();
check("puzzle moves drain stamina", mid.self.stamina < beforeWork);
check("solving puzzle completes the shared ward", mid.tasks.find((t) => t.id === task.id).done && mid.taskBar.done === 1);
check("completed board closes automatically", mid.minigame === null);
const before = mid.self.stamina;
await sleep(2500);
check("idling recovers stamina", (await myState()).self.stamina > before);

const sealed = await fetch(`${B}/chronicle/${code}`).then((r) => r.text());
check("chronicle sealed during match", sealed.includes("The ledger is sealed"));
check("JSON chronicle sealed during match", (await fetch(`${B}/api/game/log?code=${code}`)).status === 403);
const stats = await fetch(`${B}/api/game/stats`).then((r) => r.json());
check("stats API shape", stats && typeof stats.global === "object" && Array.isArray(stats.rows));
const page = await fetch(`${B}/stats`).then((r) => r.text());
check("Hall of Records renders", page.includes("Hall of Records"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
