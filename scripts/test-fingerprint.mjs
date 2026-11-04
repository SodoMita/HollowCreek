// Fingerprint/ETag behavior for the state route's 304 path.
import { build } from "esbuild";
await build({ entryPoints: ["src/game/fingerprint.ts"], bundle: true, format: "esm", outfile: "/tmp/fingerprint.mjs" });
const { fnv1a, snapshotEtag } = await import("/tmp/fingerprint.mjs");

const a = { now: 1000, players: [{ id: "p1", x: 42 }], phase: "playing" };
const b = { now: 9999, players: [{ id: "p1", x: 42 }], phase: "playing" };
const c = { now: 1000, players: [{ id: "p1", x: 43 }], phase: "playing" };

const ea = snapshotEtag(a);
if (snapshotEtag(b) !== ea) { console.error("FAIL: clock-only change must keep the same etag"); process.exit(1); }
if (snapshotEtag(c) === ea) { console.error("FAIL: real change must change the etag"); process.exit(1); }
if (ea !== snapshotEtag({ ...a })) { console.error("FAIL: etag must be deterministic"); process.exit(1); }
if (!/^"[0-9a-z]+"$/.test(ea)) { console.error("FAIL: etag format", ea); process.exit(1); }
if (fnv1a("") !== (0x811c9dc5).toString(36)) { console.error("FAIL: fnv1a empty-string vector"); process.exit(1); }
console.log("etag:", ea, "— clock-insensitive, change-sensitive, deterministic");
console.log("FINGERPRINT_OK");
