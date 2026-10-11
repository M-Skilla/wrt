#!/usr/bin/env bash
# Registers and enrolls node, Admin and User1 identities with each org's CA,
# and assembles the MSP / TLS folders under network/organizations/.
#
# Layout produced (per peer org, e.g. warehouse):
#   organizations/peerOrganizations/warehouse.wrt.local/
#     msp/                                  org MSP (what configtx.yaml points at)
#     peers/peer0.warehouse.wrt.local/{msp,tls}
#     users/{Admin,User1}@warehouse.wrt.local/msp
#
# Seed identities with wrt.role / wrt.entityId attributes are milestone 2
# (network.sh registerIdentities), not this script.
set -euo pipefail

NETWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ORGS_DIR="$NETWORK_DIR/organizations"
export PATH="$NETWORK_DIR/.fabric/bin:$PATH"

# Writes the NodeOU config so certs with OU=peer / admin / client / orderer
# are recognised as those roles. Endorsement policies like 'WarehouseMSP.peer'
# depend on this.
write_nodeou_config() {
  local msp_dir=$1 ca_file=$2
  cat > "$msp_dir/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/$ca_file
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/$ca_file
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/$ca_file
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/$ca_file
    OrganizationalUnitIdentifier: orderer
EOF
}

# Waits until the CA has written its TLS cert (it does so on first start).
wait_for_ca() {
  local tls_cert=$1
  for _ in $(seq 1 30); do
    [[ -f $tls_cert ]] && return 0
    sleep 1
  done
  echo "CA did not start: $tls_cert missing" >&2
  exit 1
}

# enroll_org <short> <domain> <ca-port> <node-type peer|orderer> <node-host>
enroll_org() {
  local short=$1 domain=$2 port=$3 node_type=$4 node_host=$5
  local ca_name="ca-$short"
  local ca_url="localhost:$port"
  local ca_tls="$ORGS_DIR/fabric-ca/$short/tls-cert.pem"
  local ca_file="localhost-$port-$ca_name.pem"

  local org_dir node_dir
  if [[ $node_type == orderer ]]; then
    org_dir="$ORGS_DIR/ordererOrganizations/$domain"
    node_dir="$org_dir/orderers/$node_host"
  else
    org_dir="$ORGS_DIR/peerOrganizations/$domain"
    node_dir="$org_dir/peers/$node_host"
  fi

  echo "== Enrolling $domain (CA $ca_url)"
  wait_for_ca "$ca_tls"
  mkdir -p "$org_dir"
  export FABRIC_CA_CLIENT_HOME="$org_dir"

  # 1. CA bootstrap admin: needed to register everyone else.
  fabric-ca-client enroll -u "https://admin:adminpw@$ca_url" --caname "$ca_name" --tls.certfiles "$ca_tls"

  # 2. Org MSP: CA cert for identity, TLS CA cert for TLS, plus NodeOUs.
  mkdir -p "$org_dir/msp/cacerts" "$org_dir/msp/tlscacerts"
  cp "$ORGS_DIR/fabric-ca/$short/ca-cert.pem" "$org_dir/msp/cacerts/$ca_file"
  cp "$ORGS_DIR/fabric-ca/$short/ca-cert.pem" "$org_dir/msp/tlscacerts/ca.crt"
  write_nodeou_config "$org_dir/msp" "$ca_file"

  # 3. Register identities. --id.type becomes the OU in the issued cert.
  local node_name=${node_host%%.*}   # peer0 / orderer
  fabric-ca-client register --caname "$ca_name" --id.name "$node_name" --id.secret "${node_name}pw" \
    --id.type "$node_type" --tls.certfiles "$ca_tls"
  fabric-ca-client register --caname "$ca_name" --id.name "${short}admin" --id.secret "${short}adminpw" \
    --id.type admin --tls.certfiles "$ca_tls"
  if [[ $node_type == peer ]]; then
    fabric-ca-client register --caname "$ca_name" --id.name user1 --id.secret user1pw \
      --id.type client --tls.certfiles "$ca_tls"
  fi

  # 4. Node identity (MSP) and node TLS cert. The TLS cert lists both the
  #    container hostname and localhost, so host-side CLIs can connect too.
  fabric-ca-client enroll -u "https://$node_name:${node_name}pw@$ca_url" --caname "$ca_name" \
    -M "$node_dir/msp" --tls.certfiles "$ca_tls"
  cp "$org_dir/msp/config.yaml" "$node_dir/msp/config.yaml"

  fabric-ca-client enroll -u "https://$node_name:${node_name}pw@$ca_url" --caname "$ca_name" \
    -M "$node_dir/tls" --enrollment.profile tls --csr.hosts "$node_host" --csr.hosts localhost \
    --tls.certfiles "$ca_tls"
  cp "$node_dir"/tls/tlscacerts/* "$node_dir/tls/ca.crt"
  cp "$node_dir"/tls/signcerts/* "$node_dir/tls/server.crt"
  cp "$node_dir"/tls/keystore/* "$node_dir/tls/server.key"

  # 5. Org Admin (signs channel joins, chaincode approvals) and User1.
  local admin_dir="$org_dir/users/Admin@$domain"
  fabric-ca-client enroll -u "https://${short}admin:${short}adminpw@$ca_url" --caname "$ca_name" \
    -M "$admin_dir/msp" --tls.certfiles "$ca_tls"
  cp "$org_dir/msp/config.yaml" "$admin_dir/msp/config.yaml"

  if [[ $node_type == peer ]]; then
    local user_dir="$org_dir/users/User1@$domain"
    fabric-ca-client enroll -u "https://user1:user1pw@$ca_url" --caname "$ca_name" \
      -M "$user_dir/msp" --tls.certfiles "$ca_tls"
    cp "$org_dir/msp/config.yaml" "$user_dir/msp/config.yaml"
  fi
}

enroll_org warehouse warehouse.wrt.local 7054  peer    peer0.warehouse.wrt.local
enroll_org lender    lender.wrt.local    8054  peer    peer0.lender.wrt.local
enroll_org inspector inspector.wrt.local 9054  peer    peer0.inspector.wrt.local
enroll_org regulator regulator.wrt.local 10054 peer    peer0.regulator.wrt.local
enroll_org orderer   wrt.local           11054 orderer orderer.wrt.local

echo "== All identities enrolled"
