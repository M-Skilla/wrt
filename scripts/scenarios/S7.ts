/** S7 hosted MFI onboarding (spec §8): Regulator registers LND-MFI-01 → the MFI officer, with no peer of its own, makes an offer through the hosted identity. */
import type { Lender, Loan } from '@wrt/shared';
import { ApiError, ID, as } from '../lib/api.js';
import { mintRegisteredReceipt } from '../lib/flows.js';
import { check, expectError, isMain, main, note, step, title } from '../lib/run.js';
import { readFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync(new URL('../seed-data.json', import.meta.url), 'utf8'));

export async function s7(): Promise<void> {
  title('S7 · Hosted MFI onboarding (Reviewer 1, governance)');
  const me = await as(ID.mfi).get<{ identity: { mspId: string }; chaincodeView: { role: string; entityId: string }; entity: Lender | null }>('/me');
  check(me.identity.mspId === 'LenderMSP', `MFI officer holds a LenderMSP client cert issued by the Lender CA (role ${me.chaincodeView.role}, ${me.chaincodeView.entityId}); no MFI peer exists`);
  const receipt = await mintRegisteredReceipt(ID.wh001, 'FRM-001');

  if (!me.entity) {
    await expectError('LND-MFI-01 tries to make an offer before on-chain registration', 'NOT_FOUND', () =>
      as(ID.mfi).post('/loans', { receiptId: receipt.id, principalTzs: 1_000_000, interestBp: 1200, termSecs: 86_400 }),
    );
    await step('REG-01 registers LND-MFI-01 on-chain (RegisterLender)', () => as(ID.reg).post('/lenders', seed._onboarding['LND-MFI-01']));
  } else {
    note('LND-MFI-01 was already onboarded (seed --demo or an earlier S7 run)');
  }
  const after = await as(ID.mfi).get<{ entity: Lender; hostingTier: number }>('/me');
  check(after.entity.type === 'MFI' && after.hostingTier === 2, 'LND-MFI-01 registered as MFI, hosting tier 2');

  const { result: loan, tx } = await step('LND-MFI-01 offers 3,000,000 TZS through the Lender org peer', () =>
    as(ID.mfi).post<Loan>('/loans', { receiptId: receipt.id, principalTzs: 3_000_000, interestBp: 1200, termSecs: 30 * 86_400 }),
  );
  check(loan.lenderId === 'LND-MFI-01' && loan.status === 'OFFERED', `${loan.id} OFFERED by LND-MFI-01, endorsed by ${tx.endorsers.join(', ')}`);

  try {
    await as(ID.reg).post('/registry/lender/LND-MFI-01/status', { status: 'SUSPENDED' });
    await expectError('a suspended MFI cannot transact', 'NOT_AUTHORISED', () =>
      as(ID.mfi).post('/loans', { receiptId: receipt.id, principalTzs: 1_000, interestBp: 1200, termSecs: 86_400 }),
    );
  } finally {
    await as(ID.reg).post('/registry/lender/LND-MFI-01/status', { status: 'ACTIVE' }).catch((e: ApiError) => note(e.message));
    note('REG-01 reinstated LND-MFI-01');
  }
}

if (isMain(import.meta.url)) await main('S7', s7);
