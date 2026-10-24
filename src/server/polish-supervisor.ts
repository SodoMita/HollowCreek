import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = globalThis as typeof globalThis & { __hollowPolishPid?: number };

/** Opt-in maintenance worker, detached from the preview request lifecycle.
 * It can only edit a separate /tmp clone and never auto-deploys changes. */
export function ensurePolishWorker() {
  if (process.env.NODE_ENV !== "production" || process.env.HOLLOW_POLISH_WORKER !== "1" ||
      !process.env.HOLLOW_MAYFLY_URL) return;
  const cwd = process.cwd();
  const script = join(cwd, "scripts/polish-loop.mjs");
  const cli = join(cwd, "node_modules/.bin/opencode");
  if (!existsSync(script) || !existsSync(cli)) return;
  if (root.__hollowPolishPid) {
    try { process.kill(root.__hollowPolishPid, 0); return; }
    catch { root.__hollowPolishPid = undefined; }
  }
  try {
    const child = spawn("flock", ["-n", "/tmp/hollow-polish.lock", process.execPath, script], {
      cwd, detached: true, stdio: "ignore",
      env: { ...process.env, HOLLOW_POLISH_ROOT: cwd },
    });
    root.__hollowPolishPid = child.pid;
    child.on("error", () => { root.__hollowPolishPid = undefined; });
    child.on("exit", () => { root.__hollowPolishPid = undefined; });
    child.unref();
  } catch { /* maintenance must never break the game healthcheck */ }
}
