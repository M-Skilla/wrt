import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { MspId, Role } from '@wrt/shared';
import { config } from '../config.js';

/** One identity from backend/wallet/index.json (written by network/scripts/register-identities.sh). */
export interface WalletIdentity {
  label: string;
  mspId: MspId;
  role: Role | null;
  entityId: string | null;
  service?: boolean;
}

export interface OrgPeer {
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCACert: string;
}

interface WalletIndex {
  identities: WalletIdentity[];
  orgs: Record<string, OrgPeer>;
}

let cached: WalletIndex | undefined;

export function walletIndex(): WalletIndex {
  if (!cached) {
    const file = path.join(config.walletDir, 'index.json');
    try {
      cached = JSON.parse(readFileSync(file, 'utf8')) as WalletIndex;
    } catch {
      throw new Error(`No wallet at ${file}. Run: cd network && ./network.sh registerIdentities`);
    }
  }
  return cached;
}

export function findIdentity(label: string): WalletIdentity | undefined {
  return walletIndex().identities.find((i) => i.label === label);
}

export function readCredentials(label: string): { cert: Buffer; key: Buffer } {
  const dir = path.join(config.walletDir, label);
  return { cert: readFileSync(path.join(dir, 'cert.pem')), key: readFileSync(path.join(dir, 'key.pem')) };
}

export function orgPeer(mspId: string): OrgPeer & { tlsCACertPem: Buffer } {
  const peer = walletIndex().orgs[mspId];
  if (!peer) throw new Error(`No peer configured for ${mspId}`);
  return { ...peer, tlsCACertPem: readFileSync(path.join(config.walletDir, peer.tlsCACert)) };
}
