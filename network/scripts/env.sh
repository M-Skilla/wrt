#!/usr/bin/env bash
# Source this file, then call `set_org <warehouse|lender|inspector|regulator> [Admin|User1]`
# to make the host `peer` CLI act as that org's identity against its own peer.

NETWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORGS_DIR="$NETWORK_DIR/organizations"
export PATH="$NETWORK_DIR/.fabric/bin:$PATH"
export FABRIC_CFG_PATH="$NETWORK_DIR/.fabric/config"   # core.yaml for the peer CLI
export CORE_PEER_TLS_ENABLED=true

export CHANNEL_NAME=wrt-channel
export ORDERER_ADDRESS=localhost:7050
export ORDERER_HOST=orderer.wrt.local
export ORDERER_CA="$ORGS_DIR/ordererOrganizations/wrt.local/orderers/orderer.wrt.local/tls/ca.crt"
export ORDERER_ADMIN_CERT="$ORGS_DIR/ordererOrganizations/wrt.local/orderers/orderer.wrt.local/tls/server.crt"
export ORDERER_ADMIN_KEY="$ORGS_DIR/ordererOrganizations/wrt.local/orderers/orderer.wrt.local/tls/server.key"

ALL_ORGS=(warehouse lender inspector regulator)

org_msp()  { case $1 in warehouse) echo WarehouseMSP;; lender) echo LenderMSP;; inspector) echo InspectorMSP;; regulator) echo RegulatorMSP;; *) return 1;; esac; }
org_port() { case $1 in warehouse) echo 7051;; lender) echo 8051;; inspector) echo 9051;; regulator) echo 10051;; *) return 1;; esac; }
org_peer_tls_ca() { echo "$ORGS_DIR/peerOrganizations/$1.wrt.local/peers/peer0.$1.wrt.local/tls/ca.crt"; }

set_org() {
  local org=$1 user=${2:-Admin}
  local msp port
  msp=$(org_msp "$org") || { echo "unknown org: $org" >&2; return 1; }
  port=$(org_port "$org")
  export CORE_PEER_LOCALMSPID=$msp
  export CORE_PEER_ADDRESS=localhost:$port
  export CORE_PEER_TLS_ROOTCERT_FILE=$(org_peer_tls_ca "$org")
  export CORE_PEER_MSPCONFIGPATH="$ORGS_DIR/peerOrganizations/$org.wrt.local/users/$user@$org.wrt.local/msp"
}

# Prints --peerAddresses / --tlsRootCertFiles flags for the given orgs,
# used to collect endorsements from several peers in one invoke.
peer_conn_args() {
  local org
  for org in "$@"; do
    printf -- '--peerAddresses localhost:%s --tlsRootCertFiles %s ' "$(org_port "$org")" "$(org_peer_tls_ca "$org")"
  done
}
