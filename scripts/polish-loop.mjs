// Long-running *isolated* OpenCode maintenance loop. Started by the live
// server's health route only when HOLLOW_POLISH_WORKER=1. It never edits /app,
// publishes to GitHub, uses a GitHub credential, or changes game mechanics.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as pause } from "node:timers/promises";

const root = process.env.HOLLOW_POLISH_ROOT || process.cwd();
const channel = process.env.HOLLOW_MAYFLY_URL || "";
const cli = join(root, "node_modules/.bin/opencode");
const clone = join(tmpdir(), "hollow-polish-work");
const statusPath = join(tmpdir(), "hollow-polish-status.json");
const clientPath = join(tmpdir(), "hollow-polish-mayfly.mjs");
const interval = Math.max(300_000, Number(process.env.HOLLOW_POLISH_INTERVAL_MS) || 1_800_000);
const begun = new Date().toISOString();
let cycle = 0;

// Never pass a GitHub token or Next secrets to the coding agent. Database URL
// is needed only by the supervisor's build, not by the model or its tools.
const agentEnv = { PATH: process.env.PATH || "/usr/bin:/bin", HOME: join(tmpdir(), "hollow-polish-home"),
  LANG: "C.UTF-8", CI: "1", HOLLOW_MAYFLY_URL: channel, HOLLOW_MAYFLY_CLIENT: clientPath };
