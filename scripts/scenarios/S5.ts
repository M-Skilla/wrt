/** S5 default & liquidation (spec §8): maturity passes unpaid → keeper defaults the loan → liquidation waterfall → surplus to farmer. */
import type { Loan, PolicyParams, WarehouseReceipt } from '@wrt/shared';
import { ID, anon, as } from '../lib/api.js';
import { activeLoan, mintRegisteredReceipt } from '../lib/flows.js';
import { check, isMain, main, note, step, title, wait } from '../lib/run.js';

export async function s5(): Promise<void> {
  title('S5 · Default and liquidation (escrow mechanics)');
  const policy = await as(ID.reg).get<PolicyParams>('/policy');
  if (!policy.demoMode) throw new Error('S5 needs demoMode on (maturity grace would be 14 days)');
  const grace = policy.demoDurations.maturityGraceSecs;
  const term = 60;

  const receipt = await mintRegisteredReceipt(ID.wh001, 'FRM-002');
  const loanId = await activeLoan(ID.bank, ID.frm002, receipt.id, 6_000_000, term);
  await step('FRM-002 repays 1,000,000, then stops paying', () => as(ID.frm002).post(`/loans/${loanId}/repay`, { amountTzs: 1_000_000, paymentRef: 'MPESA-SIM-S5' }));

  await wait(term + grace + 5, `term ${term}s + demo maturity grace ${grace}s`);
  const run = await step('keeper pass (the same job the backend runs every 30 s)', () => anon.post<{ submitted: { loanId: string; fn: string }[] }>('/keeper/run'));
  note(run.submitted.some((x) => x.loanId === loanId) ? `keeper submitted EvaluateLoan for ${loanId}` : 'the background keeper had already evaluated it');
  const loan = (await as(ID.bank).get<{ loan: Loan; receipt: WarehouseReceipt }>(`/loans/${loanId}`));
  check(loan.loan.status === 'DEFAULTED' && loan.receipt.status === 'DEFAULTED', 'loan and receipt DEFAULTED by the keeper');

  const { result } = await step('LND-BANK-01 records the crop sale: 8,000,000 TZS', () =>
    as(ID.bank).post<{ waterfall: { toLender: number; surplusToFarmer: number; shortfall: number } }>(`/loans/${loanId}/liquidate`, {
      saleProceedsTzs: 8_000_000,
      buyerRef: 'AUCTION-SIM-S5',
    }),
  );
  note(`waterfall: lender ${result.waterfall.toLender.toLocaleString('en-US')} from proceeds (+1,000,000 held), farmer surplus ${result.waterfall.surplusToFarmer.toLocaleString('en-US')}`);
  check(result.waterfall.toLender === 5_540_000 && result.waterfall.surplusToFarmer === 2_460_000, 'lender paid what is owed first; SURPLUS_TO_FARMER 2,460,000');
  const after = await as(ID.bank).get<{ loan: Loan; receipt: WarehouseReceipt }>(`/loans/${loanId}`);
  check(after.loan.status === 'LIQUIDATED' && after.receipt.status === 'LIQUIDATED', 'loan and receipt LIQUIDATED');
}

if (isMain(import.meta.url)) await main('S5', s5);
