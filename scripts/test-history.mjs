// frameAt binary search over sampled night history (pure, no DB).
import { build } from "esbuild";
await build({ entryPoints: ["src/game/history.ts"], bundle: true, format: "esm", outfile: "/tmp/history.mjs" });
const { frameAt, captureHistory } = await import("/tmp/history.mjs");
const mk = (at, seq) => ({ at, seq });
const room = { history: [mk(100, 1), mk(300, 2), mk(500, 3), mk(900, 4)], temporalShadow: false, phase: "playing", lastHistoryAt: 0 };
if (frameAt(room, 0)?.seq !== 1) { console.error("FAIL before-first"); process.exit(1); }
if (frameAt(room, 100)?.seq !== 1) { console.error("FAIL exact"); process.exit(1); }
if (frameAt(room, 450)?.seq !== 2) { console.error("FAIL mid", frameAt(room, 450)); process.exit(1); }
if (frameAt(room, 99999)?.seq !== 4) { console.error("FAIL after-last"); process.exit(1); }
if (frameAt({ history: [] }, 5) !== null) { console.error("FAIL empty"); process.exit(1); }
// captureHistory respects the sample interval and skips shadows
captureHistory(room, 200); // too soon (lastHistoryAt=0 -> 200 < 500) => skipped
if (room.history.length !== 4) { console.error("FAIL throttle"); process.exit(1); }
console.log("HISTORY_OK");
