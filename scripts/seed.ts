/**
 * Seeds the ledger through the API (spec §12 scripts/seed.ts):
 *   1. InitLedger with seed-data.json (warehouses, LND-BANK-01, inspectors, prices, policy)
 *   2. warehouse operators register FRM-001..004 (PII via transient data)
 *   --demo also builds sample state for the UI: receipts in several states, an
 *   active loan with repayments, a pending offer and a deposit awaiting attestation.
 * Safe to re-run: anything that already exists is skipped.
 */
import { readFileSync } from 'node:fs';
import { ApiError, ID, as } from './lib/api.js';
import { MAIZE_G1, activeLoan, mintRegisteredReceipt, recordDeposit, attest } from './lib/flows.js';
import { main, note, step, title } from './lib/run.js';

const seed = JSON.parse(readFileSync(new URL('./seed-data.json', import.meta.url), 'utf8'));

async function skipIfExists(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await step(label, fn);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'ALREADY_EXISTS') note(`${label}: already done`);
    else throw err;
  }
}

await main('seed', async () => {
  title('Seed: registry and farmers');
  await skipIfExists('REG-01 runs InitLedger (warehouses, bank, inspectors, prices, policy)', () => as(ID.reg).post('/init', seed));
  for (const f of seed._farmers as { farmerId: string; registeredBy: string; pii: object }[]) {
    await skipIfExists(`${f.registeredBy} registers ${f.farmerId} (PII as transient data)`, () => as(f.registeredBy).post('/farmers', { farmerId: f.farmerId, pii: f.pii }));
  }

  if (!process.argv.includes('--demo')) return;

  title('Seed --demo: sample state for the UI');
  const mfi = seed._onboarding['LND-MFI-01'];
  await skipIfExists('REG-01 onboards LND-MFI-01 (hosted MFI)', () => as(ID.reg).post('/lenders', mfi));

  // Pledged receipt with an active loan and two repayments (like LN-0042 in the handoff).
  const pledged = await mintRegisteredReceipt(ID.wh001, 'FRM-001', MAIZE_G1);
  const loanId = await activeLoan(ID.mfi, ID.frm001, pledged.id, 6_000_000, 120 * 86_400);
  await step('FRM-001 repays 1,000,000', () => as(ID.frm001).post(`/loans/${loanId}/repay`, { amountTzs: 1_000_000, paymentRef: 'MPESA-SIM-4520188' }));
  await step('FRM-001 repays 1,000,000', () => as(ID.frm001).post(`/loans/${loanId}/repay`, { amountTzs: 1_000_000, paymentRef: 'MPESA-SIM-4602231' }));

  // Unpledged, registered receipt: eligible collateral, with a pending offer to the farmer.
  const eligible = await mintRegisteredReceipt(ID.wh001, 'FRM-002', { grade: 'G1', netKg: 5000, moistureBp: 1280 });
  await step(`LND-BANK-01 offers 2,400,000 TZS against ${eligible.id} (pending)`, () =>
    as(ID.bank).post('/loans', { receiptId: eligible.id, principalTzs: 2_400_000, interestBp: 850, termSecs: 90 * 86_400 }),
  );

  // Another eligible receipt with no offer yet (sesame).
  await mintRegisteredReceipt(ID.wh001, 'FRM-002', { grade: 'G1', netKg: 2500, moistureBp: 750 }, 'SESAME');

  // WH-002: issued but waiting for WRRB registration.
  const dep = await recordDeposit(ID.wh002, 'FRM-003', 'PADDY', { grade: 'G2', netKg: 8000, moistureBp: 1350 });
  await attest(dep, { grade: 'G2', netKg: 7980, moistureBp: 1360 });

  // Deposit awaiting attestation (inspector queue).
  await recordDeposit(ID.wh001, 'FRM-002', 'CASHEW', { grade: 'G1', netKg: 2200, moistureBp: 800 });
});
