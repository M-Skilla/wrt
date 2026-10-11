#!/usr/bin/env bash
# Creates wrt-channel: genesis block -> orderer joins (osnadmin) -> each peer joins.
set -euo pipefail
source "$(dirname "$0")/env.sh"

ARTIFACTS="$NETWORK_DIR/channel-artifacts"
BLOCK="$ARTIFACTS/$CHANNEL_NAME.block"
mkdir -p "$ARTIFACTS"

echo "== Generating genesis block for $CHANNEL_NAME"
FABRIC_CFG_PATH="$NETWORK_DIR" configtxgen -profile WRTChannel -outputBlock "$BLOCK" -channelID "$CHANNEL_NAME"

echo "== Orderer joins $CHANNEL_NAME"
osnadmin channel join --channelID "$CHANNEL_NAME" --config-block "$BLOCK" -o localhost:7053 \
  --ca-file "$ORDERER_CA" --client-cert "$ORDERER_ADMIN_CERT" --client-key "$ORDERER_ADMIN_KEY"

# Raft needs a moment to elect itself leader before peers can pull blocks.
for org in "${ALL_ORGS[@]}"; do
  set_org "$org"
  echo "== peer0.$org joins $CHANNEL_NAME"
  for attempt in 1 2 3 4 5; do
    if peer channel join -b "$BLOCK"; then break; fi
    [[ $attempt == 5 ]] && { echo "peer0.$org failed to join" >&2; exit 1; }
    sleep 2
  done
done

set_org warehouse
peer channel getinfo -c "$CHANNEL_NAME"
echo "== $CHANNEL_NAME created; all four peers joined"
