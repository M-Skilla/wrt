import { CALLERS } from '../support/mocks';
import { HASH, MAIZE_G1, activeLoan, deposit, inspectorCaller, registeredReceipt, seededWorld, type World } from '../support/world';

const json = JSON.stringify;
const G3 = { ...MAIZE_G1, grade: 'G3' };

/** Regulator assigns, drawn inspector re-inspects with `reading`. */
async function reinspect(w: World, disputeId: string, reading = MAIZE_G1) {
  const assigned = await w.call(CALLERS.reg, 'dispute', 'AssignReinspection', disputeId);
  const ins = inspectorCaller(assigned.dispute.reinspection.inspectorId);
  await w.call(ins, 'dispute', 'SubmitReinspection', disputeId, json(reading), json([HASH('f')]));
  return assigned;
}

describe('DisputeContract: S2 inflated weight at minting (spec §8)', () => {
  it('auto MINT_MISMATCH -> re-inspection by a different inspector -> FRAUDULENT -> warehouse suspended', async () => {
    const w = await seededWorld();
    const { dep, inspector } = await deposit(w, { grade: 'G1', netKg: 10000, moistureBp: 1300 });
    const att = await w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, json({ grade: 'G1', netKg: 9200, moistureBp: 1300 }), json([HASH('c')]), 'true');
    const disputeId = att.dispute.id;

    await expect(w.call(CALLERS.reg, 'dispute', 'ResolveDispute', disputeId, 'FRAUDULENT', 'WAREHOUSE', 'x', '0')).rejects.toThrow(
      'ILLEGAL_TRANSITION: dispute OPEN -> RESOLVED',
    );
    const assigned = await reinspect(w, disputeId, { grade: 'G1', netKg: 9180, moistureBp: 1300 });
    expect(assigned.dispute.reinspection.inspectorId).not.toBe(dep.assignedInspectorId);
    expect(assigned.draw.excluded).toEqual([dep.assignedInspectorId]);

    await expect(w.call(CALLERS.reg, 'dispute', 'ResolveDispute', disputeId, 'FRAUDULENT', 'FARMER', 'x', '0')).rejects.toThrow(
      'INVALID_ARGUMENT: FRAUDULENT requires liability WAREHOUSE',
    );
    await expect(w.call(CALLERS.reg, 'dispute', 'ResolveDispute', disputeId, 'NATURAL_DEGRADATION', 'FARMER', 'x', '0')).rejects.toThrow(
      /does not apply to a MINT_MISMATCH/,
    );
    const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', disputeId, 'FRAUDULENT', 'WAREHOUSE', 'Weighbridge ticket altered', '0');
    expect(res.dispute).toMatchObject({ status: 'RESOLVED', resolution: { outcome: 'FRAUDULENT', liability: 'WAREHOUSE', resolvedBy: 'REG-01' } });
    expect(res.deposit.status).toBe('REJECTED');
    expect(res.warehouse).toMatchObject({ status: 'SUSPENDED', penaltyCount: 1 });
    expect(w.eventNames()).toEqual(['DisputeResolved']);
    // A suspended warehouse can no longer record deposits.
    await expect(deposit(w)).rejects.toThrow('NOT_AUTHORISED: warehouse WH-001 is SUSPENDED');
  });

  it('CONFIRMED mints with the declared values; CORRECTED with the re-inspected ones', async () => {
    const w = await seededWorld();
    const declared = { grade: 'G1', netKg: 10000, moistureBp: 1300 };
    for (const [outcome, expectKg] of [['CONFIRMED', 10000], ['CORRECTED', 9900]] as const) {
      const { dep, inspector } = await deposit(w, declared);
      const att = await w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, json({ ...declared, netKg: 9000 }), json([]), 'true');
      await reinspect(w, att.dispute.id, { ...declared, netKg: 9900 });
      const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', att.dispute.id, outcome, 'NONE', 'ok', '0');
      expect(res.receipt.netKg).toBe(expectKg);
      expect(res.deposit).toMatchObject({ status: 'ATTESTED', receiptId: res.receipt.id });
      expect(w.eventNames()).toEqual(['ReceiptIssued', 'DisputeResolved']);
    }
  });
});

