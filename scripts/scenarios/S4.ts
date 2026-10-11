/** S4 quality degradation during loan (spec §8): QC grade drop → margin call → disputed → STORAGE_NEGLIGENCE → compensation into escrow → cured. */
import type { Dispute, Escrow, Loan, WarehouseReceipt } from '@wrt/shared';
import { ID, as } from '../lib/api.js';
import { activeLoan, mintRegisteredReceipt } from '../lib/flows.js';
import { check, evidence, isMain, main, step, title } from '../lib/run.js';

export async function s4(): Promise<void> {
  title('S4 · Quality degradation during a loan (Reviewer 2)');
  const receipt = await mintRegisteredReceipt(ID.wh001, 'FRM-001');
  const loanId = await activeLoan(ID.bank, ID.frm001, receipt.id, 6_000_000, 30 * 86_400);

  const { result: requested } = await step('LND-BANK-01 requests a quality check', () => as(ID.bank).post<WarehouseReceipt>(`/receipts/${receipt.id}/quality-check`));
  const qcInspector = requested.pendingQualityCheck!.assignedInspectorId;
  const { result: qc } = await step(`${qcInspector} finds the grade dropped to G3`, () =>
    as(ID.ins(qcInspector)).post<{ loan: Loan }>(`/receipts/${receipt.id}/quality-check/result`, {
      observed: { grade: 'G3', netKg: 12400, moistureBp: 1520 },
      evidence: [evidence('qc-s4')],
    }),
  );
  check(qc.loan.status === 'MARGIN_CALL', `margin call raised: pay down ${qc.loan.marginCall?.requiredPaydownTzs.toLocaleString('en-US')} TZS`);

  const { result: dispute } = await step('FRM-001 disputes: the store roof leaked (QUALITY_DEGRADATION)', () =>
    as(ID.frm001).post<Dispute>('/disputes', { receiptId: receipt.id, type: 'QUALITY_DEGRADATION', claim: 'Water damage from a leaking roof in bay 3', evidence: [evidence('roof-photo')] }),
  );
  const { result: assigned } = await step('REG-01 triggers re-inspection draw', () =>
    as(ID.reg).post<{ draw: { inspectorId: string; excluded: string[] } }>(`/disputes/${dispute.id}/assign`),
  );
  check(!assigned.draw.excluded.includes(assigned.draw.inspectorId), `re-inspector ${assigned.draw.inspectorId}; excluded ${assigned.draw.excluded.join(', ')}`);
  await step(`${assigned.draw.inspectorId} confirms G3 and water damage`, () =>
    as(ID.ins(assigned.draw.inspectorId)).post(`/disputes/${dispute.id}/reinspection`, {
      observed: { grade: 'G3', netKg: 12400, moistureBp: 1520 },
      evidence: [evidence('reinspection-s4')],
    }),
  );
  const { result } = await step('REG-01 rules STORAGE_NEGLIGENCE: WH-001 pays 1,000,000 TZS compensation into escrow', () =>
    as(ID.reg).post<{ loan: Loan }>(`/disputes/${dispute.id}/resolve`, {
      outcome: 'STORAGE_NEGLIGENCE',
      liability: 'WAREHOUSE',
      findings: 'Roof leak in bay 3 not repaired after notice; warehouse liable under its bond.',
      compensationTzs: 1_000_000,
    }),
  );
  check(result.loan.status === 'ACTIVE', 'compensation restored LTV under the margin threshold: margin call cured');
  const escrow = (await as(ID.bank).get<{ escrow: Escrow }>(`/loans/${loanId}`)).escrow;
  check(escrow.entries.some((e) => e.type === 'COMPENSATION' && e.amountTzs === 1_000_000), 'COMPENSATION entry recorded in escrow against the warehouse bond');
}

if (isMain(import.meta.url)) await main('S4', s4);
