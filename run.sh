#!/usr/bin/env bash
# Turnkey QA recording: boot the app (if needed), record the composed desktop
# video with record.mjs, then stop anything it started.
#
#   QA_APP_DIR=<app worktree> QA_TARGET_PATH=/w/krafters-demo \
#   QA_TITLE="Dashboard · Current sprint" QA_OUT=out/foo.mp4 ./run.sh
#
# If QA_APP_ORIGIN is already reachable it is reused as-is. Otherwise a dev
# server is booted from QA_APP_DIR on a free port and torn down at the end.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
[ -f config.env ] && source config.env

mkdir -p out
QA_OUT="${QA_OUT:-out/qa-desktop.mp4}"
BOOTED_PID=""

cleanup() { [ -n "$BOOTED_PID" ] && kill "$BOOTED_PID" 2>/dev/null || true; }
trap cleanup EXIT

reachable() { curl -s -o /dev/null -m 2 "$1/signin" 2>/dev/null; }
http() { curl -s -o /dev/null -w '%{http_code}' -m 5 "$1/signin" 2>/dev/null; }

# Fast path: reuse a warm server (e.g. one started by ./serve.sh) on the default
# port so re-records and extra viewports never rebuild.
if [ -z "${QA_APP_ORIGIN:-}" ] && [ "$(http "http://localhost:${QA_PORT:-4399}")" = "200" ]; then
  QA_APP_ORIGIN="http://localhost:${QA_PORT:-4399}"
  echo "▸ reusing warm server at $QA_APP_ORIGIN (no rebuild)"
fi

if [ -z "${QA_APP_ORIGIN:-}" ]; then
  # Pick a free port and boot the app from QA_APP_DIR.
  [ -d "$QA_APP_DIR" ] || { echo "QA_APP_DIR not found: $QA_APP_DIR" >&2; exit 1; }
  PORT=""
  for p in 4321 4555 4811 4990 4123; do
    if ! lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then PORT="$p"; break; fi
  done
  [ -n "$PORT" ] || { echo "no free port found" >&2; exit 1; }
  QA_APP_ORIGIN="http://localhost:$PORT"
  echo "▸ booting app from $QA_APP_DIR on $QA_APP_ORIGIN"
  # IMPORTANT: record against a PRODUCTION build, not `pnpm dev`. Under Turbopack
  # dev the HMR websocket is intercepted by proxy.ts (its matcher doesn't exclude
  # it) and fails, so React never hydrates in headless Chromium — every click is a
  # no-op and the recording captures a dead page. `next build && next start`
  # hydrates deterministically. Override with QA_DEV=1 to force dev if ever needed.
  (
    cd "$QA_APP_DIR"
    # Make sure the worktree has its env (no-op once present / on the primary).
    pnpm setup:env >/dev/null 2>&1 || true
    if [ "${QA_DEV:-0}" = "1" ]; then
      exec pnpm dev --port "$PORT"
    else
      pnpm exec next build && exec pnpm exec next start --port "$PORT"
    fi
  ) >/tmp/qa-devserver.log 2>&1 &
  BOOTED_PID=$!
  echo "  dev server pid $BOOTED_PID — waiting for ready…"
  for _ in $(seq 1 60); do
    [ "$(reachable "$QA_APP_ORIGIN")" = "" ] || break
    sleep 1
  done
fi

[ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$QA_APP_ORIGIN/signin")" = "200" ] \
  || { echo "app not reachable at $QA_APP_ORIGIN" >&2; exit 1; }
echo "✓ app reachable at $QA_APP_ORIGIN"

export QA_APP_ORIGIN QA_OUT
echo "▸ recording → $QA_OUT"
node "${QA_SCENARIO:-examples/krafters/record.mjs}"
