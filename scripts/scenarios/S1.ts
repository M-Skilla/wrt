/** S1 happy path (spec §8): deposit → attest → issue → WRRB → offer → accept → fund (auto-disburse) → repay → auto lien release → withdraw. */
import type { Loan, WarehouseReceipt } from '@wrt/shared';
import { ID, as } from '../lib/api.js';
import { MAIZE_G1, activeLoan, attest, recordDeposit } from '../lib/flows.js';
import { check, isMain, main, step, title } from '../lib/run.js';

export async function s1(): Promise<void> {
  title('S1 · Happy path: core flow and escrow automation');
  const deposit = await recordDeposit(ID.wh001, 'FRM-001', 'MAIZE', { ...MAIZE_G1, netKg: 12450, moistureBp: 1300 });
  const minted = await attest(deposit, { grade: 'G1', netKg: 12400, moistureBp: 1320 });
  check(minted.outcome === 'MINTED' && minted.receipt?.status === 'ISSUED', `receipt ${minted.receipt?.id} minted with the inspector's 12,400 kg, ISSUED, PENDING_WRRB`);
  const receiptId = minted.receipt!.id;

  await step(`REG-01 records WRRB number`, () => as(ID.reg).post(`/receipts/${receiptId}/wrrb`, { wrrbReceiptNo: `WRRB/DOD/S1/${receiptId.slice(-6)}` }));
  const loanId = await activeLoan(ID.bank, ID.frm001, receiptId, 6_000_000, 30 * 86_400);
  const view = await as(ID.bank).get<{ loan: Loan; escrow: { balanceTzs: number } }>(`/loans/${loanId}`);
  check(view.loan.status === 'ACTIVE' && view.loan.disbursementConditions.every((c) => c.passed), 'loan ACTIVE; all 6 disbursement conditions passed');

  await step('FRM-001 repays 2,000,000 (held in escrow)', () => as(ID.frm001).post(`/loans/${loanId}/repay`, { amountTzs: 2_000_000, paymentRef: 'MPESA-SIM-S1-1' }));
  const { result } = await step('FRM-001 repays the remaining 4,540,000', () =>
    as(ID.frm001).post<{ loan: Loan }>(`/loans/${loanId}/repay`, { amountTzs: 4_540_000, paymentRef: 'MPESA-SIM-S1-2' }),
  );
  check(result.loan.status === 'REPAID', 'loan REPAID automatically; RELEASE_TO_LENDER written');
  const receipt = (await as(ID.frm001).get<{ receipt: WarehouseReceipt }>(`/receipts/${receiptId}`)).receipt;
  check(receipt.status === 'ISSUED' && !receipt.lien, 'lien lifted automatically; receipt back to ISSUED');

  await step('FRM-001 requests withdrawal', () => as(ID.frm001).post(`/receipts/${receiptId}/withdrawal`));
  const { result: redeemed } = await step('WH-001 confirms release with gate pass', () =>
    as(ID.wh001).post<WarehouseReceipt>(`/receipts/${receiptId}/release`, { gatePassNo: 'GP-S1-0001' }),
  );
  check(redeemed.status === 'REDEEMED', 'receipt REDEEMED');
}

if (isMain(import.meta.url)) await main('S1', s1);
