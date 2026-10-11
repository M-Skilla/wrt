import { CALLERS } from '../support/mocks';
import { HASH, MAIZE_G1, deposit, inspectorCaller, registeredReceipt, seededWorld } from '../support/world';

const json = JSON.stringify;

describe('ReceiptContract: deposit and attestation (spec §5.1)', () => {
  it('RecordDeposit stores declared figures and draws an unconflicted inspector', async () => {
    const w = await seededWorld();
    const { dep } = await deposit(w);
    expect(dep).toMatchObject({ id: 'DEP-WH001-0001', warehouseId: 'WH-001', status: 'PENDING_ATTESTATION', declared: MAIZE_G1 });
    expect(['INS-01', 'INS-02', 'INS-03']).toContain(dep.assignedInspectorId);
    const second = await deposit(w);
    expect(second.dep.id).toBe('DEP-WH001-0002');
  });

  it('WH-002 deposits never go to INS-02 (conflicted)', async () => {
    const w = await seededWorld();
    w.stub.transient = new Map([['pii', Buffer.from(json({ fullName: 'F', phone: 'p', nidaNo: 'n', villageOrWard: 'v' }))]]);
    await w.call(CALLERS.wh002, 'registry', 'RegisterFarmer', 'FRM-003');
    for (let i = 0; i < 20; i++) {
      const dep = await w.call(CALLERS.wh002, 'receipt', 'RecordDeposit', 'FRM-003', 'PADDY', json(MAIZE_G1), json([]), `SEAL-${i}`);
      expect(dep.assignedInspectorId).not.toBe('INS-02');
    }
  });

  it('rejects bad deposits: wrong role, unknown farmer, unknown grade, float weight, bad hash', async () => {
    const w = await seededWorld();
    const args = (over: Partial<Record<string, string>> = {}) => [
      over.farmer ?? 'FRM-001',
      over.commodity ?? 'MAIZE',
      over.declared ?? json(MAIZE_G1),
      over.evidence ?? json([HASH('a')]),
      'SEAL',
    ];
    await expect(w.call(CALLERS.frm001, 'receipt', 'RecordDeposit', ...args())).rejects.toThrow(/^NOT_AUTHORISED/);
    await expect(w.call(CALLERS.wh001, 'receipt', 'RecordDeposit', ...args({ farmer: 'FRM-404' }))).rejects.toThrow('NOT_FOUND: farmer FRM-404 does not exist');
    await expect(w.call(CALLERS.wh001, 'receipt', 'RecordDeposit', ...args({ commodity: 'GOLD' }))).rejects.toThrow(/reference price GOLD G1/);
    await expect(w.call(CALLERS.wh001, 'receipt', 'RecordDeposit', ...args({ declared: json({ ...MAIZE_G1, netKg: 12400.5 }) }))).rejects.toThrow(
      /^INVALID_ARGUMENT: declared.netKg must be an integer/,
    );
    await expect(w.call(CALLERS.wh001, 'receipt', 'RecordDeposit', ...args({ evidence: json(['abc']) }))).rejects.toThrow(/sha256/);
  });

  it('S1: attestation within tolerance mints a receipt with the inspector values', async () => {
    const w = await seededWorld();
    const { dep, inspector } = await deposit(w, { grade: 'G1', netKg: 12450, moistureBp: 1300 });
    const observed = { grade: 'G1', netKg: 12400, moistureBp: 1320 };
    const res = await w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, json(observed), json([HASH('b')]), 'true');
    expect(res.outcome).toBe('MINTED');
    expect(res.receipt).toMatchObject({
      id: 'WRT-WH001-000001',
      status: 'ISSUED',
      legal: { status: 'PENDING_WRRB' },
      holderFarmerId: 'FRM-001',
      ...observed,
    });
    expect(res.deposit).toMatchObject({ status: 'ATTESTED', receiptId: 'WRT-WH001-000001' });
    expect(w.eventNames()).toEqual(['ReceiptIssued']);
  });

  it('S2: outside tolerance -> MISMATCH_DISPUTED and an automatic MINT_MISMATCH dispute, no receipt', async () => {
    const w = await seededWorld();
    const { dep, inspector } = await deposit(w, { grade: 'G1', netKg: 10000, moistureBp: 1300 });
    const res = await w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, json({ grade: 'G1', netKg: 9200, moistureBp: 1300 }), json([HASH('c')]), 'true');
    expect(res.outcome).toBe('MISMATCH_DISPUTED');
    expect(res.deposit).toMatchObject({ status: 'MISMATCH_DISPUTED', disputeId: 'DSP-0001' });
    expect(res.deposit.receiptId).toBeUndefined();
    expect(res.dispute).toMatchObject({ id: 'DSP-0001', type: 'MINT_MISMATCH', subject: { kind: 'DEPOSIT', id: dep.id }, status: 'OPEN' });
    expect(w.eventNames()).toEqual(['DisputeOpened']);
  });

  it('an unverified seal alone blocks minting', async () => {
    const w = await seededWorld();
    const { dep, inspector } = await deposit(w);
    const res = await w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, json(MAIZE_G1), json([]), 'false');
    expect(res.outcome).toBe('MISMATCH_DISPUTED');
    expect(res.dispute.claim).toMatch(/seal/);
  });

  it('only the assigned inspector may attest, once', async () => {
    const w = await seededWorld();
    const { dep, inspector } = await deposit(w);
    const other = ['INS-01', 'INS-02', 'INS-03'].find((i) => i !== dep.assignedInspectorId)!;
    await expect(w.call(inspectorCaller(other), 'receipt', 'SubmitAttestation', dep.id, json(MAIZE_G1), json([]), 'true')).rejects.toThrow(/assigned to/);
    await expect(w.call(CALLERS.wh001, 'receipt', 'SubmitAttestation', dep.id, json(MAIZE_G1), json([]), 'true')).rejects.toThrow(/^NOT_AUTHORISED/);
    await expect(w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, json(MAIZE_G1), json([]), 'yes')).rejects.toThrow(/"true" or "false"/);
    await w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, json(MAIZE_G1), json([]), 'true');
    await expect(w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, json(MAIZE_G1), json([]), 'true')).rejects.toThrow(/^ILLEGAL_TRANSITION/);
  });
});

