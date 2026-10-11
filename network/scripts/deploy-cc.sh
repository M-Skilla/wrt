#!/usr/bin/env bash
# Fabric 2.x chaincode lifecycle: package -> install x4 -> approve x4 -> commit.
#
# Usage: deploy-cc.sh -n <name> -p <path> [-v <version>] [-s <sequence>] [-c <collections.json>]
#   Re-deploying changed code: bump both -v and -s (sequence must increase by 1).
set -euo pipefail
source "$(dirname "$0")/env.sh"

CC_NAME="" CC_PATH="" CC_VERSION="1.0" CC_SEQUENCE="1" CC_COLLECTIONS=""
while getopts "n:p:v:s:c:" opt; do
  case $opt in
    n) CC_NAME=$OPTARG ;;
    p) CC_PATH=$OPTARG ;;
    v) CC_VERSION=$OPTARG ;;
    s) CC_SEQUENCE=$OPTARG ;;
    c) CC_COLLECTIONS=$OPTARG ;;
    *) echo "usage: $0 -n name -p path [-v version] [-s sequence] [-c collections.json]" >&2; exit 1 ;;
  esac
done
[[ -n $CC_NAME && -n $CC_PATH ]] || { echo "-n and -p are required" >&2; exit 1; }

# Spec §3.2: any 3 of the 4 org peers must endorse. No single org, including
# the warehouse holding the crop, can change state alone.
ENDORSEMENT_POLICY="OutOf(3,'WarehouseMSP.peer','LenderMSP.peer','InspectorMSP.peer','RegulatorMSP.peer')"

LABEL="${CC_NAME}_${CC_VERSION}"
PKG="$NETWORK_DIR/channel-artifacts/$LABEL.tar.gz"
mkdir -p "$NETWORK_DIR/channel-artifacts"

# Flags every org must use identically when approving and committing,
# otherwise they approve different definitions.
definition_args=(--channelID "$CHANNEL_NAME" --name "$CC_NAME" --version "$CC_VERSION"
  --sequence "$CC_SEQUENCE" --signature-policy "$ENDORSEMENT_POLICY")
[[ -n $CC_COLLECTIONS ]] && definition_args+=(--collections-config "$CC_COLLECTIONS")
orderer_args=(-o "$ORDERER_ADDRESS" --ordererTLSHostnameOverride "$ORDERER_HOST" --tls --cafile "$ORDERER_CA")

echo "== Packaging $LABEL from $CC_PATH"
peer lifecycle chaincode package "$PKG" --path "$CC_PATH" --lang node --label "$LABEL"
PACKAGE_ID=$(peer lifecycle chaincode calculatepackageid "$PKG")
echo "   package ID: $PACKAGE_ID"

for org in "${ALL_ORGS[@]}"; do
  set_org "$org"
  if peer lifecycle chaincode queryinstalled --output json | jq -e --arg id "$PACKAGE_ID" \
      '.installed_chaincodes // [] | any(.package_id == $id)' >/dev/null; then
    echo "== Already installed on peer0.$org"
  else
    echo "== Installing on peer0.$org (first install builds a Node image; this can take a few minutes)"
    peer lifecycle chaincode install "$PKG"
  fi
done

for org in "${ALL_ORGS[@]}"; do
  set_org "$org"
  echo "== $(org_msp "$org") approves the definition"
  peer lifecycle chaincode approveformyorg "${orderer_args[@]}" "${definition_args[@]}" --package-id "$PACKAGE_ID"
done

set_org warehouse
echo "== Commit readiness"
peer lifecycle chaincode checkcommitreadiness "${definition_args[@]}" --output json

echo "== Committing $CC_NAME (sequence $CC_SEQUENCE)"
# shellcheck disable=SC2046
peer lifecycle chaincode commit "${orderer_args[@]}" "${definition_args[@]}" $(peer_conn_args "${ALL_ORGS[@]}")

peer lifecycle chaincode querycommitted --channelID "$CHANNEL_NAME" --name "$CC_NAME"
echo "== $CC_NAME deployed"
