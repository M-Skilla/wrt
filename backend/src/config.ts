import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

/** Every value has a default that works against the local network. */
export const config = {
  port: Number(env.PORT ?? 3001),
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  walletDir: path.resolve(root, env.WALLET_DIR ?? './wallet'),
  uploadDir: path.resolve(root, env.UPLOAD_DIR ?? './uploads'),
  channel: env.CHANNEL ?? 'wrt-channel',
  chaincode: env.CHAINCODE ?? 'wrt',
  keeperEnabled: (env.KEEPER_ENABLED ?? 'true') === 'true',
  keeperIntervalMs: Number(env.KEEPER_INTERVAL_MS ?? 30_000),
  keeperIdentity: env.KEEPER_IDENTITY ?? 'keeper-svc',
  serviceIdentity: env.SERVICE_IDENTITY ?? 'reg-01-officer',
  /** Peer operations endpoints, for the header's peer-health dots. */
  peerHealth: {
    WarehouseMSP: env.PEER_OPS_WAREHOUSE ?? 'http://localhost:9444/healthz',
    LenderMSP: env.PEER_OPS_LENDER ?? 'http://localhost:9445/healthz',
    InspectorMSP: env.PEER_OPS_INSPECTOR ?? 'http://localhost:9446/healthz',
    RegulatorMSP: env.PEER_OPS_REGULATOR ?? 'http://localhost:9447/healthz',
  } as Record<string, string>,
};
