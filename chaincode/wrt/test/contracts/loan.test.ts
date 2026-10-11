import { CALLERS } from '../support/mocks';
import { MAIZE_G1, activeLoan, registeredReceipt, seededWorld, type World, inspectorCaller, HASH } from '../support/world';

const json = JSON.stringify;
// MAIZE G1 12,400 kg × 850 = 10,540,000 TZS collateral; max 60% = 6,324,000.

async function offered(w: World, principal = 6_000_000) {
  const receipt = await registeredReceipt(w);
  const loan = await w.call(CALLERS.mfi, 'loan', 'OfferLoan', receipt.id, String(principal), '900', '600');
  return { receipt, loan };
}

describe('LoanContract: origination (spec §5.2)', () => {
  it('OfferLoan computes flat interest and enforces maxLtvBp exactly', async () => {
    const w = await seededWorld();
    const { receipt, loan } = await offered(w);
    expect(loan).toMatchObject({ id: 'LN-0001', status: 'OFFERED', principalTzs: 6_000_000, totalDueTzs: 6_540_000, farmerId: 'FRM-001', lenderId: 'LND-MFI-01' });
    expect((await w.call(CALLERS.bank, 'loan', 'OfferLoan', receipt.id, '6324000', '900', '600')).id).toBe('LN-0002');
    await expect(w.call(CALLERS.bank, 'loan', 'OfferLoan', receipt.id, '6324001', '900', '600')).rejects.toThrow(/^LTV_EXCEEDED: LTV 6000 bp > max 6000 bp/);
    await expect(w.call(CALLERS.bank, 'loan', 'OfferLoan', receipt.id, '0', '900', '600')).rejects.toThrow(/positive/);
    await expect(w.call(CALLERS.bank, 'loan', 'OfferLoan', receipt.id, '1000.5', '900', '600')).rejects.toThrow(/^INVALID_ARGUMENT/);
  });

  it('refuses unregistered, non-ISSUED, expired or withdrawing receipts, and suspended lenders', async () => {
    const w = await seededWorld();
    const { dep, inspector } = await (await import('../support/world')).deposit(w);
    const minted = await w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, json(MAIZE_G1), json([]), 'true');
    await expect(w.call(CALLERS.mfi, 'loan', 'OfferLoan', minted.receipt.id, '1000', '900', '600')).rejects.toThrow(/not WRRB-registered/);

    const r = await registeredReceipt(w);
    await w.call(CALLERS.frm001, 'receipt', 'RequestWithdrawal', r.id);
    await expect(w.call(CALLERS.mfi, 'loan', 'OfferLoan', r.id, '1000', '900', '600')).rejects.toThrow(/withdrawal/);

    const r2 = await registeredReceipt(w);
    w.advance(15_552_000);
    await expect(w.call(CALLERS.mfi, 'loan', 'OfferLoan', r2.id, '1000', '900', '600')).rejects.toThrow(/expired/);

    await w.call(CALLERS.reg, 'registry', 'SetEntityStatus', 'lender', 'LND-BANK-01', 'SUSPENDED');
    await expect(w.call(CALLERS.bank, 'loan', 'OfferLoan', r2.id, '1000', '900', '600')).rejects.toThrow('NOT_AUTHORISED: lender LND-BANK-01 is SUSPENDED');
  });

  it('AcceptLoan places the lien and opens escrow; only the borrower can accept', async () => {
    const w = await seededWorld();
    const { receipt, loan } = await offered(w);
    await expect(w.call({ ...CALLERS.frm001, entityId: 'FRM-002' }, 'loan', 'AcceptLoan', loan.id)).rejects.toThrow(/offered to FRM-001/);
    const res = await w.call(CALLERS.frm001, 'loan', 'AcceptLoan', loan.id);
    expect(res.loan.status).toBe('ACCEPTED');
    expect(res.escrow).toMatchObject({ loanId: loan.id, balanceTzs: 0, entries: [] });
    expect(w.eventNames()).toEqual(['LoanStatusChanged', 'ReceiptStatusChanged']);
    expect(await w.get('receipt', receipt.id)).toMatchObject({ status: 'PLEDGED', lien: { loanId: loan.id, lenderId: 'LND-MFI-01' } });
    // A second offer on the now-pledged receipt can't be accepted.
    const other = await w.call(CALLERS.bank, 'loan', 'OfferLoan', receipt.id, '1000', '900', '600').catch((e: Error) => e);
    expect(String(other)).toMatch(/PLEDGED/);
  });

  it('S1: funding with all conditions passing auto-disburses in the same tx', async () => {
    const w = await seededWorld();
    const { loan } = await offered(w);
    await w.call(CALLERS.frm001, 'loan', 'AcceptLoan', loan.id);
    await expect(w.call(CALLERS.bank, 'loan', 'FundEscrow', loan.id, '6000000', 'X')).rejects.toThrow(/belongs to LND-MFI-01/);
    const res = await w.call(CALLERS.mfi, 'loan', 'FundEscrow', loan.id, '6000000', 'BANK-SIM-77104');
    expect(res.released).toBe(true);
    expect(res.loan.status).toBe('ACTIVE');
    expect(res.loan.disbursementConditions).toHaveLength(6);
    expect(res.loan.disbursementConditions.every((c: { passed: boolean }) => c.passed)).toBe(true);
    expect(res.escrow.entries.map((e: { type: string }) => e.type)).toEqual(['FUND', 'DISBURSE_TO_FARMER']);
    expect(res.escrow.balanceTzs).toBe(0);
    expect(res.loan.maturityAt).toBeDefined();
    expect(w.eventNames()).toEqual(['EscrowReleased', 'LoanStatusChanged']);
  });

  it('partial funding holds the money and records failing conditions; EvaluateDisbursement retries', async () => {
    const w = await seededWorld();
    const { loan } = await offered(w);
    await w.call(CALLERS.frm001, 'loan', 'AcceptLoan', loan.id);
    const partial = await w.call(CALLERS.mfi, 'loan', 'FundEscrow', loan.id, '4000000', 'BANK-SIM-1');
    expect(partial.released).toBe(false);
    expect(partial.loan.disbursementConditions.filter((c: { passed: boolean }) => !c.passed).map((c: { condition: string }) => c.condition)).toEqual([
      'ESCROW_COVERS_PRINCIPAL',
    ]);
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateDisbursement', loan.id)).released).toBe(false);
    const done = await w.call(CALLERS.mfi, 'loan', 'FundEscrow', loan.id, '2000000', 'BANK-SIM-2');
    expect(done.released).toBe(true);
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateDisbursement', loan.id)).released).toBe(false); // no longer ACCEPTED
  });

  it('a stale attestation blocks disbursement (attestationMaxAgeSecs)', async () => {
    const w = await seededWorld();
    const { loan } = await offered(w);
    await w.call(CALLERS.frm001, 'loan', 'AcceptLoan', loan.id);
    w.advance(601);
    const res = await w.call(CALLERS.mfi, 'loan', 'FundEscrow', loan.id, '6000000', 'BANK-SIM-1');
    expect(res.released).toBe(false);
    expect(res.loan.disbursementConditions.find((c: { condition: string }) => c.condition === 'ATTESTATION_FRESH').passed).toBe(false);
  });

  it('funding needs an ACCEPTED loan', async () => {
    const w = await seededWorld();
    const { loan } = await offered(w);
    await expect(w.call(CALLERS.mfi, 'loan', 'FundEscrow', loan.id, '1', 'X')).rejects.toThrow(/needs ACCEPTED/);
  });
});

