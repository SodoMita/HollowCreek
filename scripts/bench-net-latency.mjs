// Compatibility entry point. The old probe measured received messages, not
// actual drawn coordinates, and incorrectly called two unchanged frames a STOP.
// bench-motion instruments Renderer.render and checks authoritative values,
// real stopping state, frame spacing, reloads, and optional SSE cuts/blocking.
// BASE=http://127.0.0.1:3100 ONE_WAY_MS=50 JITTER_MS=20 node scripts/bench-net-latency.mjs
// BLOCK_SSE=1 / DISCONNECT_MS=2600 / BYTES_PER_SEC=32768 enable fault cases.
import "./bench-motion.mjs";
