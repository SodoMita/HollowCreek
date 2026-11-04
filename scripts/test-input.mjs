// canonicalInput whitelist: only known fields survive, lengths capped.
import { build } from "esbuild";
await build({ entryPoints: ["src/game/input.ts"], bundle: true, format: "esm", outfile: "/tmp/input.mjs" });
const { canonicalInput } = await import("/tmp/input.mjs");
const out = canonicalInput({
  playerId: "p1", dir: 1, chat: "  hello  ", action: "vote", vote: "abc",
  noteText: "x".repeat(500), wardId: "w".repeat(200), move: 2, targetAt: 5,
  interactHeld: true, cartHeld: false, evil: "<script>", dir2: 9,
});
const ok =
  out.playerId === "p1" && out.dir === 1 && out.chat === "hello" && out.action === "vote" &&
  out.vote === "abc" && out.noteText.length <= 260 && out.wardId.length === 128 &&
  out.move === 2 && out.targetAt === 5 && out.interactHeld === true && out.cartHeld === false &&
  !("evil" in out) && !("dir2" in out);
const bad = canonicalInput({ playerId: "p", action: "rm -rf /" });
if (bad.action !== undefined) { console.error("FAIL: unknown action passed through"); process.exit(1); }
if (!ok) { console.error("FAIL: canonicalization wrong", out); process.exit(1); }
console.log("CANONICAL_INPUT_OK");
