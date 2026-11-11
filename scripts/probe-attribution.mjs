// Attribution probe: a browser soul walks with bots for SECONDS, then prints the
// client's own stall attribution (server-side vs in-transit) and the server's
// tick/loop/GC timing. Usage: BASE=http://127.0.0.1:3100 SECONDS=15 node scripts/probe-attribution.mjs
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
const B = process.env.BASE ?? "http://127.0.0.1:3100";
const SECONDS = Number(process.env.SECONDS ?? 15);
const headers = { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 20}` };
const post = async (p, b) => (await fetch(`${B}${p}`, { method: "POST", headers, body: JSON.stringify(b) })).json();
const ids = Array.from({ length: 4 }, () => randomUUID());
const { code } = await post("/api/game/create", { playerId: ids[0], name: "AtrA" });
for (let i = 1; i < 4; i++) await post("/api/game/join", { code, playerId: ids[i], name: `Atr${i}` });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { try { localStorage.setItem("hc_name", "AtrViewer"); } catch {} });
await page.goto(`${B}/play/?server=${B}&net=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction((w) => [...document.querySelectorAll("[data-code]")].some((b) => b.getAttribute("data-code") === w), code, { timeout: 20000, polling: 200 });
await page.evaluate((w) => [...document.querySelectorAll("[data-code]")].find((b) => b.getAttribute("data-code") === w)?.click(), code);
await page.waitForFunction(() => !!window.__hc?.snap?.(), undefined, { timeout: 15000, polling: 150 });
await page.evaluate(async () => { const s = window.__hc.snap(); await fetch("/api/game/input", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: s.code, playerId: s.self.id, action: "start" }) }); });
let run = true;
const bots = ids.slice(0, 3).map(async (id, i) => { let k = i * 40; while (run) { k++; await post("/api/game/input", { code, playerId: id, dir: Math.floor(k / 120) % 2 ? 1 : -1 }).catch(() => {}); await new Promise((r) => setTimeout(r, 100)); } });
await page.waitForTimeout(2500); // past startup compile, then measure clean
await page.evaluate(() => { const n = window.__hc.net(); window.__base = { s: n.stallServer, t: n.stallNet, l: n.wireLost }; });
await page.keyboard.down("d");
await page.waitForTimeout(SECONDS * 1000);
await page.keyboard.up("d");
const out = await page.evaluate(() => { const n = window.__hc.net(); const b = window.__base; return { stallServer: n.stallServer - b.s, stallNet: n.stallNet - b.t, lost: n.wireLost - b.l, worstGen: n.worstGenGapMs, worstArrival: Math.round(n.worstPosGapMs), jit: n.owdJitter.slice().sort((a, c) => a - c) }; });
run = false; await Promise.allSettled(bots);
const stats = await (await fetch(`${B}/api/game/netstats`)).json();
await browser.close();
const q = (a, f) => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : "–");
console.log(`client (${SECONDS}s walking, 4 souls): stalls server-side ${out.stallServer} · in transit ${out.stallNet} · lost frames ${out.lost}`);
console.log(`        worst server-generation gap ${out.worstGen} ms · worst arrival gap ${out.worstArrival} ms · delay jitter p50 ${q(out.jit, 0.5)} p99 ${q(out.jit, 0.99)} max ${q(out.jit, 1)} ms`);
console.log(`server  tick p50 ${stats.tick.p50} p99 ${stats.tick.p99} max ${stats.tick.max} ms (late ${stats.tick.late}/${stats.tick.samples}) · work p99 ${stats.work.p99} max ${stats.work.max} ms`);
console.log(`        loop block p99 ${stats.loop.p99} max ${stats.loop.max} ms · gc max ${stats.gc.max} ms ×${stats.gc.count} (${stats.gc.totalMs} ms total) · heap ${stats.heapMB} MB`);
process.exit(0);
