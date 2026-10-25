import "server-only";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = globalThis as typeof globalThis & { __hollowPolishPid?: number };

/** Opt-in maintenance worker, detached from the preview request lifecycle.
 * It can only edit a separate /tmp clone and never auto-deploys changes. */
export function ensurePolishWorker() {
  if (process.env.HOLLOW_POLISH_WORKER === "0") return;
  const cwd = process.cwd();

  if (!process.env.HOLLOW_MAYFLY_URL) {
    const channelFile = join(cwd, "scripts/mayfly-channel.txt");
    if (existsSync(channelFile)) {
      try {
        const url = readFileSync(channelFile, "utf8").trim();
        if (url.startsWith("https://mayfly.chat/c/")) {
          process.env.HOLLOW_MAYFLY_URL = url;
        }
      } catch { /* ignore */ }
    }
  }

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
