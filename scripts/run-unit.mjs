// Runs all DB-free unit suites. DB-backed suites (test-notes, test-time-*,
// test-command-replay, test-replay-determinism) are excluded — they need
// DATABASE_URL and belong to CI.
import { spawnSync } from "node:child_process";
const SUITES = ["test-rng", "test-fingerprint", "test-wards", "test-house-wards", "test-ward-ui", "test-voice", "test-voice-client", "test-input", "test-history", "test-proximity"];
let failed = 0;
for (const t of SUITES) {
  const r = spawnSync(process.execPath, [`scripts/${t}.mjs`], { stdio: "pipe", encoding: "utf8" });
  const last = (r.stdout || "").trim().split("\n").pop() || r.stderr?.trim().split("\n").pop() || "";
  if (r.status === 0) console.log(`PASS ${t} — ${last}`);
  else { failed++; console.log(`FAIL ${t} — ${last}`); }
}
if (failed) { console.error(`${failed} suite(s) failed`); process.exit(1); }
console.log(`ALL ${SUITES.length} DB-free suites passed`);
