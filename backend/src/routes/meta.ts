import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { attachSseClient, recentEvents } from '../events.js';
import { HttpError } from '../fabric/errors.js';
import { explorerHeight, recentTxs, txById, txsInBlock } from '../fabric/explorer.js';
import { resolveIdentity } from '../fabric/gateway.js';
import { evaluate } from '../fabric/ledger.js';
import { walletIndex } from '../fabric/wallet.js';
import { lastKeeperRun, runKeeper } from '../keeper.js';
import { readUpload, storeUpload } from '../uploads.js';
import { who } from './common.js';
import { historyOf, maybe } from './derived.js';

const ENTITY_DOC: Record<string, string> = {
  warehouse_operator: 'warehouse',
  farmer: 'farmer',
  lender_officer: 'lender',
  inspector: 'inspector',
};

async function peerUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function metaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, height: explorerHeight() }));

  /** Demo identity picker (handoff screen 01). Service identities are not offered. */
  app.get('/identities', async () => walletIndex().identities.filter((i) => !i.service));

  /** Who am I: wallet entry, what the chaincode sees, my entity record and hosting tier. */
  app.get('/me', async (req) => {
    const label = who(req);
    const identity = resolveIdentity(label);
    const chaincodeView = await evaluate(label, 'QueryContract:WhoAmI');
    const docType = identity.role ? ENTITY_DOC[identity.role] : undefined;
    const entity = docType && identity.entityId ? await maybe(evaluate<Record<string, unknown>>(label, 'QueryContract:Get', [docType, identity.entityId])) : null;
    // Tier 2 = hosted member with no node of its own (spec §3.4).
    const tier = identity.role === 'farmer' || (entity && ['MFI', 'SACCO'].includes(String(entity.type))) ? 2 : 1;
    return { identity, chaincodeView, entity, hostingTier: tier };
  });

  /** Header ledger strip: channel, live block height, policy, peer health dots. */
  app.get('/network', async () => {
    const entries = await Promise.all(Object.entries(config.peerHealth).map(async ([msp, url]) => [msp, await peerUp(url)] as const));
    return { channel: config.channel, chaincode: config.chaincode, height: explorerHeight(), policy: '3 of 4', peers: Object.fromEntries(entries) };
  });

  // ---- live events (spec §2: chaincode events -> backend -> SSE -> UI)
  app.get('/events', (req, reply) => {
    const last = Number(req.headers['last-event-id'] ?? (req.query as { since?: string }).since ?? 0);
    attachSseClient(reply, Number.isFinite(last) ? last : 0);
  });
  app.get('/events/recent', async (req) => recentEvents(Number((req.query as { since?: string }).since ?? 0)).slice(-100).reverse());

  // ---- keeper
  app.get('/keeper', async () => ({ enabled: config.keeperEnabled, intervalMs: config.keeperIntervalMs, identity: config.keeperIdentity, lastRun: lastKeeperRun() ?? null }));
  app.post('/keeper/run', async () => runKeeper(app.log));

  // ---- evidence uploads: file off-chain, sha256 on-chain
  app.post('/uploads', async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT: no file uploaded');
    return storeUpload(await file.toBuffer(), file.filename);
  });
  app.get<{ Params: { sha256: string } }>('/uploads/:sha256', async (req, reply) => {
    const { data, file, verified } = readUpload(req.params.sha256);
    if (!verified) throw new HttpError(409, 'EVIDENCE_TAMPERED', `EVIDENCE_TAMPERED: ${file} no longer matches its on-chain hash`);
    const ext = file.split('.').pop() ?? '';
    const type: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', webp: 'image/webp' };
    return reply.header('Content-Type', type[ext] ?? 'application/octet-stream').header('X-Evidence-Verified', 'sha256').send(data);
  });

  // ---- block explorer (regulator screen 26): includes REJECTED transactions, which key history never shows
  app.get('/explorer/txs', async (req) => {
    const q = req.query as { limit?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 50), 500);
    const filter =
      q.status === 'rejected' ? (t: { validationCode: string }) => t.validationCode !== 'VALID' : q.status === 'valid' ? (t: { validationCode: string }) => t.validationCode === 'VALID' : undefined;
    return { height: explorerHeight(), txs: recentTxs(limit, filter) };
  });
  app.get<{ Params: { txId: string } }>('/explorer/tx/:txId', async (req) => {
    const tx = txById(req.params.txId);
    if (!tx) throw new HttpError(404, 'NOT_FOUND', `NOT_FOUND: no transaction ${req.params.txId}`);
    return tx;
  });
  app.get<{ Params: { n: string } }>('/explorer/blocks/:n', async (req) => ({ block: Number(req.params.n), txs: txsInBlock(Number(req.params.n)) }));

  /** Search by key ("receipt~WRT-WH001-000001" or a bare asset id), tx id, or block number. */
  app.get('/explorer/search', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (!q) throw new HttpError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT: q is required');
    if (/^\d+$/.test(q)) return { kind: 'block', block: Number(q), txs: txsInBlock(Number(q)) };
    const tx = txById(q);
    if (tx) return { kind: 'tx', tx };
    const label = who(req);
    const [docType, ...rest] = q.includes('~') ? q.split('~') : [guessDocType(q), q];
    const id = rest.join('~');
    if (!docType) throw new HttpError(404, 'NOT_FOUND', `NOT_FOUND: nothing matches "${q}"`);
    return { kind: 'key', key: `${docType}~${id}`, history: await historyOf(label, docType, id) };
  });
}

function guessDocType(id: string): string | undefined {
  if (id.startsWith('WRT-')) return 'receipt';
  if (id.startsWith('DEP-')) return 'deposit';
  if (id.startsWith('LN-')) return 'loan';
  if (id.startsWith('DSP-')) return 'dispute';
  if (id.startsWith('WH-')) return 'warehouse';
  if (id.startsWith('LND-')) return 'lender';
  if (id.startsWith('INS-')) return 'inspector';
  if (id.startsWith('FRM-')) return 'farmer';
  return undefined;
}
