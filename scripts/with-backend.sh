#!/usr/bin/env bash
# Runs a command with the API available: reuses a running backend, or starts one
# for the duration of the command (so `make seed` works before `make dev`).
set -euo pipefail
API=${WRT_API:-http://localhost:3001}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
started=""
if ! curl -sf "$API/health" >/dev/null; then
  echo "== Starting backend for this command (KEEPER_ENABLED=false)"
  (cd "$ROOT/backend" && KEEPER_ENABLED=false LOG_LEVEL=warn pnpm exec tsx src/index.ts >"$ROOT/backend/.with-backend.log" 2>&1) &
  started=$!
  for _ in $(seq 1 60); do curl -sf "$API/health" >/dev/null && break; sleep 1; done
  curl -sf "$API/health" >/dev/null || { echo "backend did not start; see backend/.with-backend.log" >&2; exit 1; }
fi
cleanup() { [[ -n $started ]] && pkill -P "$started" 2>/dev/null; [[ -n $started ]] && kill "$started" 2>/dev/null || true; }
trap cleanup EXIT
"$@"
