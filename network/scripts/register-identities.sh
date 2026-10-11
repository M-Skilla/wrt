#!/usr/bin/env bash
# Milestone 2: registers the seed identities in identities.conf with their
# org's CA, carrying wrt.role / wrt.entityId as ecert attributes, enrolls them,
# and exports a wallet for the backend to backend/wallet/.
#
# Safe to re-run: existing registrations are reused, certs are re-issued.
set -euo pipefail
source "$(dirname "$0")/env.sh"

REPO_DIR="$(cd "$NETWORK_DIR/.." && pwd)"
WALLET_DIR="$REPO_DIR/backend/wallet"
CONF="$NETWORK_DIR/identities.conf"

ca_port() { case $1 in warehouse) echo 7054;; lender) echo 8054;; inspector) echo 9054;; regulator) echo 10054;; esac; }
role_short() { case $1 in warehouse_operator) echo operator;; lender_officer|regulator_officer) echo officer;; *) echo "$1";; esac; }

[[ -d "$ORGS_DIR/peerOrganizations" ]] || { echo "No crypto material: run ./network.sh up first" >&2; exit 1; }

rm -rf "$WALLET_DIR"
mkdir -p "$WALLET_DIR/tls"
entries=()

while read -r entity_id role org; do
  [[ -z ${entity_id:-} || $entity_id == \#* ]] && continue

  label="$(tr '[:upper:]' '[:lower:]' <<<"$entity_id")-$(role_short "$role")"
  domain="$org.wrt.local"
  org_dir="$ORGS_DIR/peerOrganizations/$domain"
  ca_tls="$ORGS_DIR/fabric-ca/$org/tls-cert.pem"
  ca_url="localhost:$(ca_port "$org")"
  msp_dir="$org_dir/users/$label@$domain/msp"
  secret="${label}pw"   # local-dev only

  # The CA bootstrap admin enrolled by enroll.sh lives in $org_dir/msp and acts as registrar.
  export FABRIC_CA_CLIENT_HOME="$org_dir"

  if fabric-ca-client identity list --id "$label" --caname "ca-$org" --tls.certfiles "$ca_tls" >/dev/null 2>&1; then
    echo "== $label already registered with ca-$org"
  else
    echo "== Registering $label ($role for $entity_id) with ca-$org"
    # ':ecert' puts the attribute into every enrollment certificate by default.
    fabric-ca-client register --caname "ca-$org" --tls.certfiles "$ca_tls" \
      --id.name "$label" --id.secret "$secret" --id.type client \
      --id.attrs "wrt.role=$role:ecert,wrt.entityId=$entity_id:ecert"
  fi

  # Fresh folder each time, so keystore/ never holds a key from an older enrollment.
  rm -rf "$msp_dir"
  fabric-ca-client enroll -u "https://$label:$secret@$ca_url" --caname "ca-$org" \
    -M "$msp_dir" --tls.certfiles "$ca_tls" >/dev/null 2>&1
  cp "$org_dir/msp/config.yaml" "$msp_dir/config.yaml"

  # Wallet entry: just the cert and key. The attributes travel inside the cert.
  mkdir -p "$WALLET_DIR/$label"
  cp "$msp_dir/signcerts/cert.pem" "$WALLET_DIR/$label/cert.pem"
  cp "$msp_dir"/keystore/*_sk "$WALLET_DIR/$label/key.pem"
  chmod 600 "$WALLET_DIR/$label/key.pem"

  entries+=("$(jq -nc --arg label "$label" --arg mspId "$(org_msp "$org")" \
    --arg role "$role" --arg entityId "$entity_id" '{label: $label, mspId: $mspId, role: $role, entityId: $entityId}')")
done < "$CONF"

# Per-org peer connection details, so the backend can reach each identity's own org peer.
orgs_json='{}'
for org in "${ALL_ORGS[@]}"; do
  cp "$(org_peer_tls_ca "$org")" "$WALLET_DIR/tls/$org-ca.crt"
  orgs_json=$(jq -c --arg msp "$(org_msp "$org")" --arg ep "localhost:$(org_port "$org")" \
    --arg alias "peer0.$org.wrt.local" --arg tls "tls/$org-ca.crt" \
    '. + {($msp): {peerEndpoint: $ep, peerHostAlias: $alias, tlsCACert: $tls}}' <<<"$orgs_json")
done

printf '%s\n' "${entries[@]}" | jq -s --argjson orgs "$orgs_json" \
  '{identities: ., orgs: $orgs}' > "$WALLET_DIR/index.json"

echo "== Wallet written to $WALLET_DIR (${#entries[@]} identities)"
