// The floating state marker above an unfinished ward: a diamond, a status label
// (hidden while glass is up), and a progress bar once work has started.
import { MEETING_HOUSE } from "../units";
import type { Station, TaskView } from "../types";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";

export function drawMarker(
  f: Frame, env: DrawEnv, st: Station, task: TaskView, supplied: boolean, x: number,
) {
  const { ctx, ground, t, glassUp } = f;
  const bob = Math.sin(t * 3 + st.x) * 4;
  // The meeting house sign hangs beside the belfry, not above the spire: the spire tip is off-screen at the default zoom.
  const markerY = ground - (st.kind === "chapel" ? MEETING_HOUSE.wallHeight + MEETING_HOUSE.roofRise + MEETING_HOUSE.towerBase - 18 : 235);
  ctx.save();
  ctx.fillStyle = supplied ? "#b3d59a" : task.sabotaged ? "#d87762" : "#ffcd5a";
  ctx.shadowColor = supplied ? "#729a65" : "#ffcd5a"; env.glow(ctx, 8);
  ctx.translate(x, markerY + bob);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-7, -7, 14, 14);
  ctx.restore();
  if (!glassUp) {
    ctx.save();
    ctx.fillStyle = "rgba(12,8,16,.78)";
    ctx.fillRect(x - 48, markerY - 24, 96, 16);
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = supplied ? "#b3d59a" : task.sabotaged ? "#d87762" : "#ffcd5a";
    ctx.fillText(supplied ? "PUZZLE" : task.sabotaged ? "SABOTAGED" : "NEEDS KIT", x, markerY - 12);
    ctx.restore();
  }
  if (task.progress > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x - 30, markerY + 20, 60, 8);
    ctx.fillStyle = "#ffcd5a";
    ctx.fillRect(x - 29, markerY + 21, 58 * task.progress, 6);
  }
}
