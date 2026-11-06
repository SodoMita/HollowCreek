// Regression test for the polish worker opt-in gate (DB-free).
// The maintenance loop must never start unless HOLLOW_POLISH_WORKER=1, and it
// must never read its channel URL from a file in the repository.
//   node scripts/test-polish-gate.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 1. Without the opt-in flag the loop exits at once, before any model call or network use.
const env = { ...process.env };
delete env.HOLLOW_POLISH_WORKER;
delete env.HOLLOW_MAYFLY_URL;
const off = spawnSync(process.execPath, [resolve(repo, "scripts/polish-loop.mjs")], {
  env, encoding: "utf8", timeout: 10_000,
});
assert.equal(off.status, 0, "disabled loop exits cleanly");
assert.match(off.stderr, /disabled/, "disabled loop says why it stopped");

// 2. The supervisor requires the explicit flag and an env-provided channel URL,
//    and no longer falls back to a channel file in the repository.
const supervisor = readFileSync(resolve(repo, "src/server/polish-supervisor.ts"), "utf8");
assert.match(supervisor, /HOLLOW_POLISH_WORKER !== "1"\) return;/, "supervisor is opt-in");
assert.match(supervisor, /HOLLOW_MAYFLY_URL\?\.startsWith\("https:\/\/mayfly\.chat\/c\/"\)\) return;/, "supervisor needs the env channel");
assert.doesNotMatch(supervisor, /mayfly-channel\.txt/, "supervisor never reads a channel file");

const loop = readFileSync(resolve(repo, "scripts/polish-loop.mjs"), "utf8");
assert.doesNotMatch(loop, /mayfly-channel\.txt/, "loop never reads a channel file");

// 3. The channel file must stay untracked and ignored.
const gitignore = readFileSync(resolve(repo, ".gitignore"), "utf8");
assert.match(gitignore, /^scripts\/mayfly-channel\.txt$/m, "channel file is gitignored");

console.log("POLISH GATE OK: off by default, env-only channel, channel file ignored");
