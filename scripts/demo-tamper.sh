#!/usr/bin/env bash
# S6 tamper attempt (spec §8): the Warehouse org acting ALONE.
#
# The strongest thing a rogue warehouse can do without the other orgs is get its
# own peer, which it controls and could even run modified chaincode on, to
# endorse a write. Here WH-001's operator confirms the physical release of a
# receipt with only peer0.warehouse endorsing. The orderer orders it; every peer
# then marks it ENDORSEMENT_POLICY_FAILURE (1 of 4 < 3 of 4) and state is unchanged.
#
# Usage: scripts/demo-tamper.sh <receiptId>
# Prints one JSON line: {"txId": "...", "status": "...", "receiptId": "..."}
set -euo pipefail
RECEIPT_ID=${1:?usage: demo-tamper.sh <receiptId>}
NETWORK_DIR="$(cd "$(dirname "$0")/../network" && pwd)"
source "$NETWORK_DIR/scripts/env.sh"

set_org warehouse wh-001-operator
out=$(peer chaincode invoke -o "$ORDERER_ADDRESS" --ordererTLSHostnameOverride "$ORDERER_HOST" --tls --cafile "$ORDERER_CA" \
  -C "$CHANNEL_NAME" -n wrt $(peer_conn_args warehouse) --waitForEvent \
  -c "{\"function\":\"ReceiptContract:ConfirmRelease\",\"Args\":[\"$RECEIPT_ID\",\"GP-ROGUE-0001\"]}" 2>&1 || true)
out=$(sed -E 's/\x1b\[[0-9;]*m//g' <<<"$out")
tx=$(grep -oE 'txid \[[0-9a-f]+\]' <<<"$out" | head -1 | grep -oE '[0-9a-f]{64}' || true)
status=$(grep -oE 'committed with status \(\w+\)|transaction invalidated with status \(\w+\)' <<<"$out" | head -1 | grep -oE '\(\w+\)' | tr -d '()' || true)
if [[ -z $status ]]; then
  echo "$out" >&2
  status=UNKNOWN
fi
jq -nc --arg tx "$tx" --arg st "$status" --arg r "$RECEIPT_ID" '{txId: $tx, status: $st, receiptId: $r}'