describe('LoanContract: cancellation', () => {
  it('lender withdraws an offer; farmer declines an offer', async () => {
    const w = await seededWorld();
    const { receipt, loan } = await offered(w);
    expect((await w.call(CALLERS.mfi, 'loan', 'CancelOffer', loan.id)).status).toBe('CANCELLED');
    const second = await w.call(CALLERS.bank, 'loan', 'OfferLoan', receipt.id, '1000', '900', '600');
    await expect(w.call(CALLERS.mfi, 'loan', 'CancelOffer', second.id)).rejects.toThrow(/belongs to LND-BANK-01/);
    expect((await w.call(CALLERS.frm001, 'loan', 'CancelOffer', second.id)).status).toBe('CANCELLED');
    await expect(w.call(CALLERS.frm001, 'loan', 'CancelOffer', second.id)).rejects.toThrow(/own OFFERED loan/);
  });

  it('lender cancels an accepted, part-funded loan: refund and lien lifted', async () => {
    const w = await seededWorld();
    const { receipt, loan } = await offered(w);
    await w.call(CALLERS.frm001, 'loan', 'AcceptLoan', loan.id);
    await w.call(CALLERS.mfi, 'loan', 'FundEscrow', loan.id, '1000000', 'BANK-SIM-1');
    expect((await w.call(CALLERS.mfi, 'loan', 'CancelOffer', loan.id)).status).toBe('CANCELLED');
    expect(w.eventNames()).toContain('LienReleased');
    expect(await w.get('escrow', loan.id)).toMatchObject({ balanceTzs: 0 });
    expect((await w.get('escrow', loan.id)).entries.map((e: { type: string }) => e.type)).toEqual(['FUND', 'REFUND_TO_LENDER']);
    const r = await w.get('receipt', receipt.id);
    expect(r.status).toBe('ISSUED');
    expect(r.lien).toBeUndefined();
  });
});

