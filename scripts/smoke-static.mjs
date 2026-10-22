// Proves a statically hosted client (GitHub Pages, Newgrounds, itch.io) on a
// DIFFERENT origin can drive the game end to end over CORS.
const GAME = process.argv[2] ?? "http://127.0.0.1:3100";
const PORT = Number(process.argv[3] ?? 8089);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DIR = process.argv[4] ?? "public/play";
const { createServer } = await import("node:http");
const { readFile } = await import("node:fs/promises");
const path = await import("node:path");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, l) => { console.log(`${c ? "  ok  " : " FAIL "} ${l}`); if (!c) failures++; };
const pid = () => crypto.randomUUID();

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = createServer(async (req, res) => {
  const file = req.url === "/" ? "index.html" : req.url.replace(/^\/+/, "");
  try {
    const body = await readFile(path.join(process.cwd(), DIR, file));
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404).end("nope"); }
});
await new Promise((r) => srv.listen(PORT, r));

const xo = async (p, body) => {
  const init = body
    ? { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) }
    : { headers: { origin: ORIGIN } };
  const res = await fetch(GAME + p, init);
  return { status: res.status, aco: res.headers.get("access-control-allow-origin"), json: await res.json().catch(() => ({})) };
};

const main = async () => {
  for (const f of ["/", "/game.js"]) {
    const r = await fetch(ORIGIN + f);
    ok(r.ok, `static host serves ${f}`);
  }
  const js = await (await fetch(ORIGIN + "/game.js")).text();
  ok(/fetch\(/.test(js) && js.length > 5000, "the bundle is the real client");

  const pre = await fetch(`${GAME}/api/game/input`, {
    method: "OPTIONS",
    headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  });
  ok(pre.status === 204 || pre.ok, `preflight answered (${pre.status})`);
  ok(pre.headers.get("access-control-allow-origin") === "*", "preflight allows any origin");

  const a = pid();
  const created = await xo("/api/game/create", { playerId: a, name: "Marta" });
  ok(created.aco === "*", "create is cross-origin readable");
  const code = created.json.code;
  const seats = [{ id: a, name: "Marta" }];
  for (const n of ["Nils", "Olga", "Piotr"]) {
    const id = pid();
    const j = await xo("/api/game/join", { code, playerId: id, name: n });
    ok(j.json.ok !== false, `${n} joined cross-origin`);
    seats.push({ id, name: n });
  }
  const st = async (id) => (await xo(`/api/game/state?code=${code}&playerId=${id}`)).json;
  const host = (await st(a)).hostId;
  const started = await xo("/api/game/input", { code, playerId: host, action: "start" });
  ok(started.json.ok !== false, `the night begins cross-origin (${started.json.error ?? "ok"})`);
  let s = await st(a);
  ok(s.phase === "playing", `playing (${s.phase})`);

  const before = s.players.find((p) => p.id === a).x;
  await xo("/api/game/input", { code, playerId: a, dir: 1 });
  await sleep(900);
  await xo("/api/game/input", { code, playerId: a, dir: 0 });
  const after = (await st(a)).players.find((p) => p.id === a).x;
  ok(after > before + 100, `the server moved the player ${Math.round(after - before)}px`);

  ok(Array.isArray(s.tasks) && s.tasks.length > 0, "the shared ward pool is in the snapshot");
  ok(typeof s.self.stamina === "number" && s.visionRadius > 0, "stamina and vision are exposed");
  ok(typeof s.abilityLabel === "string", "the ability label is exposed");

  const chat = await xo("/api/game/input", { code, playerId: a, chat: "hello from the static client" });
  ok(chat.json.ok !== false, "speech is accepted cross-origin");
  s = await st(a);
  const mine = s.players.find((p) => p.id === a);
  ok(!!mine.bubble && mine.bubble.text.includes("static client"), "the bubble comes back in the snapshot");

  const rooms = await xo("/api/game/rooms");
  ok(rooms.json.rooms?.some((r) => r.code === code), "the town appears in the cross-origin room menu");
  const stats = await xo("/api/game/stats");
  ok(stats.json.global && Array.isArray(stats.json.rows), "the Hall of Records is cross-origin readable");

  srv.close();
  console.log(failures === 0 ? "\nSTATIC CLIENT / CORS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
};
main().catch((e) => { console.error("CRASHED", e); process.exit(1); });
