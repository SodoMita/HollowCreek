#!/usr/bin/env node
/**
 * Nyx's nightwatch critics.
 *
 * Runs the opencode subagent critic roster over the current branch and then a
 * deterministic audit that does not need a hosted model. The deterministic pass
 * is the gate: it fails the branch if the audio mixer, expanded map, keyed
 * houses, interiors or server-authority invariants disappear.
 *
 * Usage:
 *   node scripts/nightwatch-critics.mjs            # critics + audit
 *   node scripts/nightwatch-critics.mjs --audit    # audit only
 *
 * Model roster (override with NYX_CRITICS="provider/model,provider/model"):
 *   mimo, deepseek, big-pickle, glm-5.3
 * Models that cannot be reached (no provider key in the sandbox) are recorded
 * as skipped, not silently reported as passing.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ROSTER = (process.env.NYX_CRITICS ?? "mimo,deepseek,big-pickle,glm-5.3")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const KEY_ENVS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "MOONSHOT_API_KEY", "ZAI_API_KEY"];

const read = (path) => {
  try {
    return readFileSync(join(ROOT, path), "utf8");
  } catch {
    return "";
  }
};

const sources = {
  types: read("src/game/types.ts"),
  engine: read("src/game/engine.ts"),
  render: read("src/game/render.ts"),
  audio: read("src/game/audio.ts"),
  settings: read("src/game/settings.ts"),
  settingsUi: read("src/game/settings-ui.ts"),
  gameClient: read("src/app/room/[code]/GameClient.tsx"),
  notes: read("NYX-NOTES.md"),
};

const checks = [
  ["expanded world", /export const WORLD_W = 6400/.test(sources.types)],
  ["west and east wards", ["ferry", "orchard", "beacon", "quarry"].every((id) => sources.types.includes(`id: "${id}"`))],
  ["five keyed houses", (sources.types.match(/id: "(lodge|schoolhouse|cider|post|quarryoffice)"/g) ?? []).length === 5],
  ["two indoor wards", (sources.types.match(/inside: "(lodge|post)"/g) ?? []).length === 2],
  ["interior-aware reach", /stationReachable\(station, p\.inside/.test(sources.engine)],
  ["server door authority", /function useDoor/.test(sources.engine) && /function useLock/.test(sources.engine)],
  ["doors need the key", /if \(!p\.hasKey\) return \{ ok: false, error: `\$\{b\.name\} is locked/.test(sources.engine)],
  ["indoor movement bounds", /INTERIOR_HALF/.test(sources.engine) && /p\.inside = null/.test(sources.engine)],
  ["transparent walls in snapshot", /transparent: occupants > 0/.test(sources.engine)],
  ["cutaway renderer", /private drawBuilding/.test(sources.render) && /WALLS THIN/.test(sources.render)],
  ["music bus", /musicBus/.test(sources.audio)],
  ["ambience bus", /ambienceBus/.test(sources.audio)],
  ["effects bus", /effectsBus/.test(sources.audio)],
  ["sliders drive the graph", /applyMix/.test(sources.audio) && /store\.subscribe/.test(sources.audio)],
  ["mute is not hard-coded", !/muted \? 0 : 0\.85/.test(sources.audio)],
  ["adaptive score + heartbeat honoured", /adaptiveMusic/.test(sources.audio) && /audio\.heartbeat/.test(sources.audio)],
  ["settings dialog has all mixer channels", (sources.settingsUi.match(/audio\.(master|music|ambience|effects)/g) ?? []).length >= 4],
  ["lock binding exists", /lock: "KeyL"/.test(sources.settings) && /bound\("lock"\)/.test(sources.gameClient)],
  ["clients send intent, not positions", !/body\.x\b/.test(sources.engine) && /body\.action === "door"/.test(sources.engine)],
  ["no unfinished markers", !/\b(TODO|FIXME|XXX)\b/.test(Object.values(sources).join("\n"))],
];

const audit = checks.map(([name, pass]) => ({ name, pass: Boolean(pass) }));
const failures = audit.filter((c) => !c.pass);

const criticPrompt = `You are a terse senior reviewer for Hollow Creek, a server-authoritative multiplayer horror game.
Audit this diff for correctness bugs only, focusing on:
1. audio settings actually reaching WebAudio nodes,
2. doors/interiors not bypassing server authority or trapping players,
3. vision and win-condition regressions from the expanded map.
Diff:
${spawnSync("git", ["diff", "origin/main...HEAD", "--", "src/game", "src/app"], { cwd: ROOT, encoding: "utf8" }).stdout?.slice(0, 12000) ?? ""}
Return at most 6 bullet points.`;

const hasAnyKey = KEY_ENVS.some((key) => Boolean(process.env[key]));
const auditOnly = process.argv.includes("--audit");
const critics = [];
if (!auditOnly) {
  for (const model of ROSTER) {
    if (!hasAnyKey) {
      critics.push({ model, status: "skipped", reason: "no hosted provider key in sandbox" });
      continue;
    }
    const run = spawnSync("npx", ["opencode", "run", "--model", model, criticPrompt], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    critics.push({
      model,
      status: run.status === 0 ? "ok" : "skipped",
      output: (run.stdout || run.stderr || "").trim().slice(0, 2000) || undefined,
      reason: run.status === 0 ? undefined : `opencode exited ${run.status ?? "without status"}`,
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  branch: spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim(),
  roster: ROSTER,
  critics,
  deterministic: audit,
  failures: failures.map((c) => c.name),
  filesScanned: readdirSync(join(ROOT, "src/game")).filter((f) => f.endsWith(".ts")),
};
writeFileSync(join(ROOT, "critic-report.json"), JSON.stringify(report, null, 2));

console.log(`nightwatch critics · branch ${report.branch ?? "?"}`);
for (const c of critics) console.log(`  critic ${c.model.padEnd(12)} ${c.status}${c.reason ? ` — ${c.reason}` : ""}`);
for (const c of audit) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}`);
console.log(`\n${failures.length ? `${failures.length} deterministic failure(s)` : "all deterministic checks passed"} · report: critic-report.json`);
process.exit(failures.length ? 1 : 0);