describe('DisputeContract: raising (spec §5.6)', () => {
  it('only parties with an interest may raise', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    await expect(w.call(CALLERS.bank, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'c', '[]')).rejects.toThrow(/no interest/);
    await expect(w.call(CALLERS.wh002, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'c', '[]')).rejects.toThrow(/no interest/);
    await expect(w.call({ ...CALLERS.frm001, entityId: 'FRM-002' }, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'c', '[]')).rejects.toThrow(/no interest/);
    await expect(w.call({ mspId: 'WarehouseMSP' }, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'c', '[]')).rejects.toThrow(/^NOT_AUTHORISED/);
    await expect(w.call(CALLERS.reg, 'dispute', 'RaiseDispute', r.id, 'MINT_MISMATCH', 'c', '[]')).rejects.toThrow(/^INVALID_ARGUMENT: type/);
    const d = await w.call(CALLERS.wh001, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'Label damaged', '');
    expect(d).toMatchObject({ raisedBy: { role: 'warehouse_operator', entityId: 'WH-001' }, subject: { kind: 'RECEIPT', id: r.id } });
    expect(w.eventNames()).toEqual(['DisputeOpened', 'ReceiptStatusChanged']);
    await expect(w.call(CALLERS.reg, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'again', '[]')).rejects.toThrow(/UNDER_DISPUTE/);
  });

  it('a frozen receipt cannot be pledged, withdrawn or quality-checked', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    await w.call(CALLERS.frm001, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'c', '[]');
    await expect(w.call(CALLERS.mfi, 'loan', 'OfferLoan', r.id, '1000', '900', '600')).rejects.toThrow(/UNDER_DISPUTE/);
    await expect(w.call(CALLERS.frm001, 'receipt', 'RequestWithdrawal', r.id)).rejects.toThrow(/UNDER_DISPUTE/);
    await expect(w.call(CALLERS.reg, 'receipt', 'RequestQualityCheck', r.id)).rejects.toThrow(/UNDER_DISPUTE/);
  });

  it('MINT_ACCURACY after the challenge window needs evidence', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    w.advance(601);
    await expect(w.call(CALLERS.reg, 'dispute', 'RaiseDispute', r.id, 'MINT_ACCURACY', 'c', '[]')).rejects.toThrow(/challenge window/);
    expect((await w.call(CALLERS.reg, 'dispute', 'RaiseDispute', r.id, 'MINT_ACCURACY', 'c', json([HASH('9')]))).status).toBe('OPEN');
  });

  it('only the drawn inspector re-inspects, once', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    const d = await w.call(CALLERS.reg, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'c', '[]');
    await expect(w.call(CALLERS.ins01, 'dispute', 'SubmitReinspection', d.id, json(MAIZE_G1), '[]')).rejects.toThrow(/assigned to nobody/);
    const a = await w.call(CALLERS.reg, 'dispute', 'AssignReinspection', d.id);
    await expect(w.call(CALLERS.reg, 'dispute', 'AssignReinspection', d.id)).rejects.toThrow(/^ILLEGAL_TRANSITION/);
    const other = ['INS-01', 'INS-02', 'INS-03'].find((i) => i !== a.dispute.reinspection.inspectorId)!;
    await expect(w.call(inspectorCaller(other), 'dispute', 'SubmitReinspection', d.id, json(MAIZE_G1), '[]')).rejects.toThrow(/assigned to/);
    await w.call(inspectorCaller(a.dispute.reinspection.inspectorId), 'dispute', 'SubmitReinspection', d.id, json(MAIZE_G1), '[]');
    await expect(w.call(inspectorCaller(a.dispute.reinspection.inspectorId), 'dispute', 'SubmitReinspection', d.id, json(MAIZE_G1), '[]')).rejects.toThrow(
      /^ILLEGAL_TRANSITION/,
    );
  });

  it('CONFIRMED on an unpledged receipt just unfreezes it', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    const d = await w.call(CALLERS.reg, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'c', '[]');
    await reinspect(w, d.id, G3);
    const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', d.id, 'CONFIRMED', 'NONE', 'Fine', '0');
    expect(res.receipt).toMatchObject({ status: 'ISSUED', grade: 'G1', amendments: [] });
    expect(res.receipt.activeDisputeId).toBeUndefined();
  });
});

