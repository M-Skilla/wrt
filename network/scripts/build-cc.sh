#!/usr/bin/env bash
# Builds chaincode/wrt and stages a clean copy for `peer lifecycle chaincode package`:
# package.json (runtime deps only), dist/ and META-INF/ (CouchDB indexes).
# pnpm's node_modules is symlinks, and Fabric runs its own `npm install` anyway.
set -euo pipefail
NETWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CC_DIR="$NETWORK_DIR/../chaincode/wrt"
STAGE="$NETWORK_DIR/channel-artifacts/cc-src/wrt"

(cd "$CC_DIR" && pnpm run build >/dev/null)
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp -r "$CC_DIR/dist" "$CC_DIR/META-INF" "$STAGE/"
jq '{name, version, description, main, engines, scripts: {start: .scripts.start}, dependencies}' "$CC_DIR/package.json" > "$STAGE/package.json"
echo "$STAGE"
