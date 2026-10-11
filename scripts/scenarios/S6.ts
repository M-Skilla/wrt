/** S6 tamper attempt (spec §8): a write endorsed only by the Warehouse peer is rejected; the UI shows the receipt's full history and the rejected attempt. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { WarehouseReceipt } from '@wrt/shared';
import { ID, as } from '../lib/api.js';
import { mintRegisteredReceipt } from '../lib/flows.js';
import { check, isMain, main, note, sleep, step, title } from '../lib/run.js';

const TAMPER = fileURLToPath(new URL('../demo-tamper.sh', import.meta.url));

export async function s6(): Promise<{ receiptId: string; txId: string }> {
  title('S6 · Tamper attempt: one org alone cannot write (tamper-evidence)');
  const receipt = await mintRegisteredReceipt(ID.wh001, 'FRM-001');
  await step('FRM-001 requests withdrawal (so a release would pass every chaincode check)', () => as(ID.frm001).post(`/receipts/${receipt.id}/withdrawal`));

  const attempt = await step('WH-001 submits ConfirmRelease endorsed ONLY by peer0.warehouse (scripts/demo-tamper.sh)', async () => {
    return JSON.parse(execFileSync(TAMPER, [receipt.id], { encoding: 'utf8' }).trim()) as { txId: string; status: string };
  });
  check(attempt.status === 'ENDORSEMENT_POLICY_FAILURE', `tx ${attempt.txId.slice(0, 12)}… ordered into a block, then rejected by every peer: ${attempt.status}`);

  const now = (await as(ID.reg).get<{ receipt: WarehouseReceipt }>(`/receipts/${receipt.id}`)).receipt;
  check(now.status === 'ISSUED' && !now.release, 'receipt unchanged: still ISSUED, no release recorded');

  let rejected: { txId: string; validationCode: string; endorsers: string[]; fn: string } | undefined;
  for (let i = 0; i < 20 && !rejected; i++) {
    const list = await as(ID.reg).get<{ txs: { txId: string; validationCode: string; endorsers: string[]; fn: string }[] }>('/explorer/txs?status=rejected&limit=200');
    rejected = list.txs.find((t) => t.txId === attempt.txId);
    if (!rejected) await sleep(500);
  }
  check(rejected?.validationCode === 'ENDORSEMENT_POLICY_FAILURE' && rejected.endorsers.join() === 'WarehouseMSP', 'explorer shows the rejected attempt: endorsed by WarehouseMSP only');

  const history = await as(ID.reg).get<{ txId: string; fn: string | null; endorsers: string[] }[]>(`/receipts/${receipt.id}/history`);
  check(!history.some((h) => h.txId === attempt.txId), `GetHistory: ${history.length} committed versions, none from the rejected tx`);
  for (const h of history) note(`v · ${h.fn ?? '?'} · ${h.txId.slice(0, 10)}… · endorsed ${h.endorsers.map((e) => e.replace('MSP', '')).join(' ')}`);
  return { receiptId: receipt.id, txId: attempt.txId };
}

if (isMain(import.meta.url)) await main('S6', async () => void (await s6()));
