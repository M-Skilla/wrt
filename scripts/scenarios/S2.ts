/** S2 inflated weight at minting (spec §8): 10,000 kg declared, 9,200 observed → auto MINT_MISMATCH → re-inspection → FRAUDULENT → warehouse suspended. */
import type { Deposit, Dispute, Warehouse } from '@wrt/shared';
import { ID, as } from '../lib/api.js';
import { attest, recordDeposit } from '../lib/flows.js';
import { check, evidence, expectError, isMain, main, note, step, title } from '../lib/run.js';

export async function s2(): Promise<void> {
  title('S2 · Inflated weight at minting (Reviewer 3)');
  const wh = await as(ID.reg).get<Warehouse>('/registry/warehouse/WH-002');
  if (wh.status === 'SUSPENDED') {
    await step('REG-01 reinstates WH-002 (left suspended by a previous S2 run)', () => as(ID.reg).post('/registry/warehouse/WH-002/status', { status: 'ACTIVE' }));
  }
  const deposit = await recordDeposit(ID.wh002, 'FRM-003', 'MAIZE', { grade: 'G1', netKg: 10000, moistureBp: 1300 });
  const att = await attest(deposit, { grade: 'G1', netKg: 9200, moistureBp: 1300 });
  check(att.outcome === 'MISMATCH_DISPUTED' && !att.receipt, `−8% weight gap: no receipt; ${att.dispute?.id} (MINT_MISMATCH) opened automatically`);
  const disputeId = att.dispute!.id;

  await expectError('REG-01 tries to rule before re-inspection', 'ILLEGAL_TRANSITION', () =>
    as(ID.reg).post(`/disputes/${disputeId}/resolve`, { outcome: 'FRAUDULENT', liability: 'WAREHOUSE', findings: 'x' }),
  );
  const { result: assigned } = await step('REG-01 triggers re-inspection draw', () =>
    as(ID.reg).post<{ dispute: Dispute; draw: { inspectorId: string; excluded: string[] } }>(`/disputes/${disputeId}/assign`),
  );
  const reinspector = assigned.draw.inspectorId;
  check(reinspector !== deposit.assignedInspectorId, `${reinspector} drawn; original ${deposit.assignedInspectorId} and conflicted INS-02 excluded`);
  await step(`${reinspector} re-inspects: 9,180 kg`, () =>
    as(ID.ins(reinspector)).post(`/disputes/${disputeId}/reinspection`, { observed: { grade: 'G1', netKg: 9180, moistureBp: 1300 }, evidence: [evidence('reinspection-s2')] }),
  );
  const { result } = await step('REG-01 rules FRAUDULENT, liability WAREHOUSE', () =>
    as(ID.reg).post<{ deposit: Deposit; warehouse: Warehouse }>(`/disputes/${disputeId}/resolve`, {
      outcome: 'FRAUDULENT',
      liability: 'WAREHOUSE',
      findings: 'Declared weight inflated by 8%; weighbridge ticket does not match the retained sample.',
      compensationTzs: 0,
    }),
  );
  check(result.deposit.status === 'REJECTED', 'deposit REJECTED; no receipt ever existed');
  check(result.warehouse.status === 'SUSPENDED' && result.warehouse.penaltyCount >= 1, `WH-002 SUSPENDED, penaltyCount ${result.warehouse.penaltyCount}`);
  await expectError('WH-002 tries to record another deposit while suspended', 'NOT_AUTHORISED', () =>
    as(ID.wh002).post('/deposits', { farmerId: 'FRM-003', commodity: 'MAIZE', declared: { grade: 'G1', netKg: 100, moistureBp: 1300 }, sampleSealNo: 'X' }),
  );
  note('WH-002 stays suspended; the next S2 run reinstates it first.');
}

if (isMain(import.meta.url)) await main('S2', s2);
