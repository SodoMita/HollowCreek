// Smoke for the plain Hall of Records and Chronicle pages (static-src → public/play).
// The API is stubbed, so this checks the page logic only. Usage:
//   node scripts/smoke-records.mjs http://127.0.0.1:8090   (a static server over public/play)
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:8090").replace(/\/$/, "");
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

function stub(page, handler) {
  return page.route("**/api/game/**", (route) => {
    const url = new URL(route.request().url());
    const reply = handler(url);
    return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
}

const row = (name, extra = {}) => ({
  playerId: `p-${name}`, name, games: 4, wins: 3, losses: 1, kills: 1, deaths: 2, tasksDone: 5,
  cagings: 0, unlocks: 0, reports: 1, bells: 2, chatChars: 120, playtimeSec: 3700, ...extra,
});

try {
  // Records: rows render as text, the name is never parsed as markup.
  {
    const page = await browser.newPage();
    await stub(page, () => ({ status: 200, body: { rows: [row("Ada"), row("<img src=x onerror=alert(1)>")] } }));
    await page.goto(`${base}/records.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#tablewrap:not([hidden])", { timeout: 10000 });
    assert.equal(await page.locator("#rows tr").count(), 2);
    assert.equal(await page.locator("#rows img").count(), 0, "a name must not become an element");
    assert.ok((await page.locator("#rows tr").first().innerText()).includes("1. Ada"));
    assert.ok((await page.locator("#totals").innerText()).includes("souls recorded"));
    console.log("PASS records: table renders names as text");
    await page.close();
  }
  // Records: empty ledger.
  {
    const page = await browser.newPage();
    await stub(page, () => ({ status: 200, body: { rows: [] } }));
    await page.goto(`${base}/records.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#empty:not([hidden])", { timeout: 10000 });
    assert.equal(await page.locator("#tablewrap").isHidden(), true);
    console.log("PASS records: empty ledger shows the empty line");
    await page.close();
  }
  // Records: server unreachable.
  {
    const page = await browser.newPage();
    await page.route("**/api/game/**", (route) => route.abort());
    await page.goto(`${base}/records.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#status:not([hidden])", { timeout: 10000 });
    assert.ok((await page.locator("#status").innerText()).includes("unreachable"));
    console.log("PASS records: unreachable server shows the notice");
    await page.close();
  }
  // Chronicle: no code.
  {
    const page = await browser.newPage();
    await page.goto(`${base}/chronicle.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#status:not([hidden])", { timeout: 10000 });
    assert.ok((await page.locator("#status").innerText()).includes("town code is needed"));
    console.log("PASS chronicle: no code asks for one");
    await page.close();
  }
  // Chronicle: sealed (403).
  {
    const page = await browser.newPage();
    await stub(page, () => ({ status: 403, body: { ok: false, sealed: true } }));
    await page.goto(`${base}/chronicle.html?code=ab12`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sealed:not([hidden])", { timeout: 10000 });
    assert.ok((await page.locator("#sealedText").innerText()).includes("AB12"));
    console.log("PASS chronicle: live room is sealed");
    await page.close();
  }
  // Chronicle: events, with the town (no name) and a named soul.
  {
    const page = await browser.newPage();
    await stub(page, () => ({
      status: 200,
      body: {
        ok: true, code: "AB12",
        events: [
          { id: 1, playerName: "Ada", type: "chat", data: { text: "hello" }, createdAt: "2026-11-08T10:00:00Z" },
          { id: 2, playerName: null, type: "game_end", data: { winner: "townsfolk", reason: "the Hollow is caged" }, createdAt: "2026-11-08T10:05:00Z" },
        ],
      },
    }));
    await page.goto(`${base}/chronicle.html?code=ab12`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#open:not([hidden])", { timeout: 10000 });
    assert.equal(await page.locator("#entries .entry").count(), 2);
    const text = await page.locator("#entries").innerText();
    assert.ok(text.includes("Ada") && text.includes("“hello”"));
    assert.ok(text.includes("the Hollow is caged"));
    console.log("PASS chronicle: events render oldest first with details");
    await page.close();
  }
  // Chronicle: database down (503).
  {
    const page = await browser.newPage();
    await stub(page, () => ({ status: 503, body: { ok: false, dbDown: true } }));
    await page.goto(`${base}/chronicle.html?code=ab12`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#status:not([hidden])", { timeout: 10000 });
    assert.ok((await page.locator("#status").innerText()).includes("no database"));
    console.log("PASS chronicle: database down shows the notice");
    await page.close();
  }
  console.log("\nRECORDS AND CHRONICLE CHECKS PASSED");
} finally {
  await browser.close();
}
