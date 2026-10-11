/** S3 post-issuance grade challenge (spec §8): lender disputes grade → receipt frozen, loan clock paused → re-inspection → CORRECTED → LTV recomputed → margin call. */
import type { Dispute, Loan, WarehouseReceipt } from '@wrt/shared';
import { ID, as } from '../lib/api.js';
import { activeLoan, mintRegisteredReceipt } from '../lib/flows.js';
import { check, evidence, isMain, main, sleep, step, title } from '../lib/run.js';

export async function s3(): Promise<void> {
  title('S3 · Post-issuance grade challenge (Reviewer 3, disputes)');
  const receipt = await mintRegisteredReceipt(ID.wh001, 'FRM-002');
  const loanId = await activeLoan(ID.bank, ID.frm002, receipt.id, 6_000_000, 30 * 86_400);

  const { result: dispute } = await step('LND-BANK-01 disputes the grade (MINT_ACCURACY) with a lab report hash', () =>
    as(ID.bank).post<Dispute>('/disputes', { receiptId: receipt.id, type: 'MINT_ACCURACY', claim: 'Sample graded G3 by independent lab', evidence: [evidence('lab-report-s3')] }),
  );
  const frozen = await as(ID.bank).get<{ receipt: WarehouseReceipt; activeLoan: { loan: Loan } }>(`/receipts/${receipt.id}`);
  check(frozen.receipt.status === 'UNDER_DISPUTE', 'receipt frozen (UNDER_DISPUTE)');
  check(frozen.activeLoan.loan.pause?.disputeId === dispute.id, `loan clock paused by ${dispute.id}`);

  const { result: assigned } = await step('REG-01 triggers re-inspection draw', () => as(ID.reg).post<{ draw: { inspectorId: string } }>(`/disputes/${dispute.id}/assign`));
  await sleep(3_000); // a few seconds of frozen time
  await step(`${assigned.draw.inspectorId} re-inspects: G3`, () =>
    as(ID.ins(assigned.draw.inspectorId)).post(`/disputes/${dispute.id}/reinspection`, {
      observed: { grade: 'G3', netKg: 12400, moistureBp: 1340 },
      evidence: [evidence('reinspection-s3')],
    }),
  );
  const { result } = await step('REG-01 rules CORRECTED (liability WAREHOUSE)', () =>
    as(ID.reg).post<{ receipt: WarehouseReceipt; loan: Loan }>(`/disputes/${dispute.id}/resolve`, {
      outcome: 'CORRECTED',
      liability: 'WAREHOUSE',
      findings: 'Grade overstated at minting; amended to G3.',
      compensationTzs: 0,
    }),
  );
  check(result.receipt.grade === 'G3' && result.receipt.amendments.some((a) => a.disputeId === dispute.id), 'receipt amended G1 → G3, logged in amendments');
  check(result.receipt.status === 'PLEDGED', 'receipt unfrozen (PLEDGED)');
  check(result.loan.status === 'MARGIN_CALL', `LTV recomputed at G3 price → MARGIN_CALL, paydown ${result.loan.marginCall?.requiredPaydownTzs.toLocaleString('en-US')} TZS`);
  check(result.loan.pausedSecs > 0, `frozen time added to maturity: pausedSecs = ${result.loan.pausedSecs}`);
  void loanId;
}

if (isMain(import.meta.url)) await main('S3', s3);
