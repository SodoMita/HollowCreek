#!/usr/bin/env bash
# Browser smokes MUST run against a production server: in this sandbox the
# turbopack dev server never completes React hydration (no effects, no API
# calls from client components; chunks 200, no console errors), while
# `next build && next start` hydrates fine. Usage: ./scripts/smoke-browser-prod.sh [port]
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-3105}"
DB="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5545/hollow}"
DATABASE_URL="$DB" npx next build
DATABASE_URL="$DB" npx next start -p "$PORT" > /tmp/smoke-prod-$PORT.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
BASE="http://127.0.0.1:$PORT"
for s in smoke-browser smoke-time-browser smoke-time-room-ui smoke-voice; do
  echo "=== $s"
  node "scripts/$s.mjs" "$BASE"
done
