#!/usr/bin/env bash
# Milestone 2 acceptance (spec §13): chaincode can read wrt.role / wrt.entityId
# for every seed identity, and every wallet entry is a matching cert/key pair.
set -euo pipefail
source "$(dirname "$0")/env.sh"

CC=${1:-hello}
WALLET_DIR="$(cd "$NETWORK_DIR/.." && pwd)/backend/wallet"
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*" >&2; exit 1; }

[[ -f "$WALLET_DIR/index.json" ]] || fail "no wallet: run ./network.sh registerIdentities"

echo "== 1. Chaincode reads each identity's attributes (WhoAmI as that identity)"
while read -r label mspId role entityId; do
  org=$(tr '[:upper:]' '[:lower:]' <<<"${mspId%MSP}")
  set_org "$org" "$label"
  got=$(peer chaincode query -C "$CHANNEL_NAME" -n "$CC" -c '{"function":"WhoAmI","Args":[]}')
  want=$(jq -nc --arg m "$mspId" --arg r "$role" --arg e "$entityId" '{mspId: $m, role: $r, entityId: $e}')
  [[ $(jq -cS . <<<"$got") == $(jq -cS . <<<"$want") ]] || fail "$label: got $got, want $want"
  pass "$(printf '%-22s %-13s %-19s %s' "$label" "$mspId" "$role" "$entityId")"
done < <(jq -r '.identities[] | "\(.label) \(.mspId) \(.role) \(.entityId)"' "$WALLET_DIR/index.json")

echo "== 2. Org Admins carry no wrt.* attributes (they administer nodes, not business)"
set_org warehouse Admin
got=$(peer chaincode query -C "$CHANNEL_NAME" -n "$CC" -c '{"function":"WhoAmI","Args":[]}')
[[ $(jq -r '.role' <<<"$got") == null ]] || fail "Admin unexpectedly has a role: $got"
pass "Admin@warehouse has role null"

echo "== 3. Every wallet key matches its cert"
count=0
for dir in "$WALLET_DIR"/*/; do
  [[ -f $dir/cert.pem ]] || continue
  cert_pub=$(openssl x509 -in "$dir/cert.pem" -noout -pubkey)
  key_pub=$(openssl pkey -in "$dir/key.pem" -pubout)
  [[ $cert_pub == "$key_pub" ]] || fail "$(basename "$dir"): key does not match cert"
  count=$((count + 1))
done
pass "$count cert/key pairs match"

echo "== Milestone 2 acceptance: all checks passed"