describe('LoanContract: repayment (spec §5.3)', () => {
  it('S1: partial repayments are held; full repayment releases to lender and lifts the lien', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    const loanId = await activeLoan(w, receipt.id);
    await expect(w.call({ ...CALLERS.frm001, entityId: 'FRM-002' }, 'loan', 'Repay', loanId, '1', 'X')).rejects.toThrow(/belongs to FRM-001/);
    await expect(w.call(CALLERS.frm001, 'loan', 'Repay', loanId, '7000000', 'X')).rejects.toThrow(/outstanding 6540000/);
    const part = await w.call(CALLERS.frm001, 'loan', 'Repay', loanId, '2000000', 'MPESA-SIM-1');
    expect(part.loan).toMatchObject({ status: 'ACTIVE', repaidTzs: 2_000_000 });
    expect(part.escrow.balanceTzs).toBe(2_000_000);
    const full = await w.call(CALLERS.frm001, 'loan', 'Repay', loanId, '4540000', 'MPESA-SIM-2');
    expect(full.loan.status).toBe('REPAID');
    expect(full.escrow.entries.map((e: { type: string }) => e.type)).toEqual(['FUND', 'DISBURSE_TO_FARMER', 'REPAYMENT', 'REPAYMENT', 'RELEASE_TO_LENDER']);
    expect(full.escrow.balanceTzs).toBe(0);
    expect(w.eventNames()).toEqual(['EscrowReleased', 'LoanStatusChanged', 'ReceiptStatusChanged', 'LienReleased']);
    const r = await w.get('receipt', receipt.id);
    expect(r).toMatchObject({ status: 'ISSUED' });
    expect(r.lien).toBeUndefined();
    await expect(w.call(CALLERS.frm001, 'loan', 'Repay', loanId, '1', 'X')).rejects.toThrow(/needs ACTIVE or MARGIN_CALL/);

    // ...and S1 ends with the withdrawal.
    await w.call(CALLERS.frm001, 'receipt', 'RequestWithdrawal', receipt.id);
    expect((await w.call(CALLERS.wh001, 'receipt', 'ConfirmRelease', receipt.id, 'GP-1')).status).toBe('REDEEMED');
  });
});

