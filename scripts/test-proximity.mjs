// Proximity helpers: pure queries, no DB.
import { build } from "esbuild";
await build({ entryPoints: ["src/game/proximity.ts"], bundle: true, format: "esm", outfile: "/tmp/prox.mjs" });
const { inMeetingArea, nearestOccupiedCage, killTarget, stationNear } = await import("/tmp/prox.mjs");
const p = { id: "me", x: 500, inside: null, caged: false };
const caged = inMeetingArea({ x: 9999, inside: null, caged: true });
if (!caged) { console.error("FAIL caged counts as meeting area"); process.exit(1); }
const room = { cages: [{ x: 100, occupant: null }, { x: 200, occupant: "p2" }, { x: 900, occupant: "p3" }] };
if (nearestOccupiedCage(room, 210) !== 1) { console.error("FAIL cage pick", nearestOccupiedCage(room, 210)); process.exit(1); }
if (nearestOccupiedCage(room, 100 + 5000) !== -1) { console.error("FAIL out of range"); process.exit(1); }
const tRoom = { players: new Map([
  ["a", { id: "a", x: 500, inside: null, alive: true, role: "crew", temporalAbsent: false }],
  ["b", { id: "b", x: 520, inside: null, alive: true, role: "crew", temporalAbsent: false }],
  ["c", { id: "c", x: 530, inside: null, alive: true, role: "hollow", temporalAbsent: false }],
  ["d", { id: "d", x: 900, inside: null, alive: true, role: "crew", temporalAbsent: false }],
]), timeVisit: null };
const k = killTarget(tRoom, p);
if (!k || k.id !== "b") { console.error("FAIL killTarget nearest non-hollow", k?.id); process.exit(1); }
console.log("PROXIMITY_OK");