mkdirSync(agentEnv.HOME, { recursive: true });
const report = (phase, detail = {}) => {
  writeFileSync(statusPath, JSON.stringify({ enabled: true, pid: process.pid, startedAt: begun,
    updatedAt: new Date().toISOString(), cycle, phase, ...detail }, null, 2), { mode: 0o600 });
};
function execute(command, args, cwd = root, timeout = 120_000, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, maxBuffer: 4_000_000 });
  return { ok: result.status === 0 && !result.error, output: `${result.stdout || ""}\n${result.stderr || ""}`.slice(-80_000),
    error: result.error?.message || (result.status === 0 ? "" : `exit ${result.status}`) };
}
async function prepareMayfly() {
  if (!channel || existsSync(clientPath)) return;
  try {
    const response = await fetch("https://mayfly.chat/static/client.mjs");
    if (response.ok) writeFileSync(clientPath, await response.text(), { mode: 0o600 });
  } catch { /* posting is best-effort */ }
}
function postMayfly(text) {
  if (!channel || !existsSync(clientPath)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = execute(process.execPath, [clientPath, channel, "read", "--last", "-1", "--wait", "0"], root, 22_000);
    if (!read.ok) return;
    let last;
    try { last = JSON.parse(read.output.trim()).last; } catch { return; }
    const posted = spawnSync(process.execPath, [clientPath, channel, "post", "--from", "Creek-Polisher",
      "--last", String(last), "--wait", "0"], { input: text, cwd: root, encoding: "utf8", timeout: 22_000 });
    if (posted.status === 0 && posted.stdout?.includes('"posted":true')) return;
  }
}
function safePaths(paths) {
  return paths.every((file) => [
    /^src\/app\/(page\.tsx|globals\.css|room\/\[code\]\/GameClient\.tsx|stats\/page\.tsx|chronicle\/\[code\]\/page\.tsx)$/,
    /^src\/game\/(ward-ui|settings-ui)\.ts$/,
    /^static-src\/(index\.html|main\.ts)$/,
    /^scripts\/(smoke-(static|stats|rooms)|test-ward-ui)\.mjs$/,
  ].some((pattern) => pattern.test(file)));
}
function candidateFiles() {
  const status = execute("git", ["status", "--porcelain"], clone);
  if (!status.ok) throw new Error("git status failed");
  return status.output.split("\n").filter((line) => /^( M|M |\?\?)/.test(line))
    .map((line) => line.slice(3).trim()).filter((file) => file !== "node_modules");
}
function changedLines(paths) {
  const diff = execute("git", ["diff", "--numstat"], clone);
  const tracked = diff.output.split("\n").reduce((n, line) => {
    const [added, removed] = line.split("\t");
    return n + (Number(added) || 0) + (Number(removed) || 0);
  }, 0);
  const untracked = paths.filter((file) => !existsSync(join(clone, file)) ? false :
    execute("git", ["ls-files", "--error-unmatch", file], clone).ok === false)
    .reduce((n, file) => n + readFileSync(join(clone, file), "utf8").split("\n").length, 0);
  return tracked + untracked;
}
function prepareClone() {
  if (!existsSync(join(clone, ".git"))) {
    const cloned = execute("git", ["clone", "--depth", "1", "--branch", "main", "--quiet",
      "https://github.com/SodoMita/HollowCreek.git", clone], root, 90_000);
    if (!cloned.ok) throw new Error(`Git clone failed: ${cloned.error}`);
  } else {
    const fetched = execute("git", ["fetch", "--depth", "1", "origin", "main"], clone, 90_000);
    if (!fetched.ok) throw new Error(`Git fetch failed: ${fetched.error}`);
  }
  const branch = `polish/agent-${Date.now()}`;
  if (!execute("git", ["checkout", "-B", branch, "origin/main"], clone).ok) throw new Error("Cannot prepare local polish branch");
  execute("git", ["clean", "-fdx", "-e", "node_modules"], clone);
  if (!existsSync(join(clone, "node_modules/next"))) {
    const installed = execute("npm", ["ci", "--no-audit", "--no-fund"], clone, 240_000,
      { ...agentEnv, DATABASE_URL: process.env.DATABASE_URL || "" });
    if (!installed.ok) throw new Error(`Dependency bootstrap failed: ${installed.error}`);
  }
  return branch;
}
function validate(paths) {
  const tasks = [
    ["npx", ["next", "typegen"]],
    ["npm", ["exec", "tsc", "--", "--noEmit", "--pretty", "false"]],
    ["npm", ["run", "lint"]],
    ["node", ["scripts/test-voice.mjs"]],
    ["node", ["scripts/test-voice-client.mjs"]],
    ["node", ["scripts/test-wards.mjs"]],
    ["node", ["scripts/test-ward-ui.mjs"]],
    ["npm", ["run", "build"]],
  ];
  if (paths.some((file) => file.startsWith("static-src/"))) tasks.unshift(["node", ["scripts/build-static.mjs"]]);
  for (const [bin, args] of tasks) {
    const result = execute(bin, args, clone, 300_000, { ...agentEnv,
      DATABASE_URL: process.env.DATABASE_URL || "", NEXT_TELEMETRY_DISABLED: "1" });
    if (!result.ok) throw new Error(`${bin} ${args.join(" ")} failed: ${result.output.slice(-1200)}`);
  }
}
async function onePass() {
  cycle++;
  report("preparing");
  const branch = prepareClone();
  const prompt = readFileSync(join(root, "scripts/polish-prompt.md"), "utf8") +
    "\nThis is iteration " + cycle + ". Work on ONE safe polish. Read Mayfly, post what you found, and leave any patch uncommitted for supervisor validation.";
  report("running", { branch });
  postMayfly(`Polish pass ${cycle} started on an isolated ${branch}. No live edits or major features.`);
  if (!existsSync(cli)) throw new Error("OpenCode executable not installed");
  const agent = execute(cli, ["run", "--standalone", "--auto", "--model", "opencode/mimo-v2.6-flash-free",
    "--agent", "build", prompt], clone, 540_000, agentEnv);
  if (!agent.ok) throw new Error(`OpenCode failed: ${agent.error} ${agent.output.slice(-650)}`);
  const paths = candidateFiles();
  if (!paths.length) {
    report("idle", { branch, result: "No safe change proposed" });
    postMayfly(`Pass ${cycle}: no safe polish proposed. Next pass in ${Math.round(interval / 60000)} minutes. Goodbye.`);
    return;
  }
  if (paths.length > 3 || !safePaths(paths) || changedLines(paths) > 110) {
    throw new Error(`Rejected out-of-scope patch (${paths.length} paths, ${changedLines(paths)} changed lines).`);
  }
  if (!execute("git", ["diff", "--check"], clone).ok) throw new Error("Whitespace errors in patch");
  report("validating", { branch, files: paths });
  validate(paths);
  const staged = execute("git", ["add", "--", ...paths, ...(paths.some((file) => file.startsWith("static-src/"))
    ? ["public/play/game.js", "public/play/index.html"] : [])], clone);
  if (!staged.ok) throw new Error("Cannot stage validated patch");
  const committed = execute("git", ["-c", "user.name=Hollow Creek Polisher", "-c", "user.email=polish@local",
    "commit", "-m", `Polish small UI issue (pass ${cycle})`], clone);
  if (!committed.ok) throw new Error("Cannot commit validated local patch");
  const sha = execute("git", ["rev-parse", "--short", "HEAD"], clone).output.trim();
  report("idle", { branch, commit: sha, files: paths, result: "Validated local-only patch" });
  postMayfly(`Pass ${cycle}: validated a small polish in local branch ${branch} (${sha}). Files: ${paths.join(", ")}. Typegen, TypeScript, lint, pure tests and production build passed. Not pushed or deployed. Goodbye.`);
}

process.on("SIGTERM", () => { report("stopped"); process.exit(0); });
process.on("SIGINT", () => { report("stopped"); process.exit(0); });
report("booting");
await prepareMayfly();
await pause(12_000); // Give the preview health check time to return before work starts.
for (;;) {
  try { await onePass(); }
  catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.replaceAll(channel, "[redacted]").replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]");
    report("error", { error: message.slice(0, 1800) });
    postMayfly(`Polish pass ${cycle} failed safely (no live change): ${message.slice(0, 550)}. Will retry. Goodbye.`);
  }
  await pause(interval);
}
