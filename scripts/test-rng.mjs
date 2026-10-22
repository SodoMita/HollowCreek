// Distribution test for the Fisher-Yates shuffle used for role assignment.
import { build } from "esbuild";
await build({ entryPoints: ["src/game/rng.ts"], bundle: true, format: "esm", outfile: "/tmp/rng.mjs" });
const { shuffle, randInt } = await import("/tmp/rng.mjs");
const N = 40000, seats = 4, counts = Array(seats).fill(0);
for (let i = 0; i < N; i++) counts[shuffle([0, 1, 2, 3])[0]]++;
const expect = N / seats;
console.log("first-seat (Hollow) counts over", N, "shuffles:", counts, "expected ~", expect);
const chi2 = counts.reduce((a, c) => a + (c - expect) ** 2 / expect, 0);
console.log("chi-square:", chi2.toFixed(2), "(3 dof, p=0.001 critical = 16.27)");
if (chi2 > 16.27) { console.error("BIASED"); process.exit(1); }
const ri = Array(6).fill(0);
for (let i = 0; i < 60000; i++) ri[randInt(6)]++;
console.log("randInt(6):", ri, "expected ~10000 each");
console.log("RNG_UNIFORM_OK");