describe('LoanContract: keeper evaluation (spec §5.4, §5.5)', () => {
  it('a grade drop raises a margin call with the paydown needed; repaying it cures the call', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    const loanId = await activeLoan(w, receipt.id);
    const req = await w.call(CALLERS.mfi, 'receipt', 'RequestQualityCheck', receipt.id);
    const ins = inspectorCaller(req.pendingQualityCheck.assignedInspectorId);
    // G3 at 680/kg -> collateral 8,432,000; owed 6,540,000 -> LTV 77.6%.
    const qc = await w.call(ins, 'receipt', 'SubmitQualityCheck', receipt.id, JSON.stringify({ ...MAIZE_G1, grade: 'G3' }), JSON.stringify([HASH('e')]));
    expect(qc.loan.status).toBe('MARGIN_CALL');
    expect(qc.loan.marginCall.requiredPaydownTzs).toBe(6_540_000 - 6_323_999);
    expect(w.eventNames()).toEqual(['LoanStatusChanged', 'MarginCall']);
    const cured = await w.call(CALLERS.frm001, 'loan', 'Repay', loanId, String(qc.loan.marginCall.requiredPaydownTzs), 'MPESA-SIM-3');
    expect(cured.loan.status).toBe('ACTIVE');
    expect(cured.loan.marginCall).toBeUndefined();
  });

  it('an uncured margin call defaults after the grace period', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    const loanId = await activeLoan(w, receipt.id, 6_000_000, 100_000);
    await w.call(CALLERS.reg, 'registry', 'SetReferencePrice', 'MAIZE', 'G1', '700'); // 8,680,000 -> 75.3%
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId)).loan.status).toBe('MARGIN_CALL');
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId)).changed).toBe(false);
    w.advance(181);
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId)).loan.status).toBe('DEFAULTED');
    expect((await w.get('receipt', receipt.id)).status).toBe('DEFAULTED');
  });

  it('a price recovery cures a margin call on evaluation', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    const loanId = await activeLoan(w, receipt.id, 6_000_000, 100_000);
    await w.call(CALLERS.reg, 'registry', 'SetReferencePrice', 'MAIZE', 'G1', '700');
    await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId);
    await w.call(CALLERS.reg, 'registry', 'SetReferencePrice', 'MAIZE', 'G1', '850');
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId)).loan.status).toBe('ACTIVE');
  });

  it('LTV at the liquidation threshold defaults immediately', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    const loanId = await activeLoan(w, receipt.id, 6_000_000, 100_000);
    await w.call(CALLERS.reg, 'registry', 'SetReferencePrice', 'MAIZE', 'G1', '600'); // 7,440,000 -> 87.9%
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId)).loan.status).toBe('DEFAULTED');
  });

  it('flags an overdue quality check for an inspector', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    const loanId = await activeLoan(w, receipt.id, 6_000_000, 100_000);
    w.advance(301);
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId)).changed).toBe(true);
    expect((await w.get('receipt', receipt.id)).pendingQualityCheck).toMatchObject({ reason: 'OVERDUE' });
  });

  it('closed loans are left alone; outsiders cannot run the keeper', async () => {
    const w = await seededWorld();
    const { loan } = await offered(w);
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loan.id)).changed).toBe(false);
    await expect(w.call({ mspId: 'OrdererMSP' as never }, 'loan', 'EvaluateLoan', loan.id)).rejects.toThrow(/unknown org/);
  });
});

describe('LoanContract: S5 default and liquidation (spec §5.7)', () => {
  it('maturity passes unpaid -> keeper defaults -> waterfall pays lender, surplus to farmer', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    const loanId = await activeLoan(w, receipt.id, 6_000_000, 120);
    await w.call(CALLERS.frm001, 'loan', 'Repay', loanId, '1000000', 'MPESA-SIM-1');
    w.advance(120 + 100);
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId)).loan.status).toBe('ACTIVE'); // within grace
    w.advance(100);
    const ev = await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId);
    expect(ev.loan.status).toBe('DEFAULTED');
    expect(w.eventNames()).toEqual(['LoanStatusChanged', 'ReceiptStatusChanged']);

    await expect(w.call(CALLERS.bank, 'loan', 'ExecuteLiquidation', loanId, '8000000', 'BUYER-1')).rejects.toThrow(/belongs to LND-MFI-01/);
    const liq = await w.call(CALLERS.mfi, 'loan', 'ExecuteLiquidation', loanId, '8000000', 'NFRA-AUCTION-0091');
    // Owed 5,540,000 of 6,540,000: lender gets that plus the 1,000,000 held; 2,460,000 surplus to the farmer.
    expect(liq.waterfall).toEqual({ proceeds: 8_000_000, toLender: 5_540_000, surplusToFarmer: 2_460_000, shortfall: 0 });
    expect(liq.escrow.entries.slice(-3).map((e: { type: string; amountTzs: number }) => [e.type, e.amountTzs])).toEqual([
      ['LIQUIDATION_PROCEEDS', 8_000_000],
      ['SURPLUS_TO_FARMER', 2_460_000],
      ['RELEASE_TO_LENDER', 6_540_000],
    ]);
    expect(liq.escrow.balanceTzs).toBe(0);
    expect(liq.loan.status).toBe('LIQUIDATED');
    expect((await w.get('receipt', receipt.id)).status).toBe('LIQUIDATED');
  });

  it('a short sale leaves a shortfall and no surplus; liquidation needs DEFAULTED', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    const loanId = await activeLoan(w, receipt.id, 6_000_000, 120);
    await expect(w.call(CALLERS.mfi, 'loan', 'ExecuteLiquidation', loanId, '1', 'B')).rejects.toThrow(/needs DEFAULTED/);
    w.advance(400);
    await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId);
    const liq = await w.call(CALLERS.mfi, 'loan', 'ExecuteLiquidation', loanId, '5000000', 'B');
    expect(liq.waterfall).toEqual({ proceeds: 5_000_000, toLender: 5_000_000, surplusToFarmer: 0, shortfall: 1_540_000 });
  });
});
