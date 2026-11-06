import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const dynamic = "force-dynamic";

// Must match scripts/polish-loop.mjs and src/server/polish-supervisor.ts.
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

export async function GET() {
  if (process.env.HOLLOW_POLISH_WORKER !== "1") {
    return Response.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const raw = JSON.parse(await readFile(join(polishBase(process.cwd()), "status.json"), "utf8")) as Record<string, unknown>;
    const pid = typeof raw.pid === "number" ? raw.pid : 0;
    let running = false;
    if (pid > 0) try { process.kill(pid, 0); running = true; } catch { /* stale pid */ }
    return Response.json({ enabled: true, running, cycle: raw.cycle ?? 0, phase: raw.phase ?? "starting",
      startedAt: raw.startedAt ?? null, updatedAt: raw.updatedAt ?? null,
      branch: raw.branch ?? null, commit: raw.commit ?? null, files: raw.files ?? [],
      result: raw.result ?? null, error: raw.error ?? null },
    { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ enabled: true, running: false, phase: "starting", cycle: 0 },
      { headers: { "Cache-Control": "no-store" } });
  }
}
