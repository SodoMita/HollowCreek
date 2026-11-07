// Street stations (ward repairs out of doors), the supply cart, and kits on the road.
import { drawKit, drawSupplyCart } from "../ward-art";
import { STATIONS } from "../types";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { drawStation } from "./station";

/** Outdoor stations. House work is painted as part of its interior, so it is skipped here. */
export function drawStations(f: Frame, env: DrawEnv) {
  const { w, cam } = f;
  for (const st of STATIONS) {
    if (st.inside) continue; // house work is painted as part of its interior
    const sx = st.x - cam;
    if (sx > -280 && sx < w + 280) drawStation(f, env, st, sx);
  }
}

/** The supply cart with its pushers' label, then any supply kits lying on the road. */
export function drawCartAndKits(f: Frame) {
  const { ctx, w, cam, ground, snap } = f;
  const cartScreenX = snap.cartX - cam;
  if (cartScreenX > -90 && cartScreenX < w + 90) {
    drawSupplyCart(ctx, cartScreenX, ground);
    if (snap.cartPushers > 0) {
      ctx.save();
      ctx.font = "bold 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#e9dfcf";
      ctx.fillText(`${snap.cartPushers} PUSHING`, cartScreenX, ground - 89);
      ctx.restore();
    }
  }
  for (const drop of snap.supplyDrops) {
    const sx = drop - cam;
    if (sx > -45 && sx < w + 45) drawKit(ctx, sx, ground);
  }
}
