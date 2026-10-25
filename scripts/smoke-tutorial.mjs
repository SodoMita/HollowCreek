// Smoke test for singleplayer tutorial and practice workbench.
// Usage: node scripts/smoke-tutorial.mjs [baseUrl]
import assert from "node:assert/strict";
import { build } from "esbuild";

const B = process.argv[2] ?? "http://127.0.0.1:3000";

let checks = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) throw new Error(msg);
  checks++;
};

try {
  // 1. Verify tutorial page is served
  const res = await fetch(`${B}/tutorial`);
  ok(res.status === 200, "tutorial page route /tutorial returns HTTP 200");
  const html = await res.text();
  ok(html.includes("Singleplayer") || html.includes("Tutorial"), "tutorial page content renders");

  // 2. Verify all ward jobs have title and instructions
  const out = await build({ entryPoints: ["src/game/wards.ts"], bundle: true, write: false, platform: "node", format: "esm" });
  const { WARD_JOBS, createWardPuzzle, wardSolved, wardKindFor } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

  const kinds = ["pumpkins", "well", "scarecrow", "lantern", "chapel", "mill", "graves", "radio", "silo"];
  for (const k of kinds) {
    const job = WARD_JOBS[k];
    ok(!!job && !!job.title && !!job.instruction, `${k} has valid tutorial title and instruction`);
    const pz = createWardPuzzle(k, 1234);
    ok(pz.kind === wardKindFor(k), `${k} puzzle instantiates cleanly for practice workbench`);
    ok(!wardSolved(pz), `${k} starts unsolved in practice`);
  }

  console.log(`\n${checks} TUTORIAL SMOKE CHECKS PASSED`);
} catch (e) {
  console.error("TUTORIAL SMOKE FAILED", e);
  process.exitCode = 1;
}
