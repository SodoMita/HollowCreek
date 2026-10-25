// Long-running *isolated* OpenCode maintenance loop. Started by the live
// server's health route. It never edits /app, publishes to GitHub,
// uses a GitHub credential, or changes game mechanics.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as pause } from "node:timers/promises";

const root = process.env.HOLLOW_POLISH_ROOT || process.cwd();
let channel = process.env.HOLLOW_MAYFLY_URL || "";
if (!channel) {
  const channelFile = join(root, "scripts/mayfly-channel.txt");
  if (existsSync(channelFile)) {
    try { channel = readFileSync(channelFile, "utf8").trim(); } catch { /* ignore */ }
  }
}

const cli = join(root, "node_modules/.bin/opencode");
const clone = join(tmpdir(), "hollow-polish-work");
const statusPath = join(tmpdir(), "hollow-polish-status.json");
const clientPath = join(root, "scripts/mayfly-client.mjs");
const interval = Math.max(15_000, Number(process.env.HOLLOW_POLISH_INTERVAL_MS) || 60_000);
const begun = new Date().toISOString();
let cycle = 0;

// Preferred models in priority order: deepseek, mimo, big pickle
const PREFERRED_MODELS = [
  "opencode/deepseek-v4.1-flash-free",
  "opencode/mimo-v2.6-flash-free",
  "opencode/big-pickle",
];

const agentEnv = {
  PATH: process.env.PATH || "/usr/bin:/bin",
  HOME: join(tmpdir(), "hollow-polish-home"),
  LANG: "C.UTF-8",
  CI: "1",
  HOLLOW_MAYFLY_URL: channel,
  HOLLOW_MAYFLY_CLIENT: clientPath,
};
mkdirSync(agentEnv.HOME, { recursive: true });

