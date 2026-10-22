// Is the Hollow actually random? Measures the live distribution of roles per
// seat over many real games (their test-rng.mjs covers the RNG itself; this
// covers the whole HTTP path, join order included).
// Usage: node scripts/smoke-random.mjs [baseUrl] [draws]
const B = process.argv[2] ?? "http://127.0.0.1:3100";
const DRAWS = Number(process.argv[3] ?? 200);
const pid = () => crypto.randomUUID();
const post = async (p, b) => {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const role = async (c, id) => {
  const r = await fetch(`${B}/api/game/state?code=${c}&playerId=${id}`);
  return r.ok ? (await r.json()).self.role : null;
};
let failures = 0;
const ok = (c, l) => { console.log(`${c ? "  ok  " : " FAIL "} ${l}`); if (!c) failures++; };

async function draw(seats) {
  const ids = Array.from({ length: seats }, () => pid());
  const { code } = await post("/api/game/create", { playerId: ids[0], name: "R0" });
  for (let i = 1; i < seats; i++) await post("/api/game/join", { code, playerId: ids[i], name: `R${i}` });
  if ((await post("/api/game/input", { code, playerId: ids[seats - 1], action: "start" })).ok === false) return null;
  const roles = [];
  for (const id of ids) roles.push(await role(code, id));
  return roles;
}

const main = async () => {
  const counts = new Array(6).fill(0);
  let bad = 0, draws = 0;
  for (let i = 0; i < DRAWS; i++) {
    const roles = await draw(6);
    if (!roles || roles.some((r) => !r)) continue;
    draws++;
    if (roles.filter((r) => r === "hollow").length !== 2) bad++;
    roles.forEach((r, seat) => { if (r === "hollow") counts[seat]++; });
  }
  const expected = (2 * draws) / 6;
  const sd = Math.sqrt(draws * (1 / 3) * (2 / 3));
  const lo = expected - 4 * sd, hi = expected + 4 * sd;
  console.log(`draws: ${draws} · expected per seat ${expected.toFixed(1)} · window [${lo.toFixed(1)}, ${hi.toFixed(1)}]`);
  counts.forEach((c, s) => console.log(`  seat ${s}: ${String(c).padStart(4)}  ${(100 * c / draws).toFixed(1)}%`));
  ok(bad === 0, `every 6-player night has exactly 2 Hollow (${bad} bad)`);
  ok(counts.every((c) => c >= lo && c <= hi), "no seat is more or less likely to be the Hollow");

  const one = new Array(4).fill(0);
  let small = 0;
  for (let i = 0; i < 60; i++) {
    const roles = await draw(4);
    if (!roles || roles.some((r) => !r)) continue;
    small++;
    if (roles.filter((r) => r === "hollow").length !== 1) bad++;
    roles.forEach((r, s) => { if (r === "hollow") one[s]++; });
  }
  console.log(`4-seat draws: ${small} · hollow per seat: ${one.join(", ")}`);
  ok(bad === 0, "every 4-player night has exactly 1 Hollow");
  console.log(failures === 0 ? "\nRANDOMNESS OK" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
};
main().catch((e) => { console.error("CRASHED", e); process.exit(1); });