describe('DisputeContract: S3 post-issuance grade challenge (spec §8)', () => {
  it('frozen, clock paused, CORRECTED to G3, LTV recomputed -> margin call; frozen time extends maturity', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    const loanId = await activeLoan(w, r.id, 6_000_000, 100_000);
    const d = await w.call(CALLERS.mfi, 'dispute', 'RaiseDispute', r.id, 'MINT_ACCURACY', 'Grade looks like G3', json([HASH('7')]));
    expect((await w.get('receipt', r.id)).status).toBe('UNDER_DISPUTE');
    expect((await w.get('loan', loanId)).pause).toMatchObject({ disputeId: d.id });
    expect((await w.call(CALLERS.ins01, 'loan', 'EvaluateLoan', loanId)).changed).toBe(false); // paused

    w.advance(500);
    await reinspect(w, d.id, G3);
    const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', d.id, 'CORRECTED', 'WAREHOUSE', 'Grade overstated', '0');
    expect(res.receipt).toMatchObject({ status: 'PLEDGED', grade: 'G3' });
    expect(res.receipt.amendments).toEqual([expect.objectContaining({ field: 'grade', from: 'G1', to: 'G3', source: 'DISPUTE', disputeId: d.id })]);
    expect(res.loan.status).toBe('MARGIN_CALL');
    expect(res.loan.pause).toBeUndefined();
    expect(res.loan.pausedSecs).toBeGreaterThanOrEqual(500);
    expect(w.eventNames()).toEqual(['ReceiptStatusChanged', 'LoanStatusChanged', 'MarginCall', 'DisputeResolved']);
  });
});

describe('DisputeContract: S4 quality degradation during a loan (spec §8)', () => {
  it('QC grade drop -> margin call -> disputed -> STORAGE_NEGLIGENCE -> compensation into escrow -> cured', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    const loanId = await activeLoan(w, r.id, 6_000_000, 100_000);
    const req = await w.call(CALLERS.mfi, 'receipt', 'RequestQualityCheck', r.id);
    const qc = await w.call(inspectorCaller(req.pendingQualityCheck.assignedInspectorId), 'receipt', 'SubmitQualityCheck', r.id, json(G3), json([HASH('e')]));
    expect(qc.loan.status).toBe('MARGIN_CALL');

    const d = await w.call(CALLERS.frm001, 'dispute', 'RaiseDispute', r.id, 'QUALITY_DEGRADATION', 'Store roof leaked', json([HASH('8')]));
    const assigned = await reinspect(w, d.id, G3);
    expect(assigned.draw.excluded).toContain(req.pendingQualityCheck.assignedInspectorId);
    await expect(w.call(CALLERS.reg, 'dispute', 'ResolveDispute', d.id, 'STORAGE_NEGLIGENCE', 'FARMER', 'x', '0')).rejects.toThrow(/requires liability WAREHOUSE/);
    const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', d.id, 'STORAGE_NEGLIGENCE', 'WAREHOUSE', 'Roof leak', '1000000');
    expect(res.loan).toMatchObject({ status: 'ACTIVE', repaidTzs: 1_000_000 });
    const escrow = await w.get('escrow', loanId);
    expect(escrow.entries.slice(-1)[0]).toMatchObject({ type: 'COMPENSATION', amountTzs: 1_000_000, paymentRef: `BOND-CLAIM-${d.id}` });
  });

  it('NATURAL_DEGRADATION: loss stays with the farmer, margin rules apply', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    await activeLoan(w, r.id, 6_000_000, 100_000);
    const d = await w.call(CALLERS.mfi, 'dispute', 'RaiseDispute', r.id, 'QUALITY_DEGRADATION', 'c', '[]');
    await reinspect(w, d.id, G3);
    const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', d.id, 'NATURAL_DEGRADATION', 'FARMER', 'Moisture ageing', '0');
    expect(res.loan.status).toBe('MARGIN_CALL');
  });

  it('compensation that covers the whole debt settles the loan and lifts the lien', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    await activeLoan(w, r.id, 6_000_000, 100_000);
    const d = await w.call(CALLERS.mfi, 'dispute', 'RaiseDispute', r.id, 'QUALITY_DEGRADATION', 'c', '[]');
    await reinspect(w, d.id, G3);
    const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', d.id, 'STORAGE_NEGLIGENCE', 'WAREHOUSE', 'Total loss', '9000000');
    expect(res.loan.status).toBe('REPAID');
    expect(res.receipt.status).toBe('ISSUED');
    expect(res.receipt.lien).toBeUndefined();
  });
});