describe('ReceiptContract: WRRB registration (spec §5.1 step 5)', () => {
  it('regulator registers once', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    expect(receipt.legal).toMatchObject({ status: 'WRRB_REGISTERED', registeredBy: 'REG-01' });
    await expect(w.call(CALLERS.reg, 'receipt', 'RecordWrrbRegistration', receipt.id, 'X')).rejects.toThrow(
      'ILLEGAL_TRANSITION: receiptLegal WRRB_REGISTERED -> WRRB_REGISTERED',
    );
    await expect(w.call(CALLERS.bank, 'receipt', 'RecordWrrbRegistration', receipt.id, 'X')).rejects.toThrow(/^NOT_AUTHORISED/);
  });
});

describe('ReceiptContract: quality checks (spec §5.4)', () => {
  it('regulator spot audit on an unpledged receipt amends values with a log entry', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    const req = await w.call(CALLERS.reg, 'receipt', 'RequestQualityCheck', receipt.id);
    expect(req.pendingQualityCheck).toMatchObject({ reason: 'REGULATOR_AUDIT', requestedBy: { entityId: 'REG-01' } });
    await expect(w.call(CALLERS.reg, 'receipt', 'RequestQualityCheck', receipt.id)).rejects.toThrow(/^ALREADY_EXISTS/);
    const ins = inspectorCaller(req.pendingQualityCheck.assignedInspectorId);
    const res = await w.call(ins, 'receipt', 'SubmitQualityCheck', receipt.id, json({ ...MAIZE_G1, moistureBp: 1360 }), json([HASH('d')]));
    expect(res.receipt.moistureBp).toBe(1360);
    expect(res.receipt.amendments).toEqual([expect.objectContaining({ field: 'moistureBp', from: 1340, to: 1360, source: 'QUALITY_CHECK' })]);
    expect(res.receipt.qualityHistory).toHaveLength(1);
    expect(res.receipt.pendingQualityCheck).toBeUndefined();
    expect(res.loan).toBeUndefined();
  });

  it('a lender without the lien cannot request a check; a check needs a pending request', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    await expect(w.call(CALLERS.bank, 'receipt', 'RequestQualityCheck', receipt.id)).rejects.toThrow(/holds no lien/);
    await expect(w.call(inspectorCaller('INS-01'), 'receipt', 'SubmitQualityCheck', receipt.id, json(MAIZE_G1), json([]))).rejects.toThrow(/^NOT_FOUND/);
    const req = await w.call(CALLERS.reg, 'receipt', 'RequestQualityCheck', receipt.id);
    const other = ['INS-01', 'INS-02', 'INS-03'].find((i) => i !== req.pendingQualityCheck.assignedInspectorId)!;
    await expect(w.call(inspectorCaller(other), 'receipt', 'SubmitQualityCheck', receipt.id, json(MAIZE_G1), json([]))).rejects.toThrow(/assigned to/);
  });
});

describe('ReceiptContract: withdrawal (spec §5.3)', () => {
  it('holder requests, operator confirms with a gate pass -> REDEEMED', async () => {
    const w = await seededWorld();
    const receipt = await registeredReceipt(w);
    await expect(w.call(CALLERS.wh001, 'receipt', 'ConfirmRelease', receipt.id, 'GP-1')).rejects.toThrow(/no withdrawal requested/);
    await expect(w.call({ ...CALLERS.frm001, entityId: 'FRM-002' }, 'receipt', 'RequestWithdrawal', receipt.id)).rejects.toThrow(/held by FRM-001/);
    await w.call(CALLERS.frm001, 'receipt', 'RequestWithdrawal', receipt.id);
    await expect(w.call(CALLERS.frm001, 'receipt', 'RequestWithdrawal', receipt.id)).rejects.toThrow(/^ALREADY_EXISTS/);
    await expect(w.call(CALLERS.wh002, 'receipt', 'ConfirmRelease', receipt.id, 'GP-1')).rejects.toThrow(/held at WH-001/);
    const done = await w.call(CALLERS.wh001, 'receipt', 'ConfirmRelease', receipt.id, 'GP-0042');
    expect(done).toMatchObject({ status: 'REDEEMED', release: { gatePassNo: 'GP-0042', releasedBy: 'WH-001' } });
    expect(w.eventNames()).toEqual(['ReceiptStatusChanged']);
    await expect(w.call(CALLERS.reg, 'receipt', 'RecordWrrbRegistration', receipt.id, 'X')).rejects.toThrow(/REDEEMED/);
  });
});
