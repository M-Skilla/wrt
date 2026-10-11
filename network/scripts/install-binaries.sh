#!/usr/bin/env bash
# Downloads the Fabric CLI tools into network/.fabric/{bin,config}.
# Versions match the Docker images used in compose/, so the CLI and the
# nodes speak the same protocol.
set -euo pipefail

FABRIC_VERSION=2.5.16
CA_VERSION=1.5.17

NETWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$NETWORK_DIR/.fabric"

if [[ -x "$DEST/bin/peer" && -x "$DEST/bin/fabric-ca-client" ]]; then
  echo "Fabric tools already installed in $DEST"
  exit 0
fi

mkdir -p "$DEST"
base=https://github.com/hyperledger
echo "Downloading Fabric $FABRIC_VERSION tools..."
curl -fsSL "$base/fabric/releases/download/v$FABRIC_VERSION/hyperledger-fabric-linux-amd64-$FABRIC_VERSION.tar.gz" | tar -xz -C "$DEST"
echo "Downloading Fabric CA $CA_VERSION client..."
curl -fsSL "$base/fabric-ca/releases/download/v$CA_VERSION/hyperledger-fabric-ca-linux-amd64-$CA_VERSION.tar.gz" | tar -xz -C "$DEST"

"$DEST/bin/peer" version | head -2
"$DEST/bin/fabric-ca-client" version | head -2
