import { createPrivateKey } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers, type Contract, type Gateway, type Network } from '@hyperledger/fabric-gateway';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import { findIdentity, orgPeer, readCredentials, type WalletIdentity } from './wallet.js';

/**
 * Connection pool (spec §11): one gRPC channel per org peer, shared by every
 * identity of that org; one Gateway per identity, created on first use.
 * Each identity talks to its own org's peer: a farmer goes through peer0.warehouse.
 */
const clients = new Map<string, grpc.Client>();
const gateways = new Map<string, Gateway>();

function clientFor(mspId: string): grpc.Client {
  let client = clients.get(mspId);
  if (!client) {
    const peer = orgPeer(mspId);
    const credentials = grpc.credentials.createSsl(peer.tlsCACertPem);
    // The peer's TLS cert names peer0.<org>.wrt.local; we dial localhost.
    client = new grpc.Client(peer.peerEndpoint, credentials, { 'grpc.ssl_target_name_override': peer.peerHostAlias });
    clients.set(mspId, client);
  }
  return client;
}

/** Demo identity header -> wallet identity. Unknown labels are rejected, never defaulted. */
export function resolveIdentity(label: string | undefined): WalletIdentity {
  if (!label) {
    throw new HttpError(401, 'NOT_AUTHORISED', 'Missing X-WRT-Identity header (pick a demo identity)');
  }
  const identity = findIdentity(label);
  if (!identity) {
    throw new HttpError(401, 'NOT_AUTHORISED', `Unknown demo identity "${label}"`);
  }
  return identity;
}

export function gatewayFor(label: string): Gateway {
  let gateway = gateways.get(label);
  if (!gateway) {
    const identity = resolveIdentity(label);
    const { cert, key } = readCredentials(label);
    gateway = connect({
      client: clientFor(identity.mspId),
      identity: { mspId: identity.mspId, credentials: cert },
      signer: signers.newPrivateKeySigner(createPrivateKey(key)),
      hash: hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
      submitOptions: () => ({ deadline: Date.now() + 5_000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
    });
    gateways.set(label, gateway);
  }
  return gateway;
}

export function networkFor(label: string): Network {
  return gatewayFor(label).getNetwork(config.channel);
}

export function contractFor(label: string): Contract {
  return networkFor(label).getContract(config.chaincode);
}

export function closeAll(): void {
  for (const g of gateways.values()) g.close();
  for (const c of clients.values()) c.close();
  gateways.clear();
  clients.clear();
}
