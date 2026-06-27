#!/usr/bin/env bash
# Start a PERSISTENT production server for the app under test, so you can record
# (and re-record / multiple viewports) WITHOUT rebuilding each time — the big time
# sink. Build once here, then point record.mjs at QA_APP_ORIGIN and iterate fast.
#
#   QA_APP_DIR=<worktree> ./serve.sh           # build + start on :4399
#   QA_NO_BUILD=1 ./serve.sh                    # reuse existing .next, just start
#   QA_PORT=4555 ./serve.sh
#
# Re-records against the warm server:
#   QA_APP_ORIGIN=http://localhost:4399 QA_OUT=out/qa-desktop.mp4 node record.mjs
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
[ -f config.env ] && source config.env

PORT="${QA_PORT:-4399}"
ORIGIN="http://localhost:$PORT"

if curl -s -o /dev/null -m2 "$ORIGIN/signin" 2>/dev/null; then
  echo "✓ already serving at $ORIGIN — reuse it: QA_APP_ORIGIN=$ORIGIN node record.mjs"
  exit 0
fi

[ -d "$QA_APP_DIR" ] || { echo "QA_APP_DIR not found: $QA_APP_DIR" >&2; exit 1; }
cd "$QA_APP_DIR"
pnpm setup:env >/dev/null 2>&1 || true

if [ "${QA_NO_BUILD:-0}" != "1" ]; then
  echo "▸ building $QA_APP_DIR (prod) …"
  pnpm exec next build
fi

echo "▸ starting prod server on $ORIGIN"
nohup pnpm exec next start --port "$PORT" > /tmp/qa-prod-server.log 2>&1 &
PID=$!
echo "  pid $PID — log: /tmp/qa-prod-server.log"
for _ in $(seq 1 60); do
  curl -s -o /dev/null -m2 "$ORIGIN/signin" 2>/dev/null && break
  sleep 1
done
curl -s -o /dev/null -w '  ✓ ready (%{http_code}) — QA_APP_ORIGIN='"$ORIGIN"'\n' "$ORIGIN/signin"
