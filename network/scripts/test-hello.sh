#!/usr/bin/env bash
# Milestone 1 acceptance (spec §13): invoke and query work from each org,
# and a write endorsed by a single org is rejected.
set -euo pipefail
source "$(dirname "$0")/env.sh"

CC=${1:-hello}
orderer_args=(-o "$ORDERER_ADDRESS" --ordererTLSHostnameOverride "$ORDERER_HOST" --tls --cafile "$ORDERER_CA")
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*" >&2; exit 1; }

echo "== 1. Each org invokes Put, endorsed by itself + the next two orgs (3 of 4)"
n=${#ALL_ORGS[@]}
for i in "${!ALL_ORGS[@]}"; do
  org=${ALL_ORGS[$i]}
  endorsers=("$org" "${ALL_ORGS[$(((i + 1) % n))]}" "${ALL_ORGS[$(((i + 2) % n))]}")
  set_org "$org"
  # shellcheck disable=SC2046
  peer chaincode invoke "${orderer_args[@]}" -C "$CHANNEL_NAME" -n "$CC" \
    $(peer_conn_args "${endorsers[@]}") --waitForEvent \
    -c "{\"function\":\"Put\",\"Args\":[\"hello-$org\",\"written by $(org_msp "$org")\"]}" 2>&1 | tail -1
  pass "$org invoke (endorsed by ${endorsers[*]})"
done

echo "== 2. Each org queries every key from its own peer"
for org in "${ALL_ORGS[@]}"; do
  set_org "$org"
  for key_org in "${ALL_ORGS[@]}"; do
    got=$(peer chaincode query -C "$CHANNEL_NAME" -n "$CC" -c "{\"function\":\"Get\",\"Args\":[\"hello-$key_org\"]}")
    [[ $got == "written by $(org_msp "$key_org")" ]] || fail "$org read hello-$key_org = '$got'"
  done
  pass "$org reads all 4 keys"
  echo "        WhoAmI: $(peer chaincode query -C "$CHANNEL_NAME" -n "$CC" -c '{"function":"WhoAmI","Args":[]}')"
done

echo "== 3. Tamper attempt: write endorsed by the Warehouse peer only"
set_org warehouse
# shellcheck disable=SC2046
if out=$(peer chaincode invoke "${orderer_args[@]}" -C "$CHANNEL_NAME" -n "$CC" \
    $(peer_conn_args warehouse) --waitForEvent \
    -c '{"function":"Put","Args":["hello-warehouse","tampered"]}' 2>&1); then
  fail "single-org write was accepted: $out"
fi
grep -q ENDORSEMENT_POLICY_FAILURE <<<"$out" || fail "rejected, but not for endorsement policy: $out"
pass "rejected with ENDORSEMENT_POLICY_FAILURE"

got=$(peer chaincode query -C "$CHANNEL_NAME" -n "$CC" -c '{"function":"Get","Args":["hello-warehouse"]}')
[[ $got == "written by WarehouseMSP" ]] || fail "state changed after rejected tx: '$got'"
pass "state unchanged after rejected tx"

echo "== Milestone 1 acceptance: all checks passed"