const report = (phase, detail = {}) => {
  try {
    writeFileSync(
      statusPath,
      JSON.stringify(
        {
          enabled: true,
          pid: process.pid,
          startedAt: begun,
          updatedAt: new Date().toISOString(),
          cycle,
          phase,
          intervalMs: interval,
          ...detail,
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch { /* ignore */ }
};

function execute(command, args, cwd = root, timeout = 120_000, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, maxBuffer: 4_000_000 });
  return {
    ok: result.status === 0 && !result.error,
    output: `${result.stdout || ""}\n${result.stderr || ""}`.slice(-80_000),
    error: result.error?.message || (result.status === 0 ? "" : `exit ${result.status}`),
  };
}

function postMayfly(text) {
  if (!channel || !existsSync(clientPath)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = execute(process.execPath, [clientPath, channel, "read", "--last", "-1", "--wait", "0"], root, 22_000);
    if (!read.ok) return;
    let last;
    try { last = JSON.parse(read.output.trim()).last; } catch { return; }
    const posted = spawnSync(
      process.execPath,
      [clientPath, channel, "post", "--from", "Creek-Polisher", "--last", String(last), "--wait", "0"],
      { input: text, cwd: root, encoding: "utf8", timeout: 22_000 }
    );
    if (posted.status === 0 && posted.stdout?.includes('"posted":true')) return;
  }
}

function safePaths(paths) {
  return paths.every((file) =>
    [
      /^src\/app\/(page\.tsx|globals\.css|room\/\[code\]\/GameClient\.tsx|stats\/page\.tsx|chronicle\/\[code\]\/page\.tsx)$/,
      /^src\/game\/(ward-ui|settings-ui)\.ts$/,
      /^static-src\/(index\.html|main\.ts)$/,
      /^scripts\/(smoke-(static|stats|rooms|wards|cages)|test-ward-ui)\.mjs$/,
    ].some((pattern) => pattern.test(file))
  );
}

function candidateFiles() {
  const status = execute("git", ["status", "--porcelain"], clone);
  if (!status.ok) throw new Error("git status failed");
  return status.output
    .split("\n")
    .filter((line) => /^( M|M |\?\?)/.test(line))
    .map((line) => line.slice(3).trim())
    .filter((file) => file !== "node_modules");
}

function changedLines(paths) {
  const diff = execute("git", ["diff", "--numstat"], clone);
  const tracked = diff.output.split("\n").reduce((n, line) => {
    const [added, removed] = line.split("\t");
    return n + (Number(added) || 0) + (Number(removed) || 0);
  }, 0);
  const untracked = paths
    .filter((file) =>
      !existsSync(join(clone, file))
        ? false
        : execute("git", ["ls-files", "--error-unmatch", file], clone).ok === false
    )
    .reduce((n, file) => n + readFileSync(join(clone, file), "utf8").split("\n").length, 0);
  return tracked + untracked;
}

function prepareClone() {
  if (!existsSync(join(clone, ".git"))) {
    const cloned = execute(
      "git",
      ["clone", "--depth", "1", "--branch", "main", "--quiet", "https://github.com/SodoMita/HollowCreek.git", clone],
      root,
      90_000
    );
    if (!cloned.ok) throw new Error(`Git clone failed: ${cloned.error}`);
  } else {
    execute("git", ["fetch", "--depth", "1", "origin", "main"], clone, 90_000);
  }
  const branch = `polish/agent-${Date.now()}`;
  execute("git", ["checkout", "-B", branch, "origin/main"], clone);
  execute("git", ["reset", "--hard", "origin/main"], clone);
  execute("git", ["clean", "-fdx", "-e", "node_modules"], clone);

  if (!existsSync(join(clone, "node_modules"))) {
    if (existsSync(join(root, "node_modules"))) {
      spawnSync("ln", ["-sf", join(root, "node_modules"), join(clone, "node_modules")]);
    } else {
      execute("npm", ["ci", "--no-audit", "--no-fund"], clone, 240_000, {
        ...agentEnv,
        DATABASE_URL: process.env.DATABASE_URL || "",
      });
    }
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
    const result = execute(bin, args, clone, 300_000, {
      ...agentEnv,
      DATABASE_URL: process.env.DATABASE_URL || "",
      NEXT_TELEMETRY_DISABLED: "1",
    });
    if (!result.ok) throw new Error(`${bin} ${args.join(" ")} failed: ${result.output.slice(-1200)}`);
  }
}

async function onePass() {
  cycle++;
  report("preparing");
  const branch = prepareClone();
  const prompt =
    readFileSync(join(root, "scripts/polish-prompt.md"), "utf8") +
    "\nThis is iteration " +
    cycle +
    ". Work on ONE safe polish. Read Mayfly, post what you found, and leave any patch uncommitted for supervisor validation.";

  report("running", { branch });
  postMayfly(`Polish pass ${cycle} started on branch ${branch}. Models: deepseek -> mimo -> big pickle.`);

  if (!existsSync(cli)) throw new Error("OpenCode executable not installed");

  let agent = null;
  let usedModel = "";
  for (const model of PREFERRED_MODELS) {
    report("model_running", { branch, model });
    const runResult = execute(
      cli,
      ["run", "--standalone", "--auto", "--model", model, "--agent", "build", prompt],
      clone,
      300_000,
      agentEnv
    );
    if (runResult.ok) {
      agent = runResult;
      usedModel = model;
      break;
    }
    postMayfly(`Model ${model} in pass ${cycle} did not complete (${runResult.error}). Trying next preferred model.`);
  }

  if (!agent) throw new Error("All preferred models failed in this pass.");

  const paths = candidateFiles();
  if (!paths.length) {
    report("idle", { branch, model: usedModel, result: "No safe change proposed" });
    postMayfly(`Pass ${cycle} (${usedModel}): inspected codebase; no safe polish needed right now. Next loop in ${Math.round(interval / 1000)}s.`);
    return;
  }

  if (paths.length > 3 || !safePaths(paths) || changedLines(paths) > 110) {
    throw new Error(`Rejected out-of-scope patch (${paths.length} paths, ${changedLines(paths)} changed lines).`);
  }

  if (!execute("git", ["diff", "--check"], clone).ok) throw new Error("Whitespace errors in patch");

  report("validating", { branch, model: usedModel, files: paths });
  validate(paths);

  const staged = execute(
    "git",
    [
      "add",
      "--",
      ...paths,
      ...(paths.some((file) => file.startsWith("static-src/"))
        ? ["public/play/game.js", "public/play/index.html"]
        : []),
    ],
    clone
  );
  if (!staged.ok) throw new Error("Cannot stage validated patch");

  const committed = execute(
    "git",
    ["-c", "user.name=Hollow Creek Polisher", "-c", "user.email=polish@local", "commit", "-m", `Polish small UI issue (pass ${cycle})`],
    clone
  );
  if (!committed.ok) throw new Error("Cannot commit validated local patch");

  const sha = execute("git", ["rev-parse", "--short", "HEAD"], clone).output.trim();
  report("idle", { branch, model: usedModel, commit: sha, files: paths, result: "Validated local-only patch" });
  postMayfly(
    `Pass ${cycle} (${usedModel}): validated small polish in branch ${branch} (${sha}). Files: ${paths.join(
      ", "
    )}. Build & pure tests passed. Loop continuing in ${Math.round(interval / 1000)}s.`
  );
}

process.on("SIGTERM", () => {
  report("stopped");
  process.exit(0);
});
process.on("SIGINT", () => {
  report("stopped");
  process.exit(0);
});

report("booting");
await pause(6_000);

for (;;) {
  try {
    await onePass();
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.replaceAll(channel, "[redacted]").replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]");
    report("error", { error: message.slice(0, 1800) });
    postMayfly(`Polish pass ${cycle} notice: ${message.slice(0, 450)}. Retrying in ${Math.round(interval / 1000)}s.`);
  }
  await pause(interval);
}
