// Houses: the interior cutaway (drawn before the people) and the exterior walls,
// doors and barrels (drawn after the people inside, so occupied houses read as cut away).
import { BUILDINGS } from "../buildings";
import { drawHouseExterior, drawHouseInterior } from "../house-art";
import { drawSvg } from "../svg-assets";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { drawNote } from "./note";

/** House backdrops share the street's world coordinates. Occupied houses become a
 *  cutaway only after their occupants have been painted. Pages pinned on an
 *  interior wall are included here and are only visible to souls inside. */
export function drawHouseInteriors(f: Frame, env: DrawEnv) {
  const { ctx, w, t, cam, ground, snap, focusX } = f;
  for (const b of BUILDINGS) {
    const sx = b.x - cam;
    if (sx < -b.width || sx > w + b.width) continue;
    const occupied = snap.players.some((p) => p.inside === b.id && p.alive);
    drawHouseInterior(ctx, b, sx, ground, t, [...f.tasks.values()].find((task) => task.inside === b.id), occupied);
    for (const note of snap.notes ?? []) {
      if (note.house !== b.id) continue;
      const nx = note.x - cam;
      if (nx < -100 || nx > w + 100) continue;
      drawNote(ctx, nx, ground, "wall", focusX === note.x, t, note, env);
    }
  }
}

/** Exterior walls, doors, and the barrel and crate by each door. The door swings
 *  toward its open amount over time, tracked per house in `doorOpenAmount`. */
export function drawHouseExteriors(f: Frame, doorOpenAmount: Map<string, number>) {
  const { ctx, w, t, dt, cam, ground, snap, graphics } = f;
  for (const b of BUILDINGS) {
    const sx = b.x - cam;
    const occupied = snap.players.some((p) => p.inside === b.id && p.alive);
    if (sx > -b.width && sx < w + b.width) {
      const door = f.doors.get(b.id);
      const target = door?.open ? 1 : 0;
      const previous = doorOpenAmount.get(b.id) ?? target;
      const amount = graphics.reducedMotion ? target : previous + (target - previous) * Math.min(1, dt * 10);
      doorOpenAmount.set(b.id, amount);
      drawSvg(ctx, "furniture/barrel.svg", sx - b.width / 2 - 30, ground - 34, 26, 34);
      drawSvg(ctx, "furniture/crate.svg", sx + b.width / 2 + 8, ground - 26, 30, 26);
      drawHouseExterior(ctx, b, sx, ground, t, door, occupied, amount);
    }
  }
}
