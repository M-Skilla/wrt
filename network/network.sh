#!/usr/bin/env bash
# WRT Fabric network: four orgs + Raft orderer + one CA per org + CouchDB.
#
#   ./network.sh up                  start CAs, enroll identities, start orderer/peers/CouchDB
#   ./network.sh createChannel       create wrt-channel and join all four peers
#   ./network.sh deployCC [flags]    build and deploy chaincode/wrt (or: -n hello -p chaincode/hello)
#                                    flags: -n name -p path -v version -s sequence -c collections.json
#   ./network.sh testHello           milestone-1 acceptance check
#   ./network.sh registerIdentities  register seed identities (identities.conf) and write backend/wallet
#   ./network.sh testIdentities      milestone-2 acceptance check
#   ./network.sh seed                seed ledger data                         (later milestone)
#   ./network.sh down                stop everything and delete all generated state
set -euo pipefail

NETWORK_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$NETWORK_DIR/scripts"
CA_SERVICES=(ca.warehouse.wrt.local ca.lender.wrt.local ca.inspector.wrt.local ca.regulator.wrt.local ca.orderer.wrt.local)

export UID GID="${GID:-$(id -g)}"
compose() {
  docker compose -p wrt -f "$NETWORK_DIR/compose/compose-ca.yaml" -f "$NETWORK_DIR/compose/compose-net.yaml" "$@"
}

network_up() {
  "$SCRIPTS/install-binaries.sh"
  if [[ ! -d "$NETWORK_DIR/organizations/peerOrganizations" ]]; then
    echo "== Starting CAs"
    mkdir -p "$NETWORK_DIR/organizations/fabric-ca"/{warehouse,lender,inspector,regulator,orderer}
    compose up -d "${CA_SERVICES[@]}"
    "$SCRIPTS/enroll.sh"
  else
    echo "== Crypto material exists; reusing it (run ./network.sh down for a clean start)"
    compose up -d "${CA_SERVICES[@]}"
  fi
  echo "== Starting orderer, peers and CouchDB"
  compose up -d
  compose ps --format 'table {{.Name}}\t{{.Status}}'
}

network_down() {
  echo "== Stopping containers and removing volumes"
  compose down -v --remove-orphans
  # Chaincode containers/images are started by the peers, not by compose.
  # Match only WRT peers so other Fabric networks on this host are left alone.
  local cc_containers cc_images
  cc_containers=$(docker ps -aq --filter 'name=^dev-peer0\..*\.wrt\.local-' || true)
  [[ -n $cc_containers ]] && docker rm -f $cc_containers >/dev/null
  cc_images=$(docker images -q --filter 'reference=dev-peer0.*.wrt.local-*' || true)
  [[ -n $cc_images ]] && docker rmi -f $cc_images >/dev/null
  echo "== Deleting generated crypto material and channel artifacts"
  rm -rf "$NETWORK_DIR/organizations" "$NETWORK_DIR/channel-artifacts"
  # Wallet certs are signed by CAs that no longer exist after this.
  rm -rf "$NETWORK_DIR/../backend/wallet"
  echo "== Network is down"
}

deploy_cc() {
  if [[ $# -eq 0 ]]; then
    local stage
    stage=$("$SCRIPTS/build-cc.sh")
    set -- -n wrt -p "$stage" -c "$NETWORK_DIR/../chaincode/wrt/collections_config.json"
  fi
  "$SCRIPTS/deploy-cc.sh" "$@"
}

cmd=${1:-}
shift || true
case $cmd in
  up)                 network_up ;;
  down)               network_down ;;
  createChannel)      "$SCRIPTS/channel.sh" ;;
  deployCC)           deploy_cc "$@" ;;
  testHello)          "$SCRIPTS/test-hello.sh" "$@" ;;
  registerIdentities) "$SCRIPTS/register-identities.sh" ;;
  testIdentities)     "$SCRIPTS/test-identities.sh" "$@" ;;
  seed)               echo "seed is built after the chaincode exists (spec §13)" >&2; exit 1 ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
