import "server-only";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = globalThis as typeof globalThis & { __hollowPolishPid?: number };

// Must match scripts/polish-loop.mjs: scratch state lives in one base dir,
// repo-local .cache preferred over the (often tiny, tmpfs) OS tmpdir.
function polishBase(cwd: string) {
  const candidates = process.env.HOLLOW_POLISH_TMP
    ? [process.env.HOLLOW_POLISH_TMP]
    : [join(cwd, ".cache", "polish"), join(tmpdir(), "hollow-polish")];
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch { /* try next candidate */ }
  }
  return tmpdir();
}

/** Explicit opt-in maintenance worker, detached from the preview request
 * lifecycle. It runs only when HOLLOW_POLISH_WORKER=1 is set in the server
 * environment (never by default) and it needs its channel URL from the env
 * too, so no channel secret is ever read from the repository. It can only
 * edit a separate scratch clone and never auto-deploys changes. */
export function ensurePolishWorker() {
  if (process.env.HOLLOW_POLISH_WORKER !== "1") return;
  const cwd = process.cwd();
  if (!process.env.HOLLOW_MAYFLY_URL?.startsWith("https://mayfly.chat/c/")) return;

  const script = join(cwd, "scripts/polish-loop.mjs");
  const cli = join(cwd, "node_modules/.bin/opencode");
  if (!existsSync(script) || !existsSync(cli)) return;
  if (root.__hollowPolishPid) {
    try { process.kill(root.__hollowPolishPid, 0); return; }
    catch { root.__hollowPolishPid = undefined; }
  }
  try {
    const child = spawn("flock", ["-n", join(polishBase(cwd), "polish.lock"), process.execPath, script], {
      cwd, detached: true, stdio: "ignore",
      env: { ...process.env, HOLLOW_POLISH_ROOT: cwd },
    });
    root.__hollowPolishPid = child.pid;
    child.on("error", () => { root.__hollowPolishPid = undefined; });
    child.on("exit", () => { root.__hollowPolishPid = undefined; });
    child.unref();
  } catch { /* maintenance must never break the game healthcheck */ }
}
