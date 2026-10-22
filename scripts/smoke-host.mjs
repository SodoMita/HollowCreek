// Host handoff / disconnect detection test.
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, b) =>
  (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b ?? {}) })).json();
const state = (p) => fetch(`${BASE}/api/rooms/${p.code}/state?playerId=${p.id}`).then((r) => r.json());

let failures = 0;
const ok = (c, l) => {
  console.log(`${c ? "  ok  " : " FAIL "} ${l}`);
  if (!c) failures++;
};

async function openStream(p) {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/api/stream?code=${p.code}&playerId=${p.id}`, { signal: ac.signal });
  const reader = res.body.getReader();
  const pump = reader.read().catch(() => {});
  return { ac, pump };
}

const main = async () => {
  const created = await post("/api/rooms", { name: "Ada" });
  const code = created.code;
  const ada = { code, id: created.playerId, token: created.token, name: "Ada" };
  const players = [ada];
  for (const n of ["Bob", "Cal"]) {
    const j = await post(`/api/rooms/${code}/join`, { name: n });
    players.push({ code, id: j.playerId, token: j.token, name: n });
  }
  const [bob, cal] = players.slice(1);

  ok((await state(ada)).you.isHost === true, "first joiner starts as host");

  // Ada connects, then slams the tab shut (stream aborted, no leave action)
  const s1 = await openStream(ada);
  await openStream(bob);
  await openStream(cal);
  await sleep(700);
  ok((await state(bob)).players.find((p) => p.isYou).connected !== false, "connected while streaming");
  s1.ac.abort();
  await s1.pump;
  await sleep(500);
  const afterDrop = await state(bob);
  const adaView = afterDrop.players.find((p) => p.id === ada.id);
  ok(adaView && adaView.connected === false, "drop is detected (connected=false)");
  ok(adaView.isHost === true, "host keeps the lantern during the grace period");

  await sleep(8500);
  const afterGrace = await state(bob);
  const adaNow = afterGrace.players.find((p) => p.id === ada.id);
  ok(adaNow && adaNow.isHost === false, "dead host is demoted after the grace period");
  const bobNow = afterGrace.players.find((p) => p.id === bob.id);
  ok(bobNow && bobNow.isHost === true, "earliest still-connected player is promoted");

  // the returned host can start a game
  const r = await post("/api/input", { code, playerId: bob.id, token: bob.token, action: { type: "start" } });
  ok(!r.error, `promoted host can start the night (${r.error ?? "ok"})`);

  // a returning player reconnects cleanly and is marked connected again
  const s2 = await openStream(ada);
  await sleep(400);
  const back = await state(bob);
  const adaBack = back.players.find((p) => p.id === ada.id);
  ok(adaBack && adaBack.connected === true, "reconnecting player is marked connected");
  s2.ac.abort();
  await s2.pump;

  console.log(failures === 0 ? "\nHOST HANDOFF PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error("CRASHED", e);
  process.exit(1);
});