describe('DisputeContract: FRAUDULENT on a pledged receipt', () => {
  it('active loan: receipt CANCELLED, loan DEFAULTED, bond claim paid to the lender', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    const loanId = await activeLoan(w, r.id, 6_000_000, 100_000);
    const d = await w.call(CALLERS.mfi, 'dispute', 'RaiseDispute', r.id, 'MINT_ACCURACY', 'Empty bags', '[]');
    await reinspect(w, d.id, { ...MAIZE_G1, netKg: 1000 });
    const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', d.id, 'FRAUDULENT', 'WAREHOUSE', 'Phantom stock', '2000000');
    expect(res.receipt.status).toBe('CANCELLED');
    expect(res.loan).toMatchObject({ status: 'DEFAULTED', repaidTzs: 2_000_000 });
    expect(res.warehouse.status).toBe('SUSPENDED');
    const types = (await w.get('escrow', loanId)).entries.map((e: { type: string }) => e.type);
    expect(types.slice(-2)).toEqual(['COMPENSATION', 'RELEASE_TO_LENDER']);
  });

  it('accepted (undisbursed) loan: cancelled and refunded', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    const loan = await w.call(CALLERS.mfi, 'loan', 'OfferLoan', r.id, '6000000', '900', '600');
    await w.call(CALLERS.frm001, 'loan', 'AcceptLoan', loan.id);
    await w.call(CALLERS.mfi, 'loan', 'FundEscrow', loan.id, '1000', 'BANK-SIM-1');
    const d = await w.call(CALLERS.reg, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'c', '[]');
    await reinspect(w, d.id);
    await w.call(CALLERS.reg, 'registry', 'SetWarehouseStatus', 'WH-001', 'SUSPENDED');
    const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', d.id, 'FRAUDULENT', 'WAREHOUSE', 'x', '0');
    expect(res.loan.status).toBe('CANCELLED');
    expect(res.warehouse).toMatchObject({ status: 'SUSPENDED', penaltyCount: 1 });
    expect((await w.get('escrow', loan.id)).balanceTzs).toBe(0);
  });

  it('a repaid-while-frozen loan returns the receipt to ISSUED when the dispute closes', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    const loanId = await activeLoan(w, r.id);
    const d = await w.call(CALLERS.reg, 'dispute', 'RaiseDispute', r.id, 'OTHER', 'c', '[]');
    await w.call(CALLERS.frm001, 'loan', 'Repay', loanId, '6540000', 'MPESA-SIM-9');
    await reinspect(w, d.id);
    const res = await w.call(CALLERS.reg, 'dispute', 'ResolveDispute', d.id, 'CONFIRMED', 'NONE', 'ok', '0');
    expect(res.receipt.status).toBe('ISSUED');
  });
});
