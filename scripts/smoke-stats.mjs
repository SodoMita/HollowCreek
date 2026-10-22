// Smoke test: shared ward pool, stamina/exhaustion, chronicle seal, stats.
// Usage: node scripts/smoke-stats.mjs [baseUrl]
const B = process.argv[2] ?? "http://127.0.0.1:3000";
const post = (p, b) => fetch(B + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const state = (c, p) => fetch(`${B}/api/game/state?code=${c}&playerId=${p}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS" : "FAIL") + " " + name); };

const t = Date.now().toString(36);
const ids = [1, 2, 3, 4].map((i) => `sm${t}-${i}`);
const { code } = await post("/api/game/create", { playerId: ids[0], name: "SmokeA" });
for (let i = 1; i < 4; i++) await post("/api/game/join", { code, playerId: ids[i], name: "Smoke" + "ABCD"[i] });
await post("/api/game/input", { code, playerId: ids[3], action: "start" });
await sleep(300);

const s0 = await state(code, ids[0]);
check("game started", s0.phase === "playing");
check("shared pool exists", s0.tasks.length >= 6);
const pools = await Promise.all(ids.map((id) => state(code, id).then((s) => s.tasks.map((x) => x.id).join(","))));
check("pool identical for every seat", pools.every((p) => p === pools[0]));
check("stamina starts full", s0.self.stamina === 1 && s0.self.exhausted === false);

// walk first player to first ward and work it
const task = s0.tasks[0];
for (let i = 0; i < 300; i++) {
  const st = await state(code, ids[0]);
  const me = st.players.find((p) => p.id === ids[0]);
  if (Math.abs(me.x - task.x) < 55) break;
  await post("/api/game/input", { code, playerId: ids[0], dir: task.x > me.x ? 1 : -1 });
  await sleep(130);
}
await post("/api/game/input", { code, playerId: ids[0], dir: 0, interactHeld: true });
await sleep(1500);
const mid = await state(code, ids[0]);
check("work drains stamina", mid.self.stamina < 1);
check("work progresses shared ward", mid.tasks[0].progress > 0);
await post("/api/game/input", { code, playerId: ids[0], interactHeld: false });
const before = (await state(code, ids[0])).self.stamina;
await sleep(2500);
const after = (await state(code, ids[0])).self.stamina;
check("idling recovers stamina", after > before);

// chronicle sealed mid-match
const sealed = await fetch(`${B}/chronicle/${code}`).then((r) => r.text());
check("chronicle sealed during match", sealed.includes("The ledger is sealed"));

// stats API + page
const stats = await fetch(`${B}/api/game/stats`).then((r) => r.json());
check("stats API shape", stats && typeof stats.global === "object" && Array.isArray(stats.rows));
const page = await fetch(`${B}/stats`).then((r) => r.text());
check("Hall of Records renders", page.includes("Hall of Records"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);