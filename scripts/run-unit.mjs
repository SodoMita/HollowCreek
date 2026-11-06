// Runs all DB-free unit suites. DB-backed suites (test-notes, test-time-*,
// test-command-replay, test-replay-determinism) are excluded — they need
// DATABASE_URL and belong to CI.
import { spawnSync } from "node:child_process";
const SUITES = ["test-rng", "test-fingerprint", "test-wards", "test-house-wards", "test-ward-ui", "test-voice", "test-voice-client", "test-input", "test-history", "test-proximity", "test-focus-trap", "test-polish-gate"];
// DB-backed suites run too when a database is reachable (DATABASE_URL set).
const DB_SUITES = ["test-notes", "test-time-engine", "test-time-multi", "test-time-nested", "test-time-seeing", "test-command-replay", "test-replay-determinism"];
if (process.env.DATABASE_URL) SUITES.push(...DB_SUITES);
let failed = 0;
for (const t of SUITES) {
  const r = spawnSync(process.execPath, [`scripts/${t}.mjs`], { stdio: "pipe", encoding: "utf8" });
  const last = (r.stdout || "").trim().split("\n").pop() || r.stderr?.trim().split("\n").pop() || "";
  if (r.status === 0) console.log(`PASS ${t} — ${last}`);
  else { failed++; console.log(`FAIL ${t} — ${last}`); }
}
if (failed) { console.error(`${failed} suite(s) failed`); process.exit(1); }
console.log(`ALL ${SUITES.length} DB-free suites passed`);
