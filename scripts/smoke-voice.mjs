// Signaling and server-side proximity rules; the browser handles WebRTC audio.
// Usage: node scripts/smoke-voice.mjs [baseUrl]
const B = process.argv[2] ?? "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
let count = 0;
const ok = (yes, text) => { console.log(`${yes ? "PASS" : "FAIL"} ${text}`); if (!yes) throw new Error(text); count++; };
async function request(path, body, headers = {}) {
  const response = await fetch(`${B}${path}`, body ? { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) } : { headers });
  return { status: response.status, body: await response.json() };
}
const { body: created } = await request("/api/game/create", { playerId: ids[0], name: "VoiceA" });
const code = created.code;
for (let i = 1; i < 4; i++) await request("/api/game/join", { code, playerId: ids[i], name: `Voice${i + 1}` });
const input = (id, intent) => request("/api/game/input", { code, playerId: id, ...intent });
const state = async (id) => (await request(`/api/game/state?code=${code}&playerId=${id}`)).body;
const where = async (id) => (await state(id)).players.find((p) => p.id === id).x;
const voice = (id, action, session, more = {}) => request("/api/game/voice", { code, playerId: id, action, session, ...more });
const poll = (id, session) => request(`/api/game/voice?${new URLSearchParams({ code, playerId: id, session })}`);
const moveTo = async (id, target) => {
  const until = Date.now() + 27000;
  while (Date.now() < until) {
    const x = await where(id);
    if (Math.abs(x - target) < 32) { await input(id, { dir: 0 }); return; }
    await input(id, { dir: x < target ? 1 : -1 });
    await sleep(230);
  }
  throw new Error(`Could not reach ${target}`);
};
try {
  ok((await input(ids[3], { action: "start" })).body.ok, "four-player night started");
  const roles = await Promise.all(ids.map(async (id) => (await state(id)).self.role));
  const hollow = ids[roles.indexOf("hollow")];
  const crew = ids.find((id) => id !== hollow);
  const premic = await poll(hollow, "not-a-session");
  ok(premic.status === 403, "no signaling access before opt-in");
  const h = await voice(hollow, "join", "");
  const c = await voice(crew, "join", "");
  ok(h.status === 200 && c.status === 200 && !!h.body.session && !!c.body.session,
    "two explicit voice joins receive private session tokens");
  const hs = h.body.session, cs = c.body.session;
  const configQuery = (session) => `/api/game/voice?${new URLSearchParams({ code, playerId: hollow, session, config: "1" })}`;
  const ice = await request(configQuery(hs));
  ok(ice.status === 200 && ice.body.iceServers.length >= 2, "active voice seat receives STUN or configured TURN servers");
  ok((await request(configQuery("wrong-session"))).status === 403, "ICE relay credentials require a valid voice session");
  ok((await poll(hollow, "wrong-session")).status === 403, "another seat cannot drain this voice inbox");
  ok((await voice(hollow, "join", "")).status === 409, "second tab cannot hijack an active mic session");

  await moveTo(crew, await where(hollow));
  let nearPeer = null;
  for (let i = 0; i < 20; i++) {
    const near = await poll(hollow, hs);
    nearPeer = near.body.peers?.find((p) => p.id === crew);
    if (nearPeer && nearPeer.gain > 0.85) break;
    await sleep(200);
  }
  ok(!!nearPeer && nearPeer.gain > 0.85, "nearby voice is full volume");
  const nearCheck = await poll(hollow, hs);
  ok(!nearCheck.body.peers.some((p) => "x" in p || "role" in p), "voice list does not expose positions or roles");

  // Verify server audio relay routing fallback when nearby
  const audioPcmB64 = Buffer.from(new Int16Array([10, 20, 30, 40])).toString("base64");
  const audioPost = await voice(hollow, "audio", hs, { chunk: audioPcmB64, rate: 12000 });
  ok(audioPost.status === 200, "microphone audio packets can be routed through game server");
  const crewRelayPoll = await poll(crew, cs);
  ok(crewRelayPoll.body.audioChunks?.some((c) => c.from === hollow), "in-earshot listener receives server audio packet");

  const offer = await voice(hollow, "signal", hs, { to: crew, type: "offer", data: { type: "offer", sdp: "v=0\r\n" } });
  ok(offer.status === 200, "nearby encrypted WebRTC offer can be signaled");
  ok((await poll(crew, cs)).body.signals.some((s) => s.type === "offer" && s.from === hollow), "answering peer receives offer");
  ok((await voice(crew, "signal", cs, { to: hollow, type: "answer", data: { type: "answer", sdp: "v=0\r\n" } })).status === 200, "answer can return");
  ok((await poll(hollow, hs)).body.signals.some((s) => s.type === "answer"), "caller receives answer");
  ok((await voice(hollow, "signal", hs, { to: crew, type: "candidate", data: { candidate: "candidate:1 1 udp 1 192.0.2.10 1234 typ host", sdpMid: "0", sdpMLineIndex: 0 } })).status === 200, "ICE can trickle after the offer");
  ok((await poll(crew, cs)).body.signals.some((s) => s.type === "candidate"), "ICE candidate reaches peer");

  const origin = await where(hollow);
  const direction = origin < 2100 ? 1 : -1;
  await moveTo(crew, origin + direction * 390);
  const mid = (await poll(hollow, hs)).body.peers.find((p) => p.id === crew);
  ok(mid && mid.gain > 0 && mid.gain < nearPeer.gain * 0.5, "voice fades with distance");
  ok(mid && Math.sign(mid.pan) === direction && Math.abs(mid.pan) > 0.4,
    "voice pans toward the speaker without exposing coordinates");
  await moveTo(crew, origin + direction * 790);
  ok(!(await poll(hollow, hs)).body.peers.some((p) => p.id === crew), "out-of-earshot voice is not connected");
  ok((await voice(hollow, "signal", hs, { to: crew, type: "offer", data: { type: "offer", sdp: "v=0" } })).status === 403,
    "server refuses signaling beyond earshot");
  await voice(hollow, "audio", hs, { chunk: audioPcmB64, rate: 12000 });
  const farRelayPoll = await poll(crew, cs);
  ok(!farRelayPoll.body.audioChunks?.some((c) => c.from === hollow), "out-of-earshot listener does not receive audio packets");

  await moveTo(crew, origin);
  const deadline = Date.now() + 16000;
  while ((await state(hollow)).self.killCooldownMs > 0 && Date.now() < deadline) await sleep(450);
  ok((await input(hollow, { action: "ability" })).body.ok, "Hollow kills a nearby crew player");
  ok(!(await poll(hollow, hs)).body.peers.some((p) => p.id === crew), "living cannot hear the newly dead");
  ok(!(await poll(crew, cs)).body.peers.some((p) => p.id === hollow), "ghost cannot hear the living");
  ok((await voice(crew, "leave", cs)).body.ok, "explicit voice leave shuts down seat");
  ok((await poll(crew, cs)).status === 403, "voice session cannot poll after leaving");
  const preflight = await fetch(`${B}/api/game/voice`, { method: "OPTIONS", headers: {
    Origin: "https://example.itch.io", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
  } });
  ok(preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === "*", "portal-hosted voice can preflight CORS");
  console.log(`\n${count} VOICE SIGNALING CHECKS PASSED`);
} catch (error) {
  console.error("VOICE SIGNALING SMOKE FAILED", error);
  process.exitCode = 1;
}
