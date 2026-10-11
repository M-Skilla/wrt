import { CALLERS } from '../support/mocks';
import { registeredReceipt, seededWorld } from '../support/world';

describe('QueryContract', () => {
  it('WhoAmI shows the caller as the chaincode sees it', async () => {
    const w = await seededWorld();
    expect(await w.call(CALLERS.frm001, 'query', 'WhoAmI')).toEqual({ mspId: 'WarehouseMSP', role: 'farmer', entityId: 'FRM-001' });
    expect(await w.call({ mspId: 'WarehouseMSP' }, 'query', 'WhoAmI')).toEqual({ mspId: 'WarehouseMSP', role: null, entityId: null });
  });

  it('gets assets by type, including the named getters', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    expect((await w.call(CALLERS.bank, 'query', 'GetReceipt', r.id)).id).toBe(r.id);
    expect((await w.call(CALLERS.bank, 'query', 'GetDeposit', r.depositId)).receiptId).toBe(r.id);
    expect((await w.call(CALLERS.bank, 'query', 'GetPolicyParams')).liquidationLtvBp).toBe(8500);
    await expect(w.call(CALLERS.bank, 'query', 'GetLoan', 'LN-9999')).rejects.toThrow('NOT_FOUND: loan LN-9999 does not exist');
    await expect(w.call(CALLERS.bank, 'query', 'GetEscrow', 'LN-9999')).rejects.toThrow(/^NOT_FOUND/);
    await expect(w.call(CALLERS.bank, 'query', 'GetDispute', 'DSP-9999')).rejects.toThrow(/^NOT_FOUND/);
    await expect(w.call(CALLERS.bank, 'query', 'Get', 'nonsense', 'x')).rejects.toThrow(/^INVALID_ARGUMENT/);
  });

  it('lists with whitelisted filters, sorted by id', async () => {
    const w = await seededWorld();
    await registeredReceipt(w);
    await registeredReceipt(w);
    const receipts = await w.call(CALLERS.reg, 'query', 'List', 'receipt', JSON.stringify({ warehouseId: 'WH-001', status: { $in: ['ISSUED', 'PLEDGED'] } }));
    expect(receipts.map((r: { id: string }) => r.id)).toEqual(['WRT-WH001-000001', 'WRT-WH001-000002']);
    expect(await w.call(CALLERS.reg, 'query', 'List', 'receipt', JSON.stringify({ holderFarmerId: 'FRM-002' }))).toEqual([]);
    expect(await w.call(CALLERS.reg, 'query', 'List', 'inspector', '')).toHaveLength(3);
    expect(await w.call(CALLERS.reg, 'query', 'List', 'referencePrice', '{"commodity":"MAIZE"}')).toHaveLength(3);
    await expect(w.call(CALLERS.reg, 'query', 'List', 'receipt', '{"netKg":"1"}')).rejects.toThrow(/cannot be filtered on netKg/);
    await expect(w.call(CALLERS.reg, 'query', 'List', 'receipt', '{"status":1}')).rejects.toThrow(/must be a string/);
  });

  it('GetHistory returns every version with its tx ID', async () => {
    const w = await seededWorld();
    const r = await registeredReceipt(w);
    const history = await w.call(CALLERS.reg, 'query', 'GetHistory', 'receipt', r.id);
    expect(history.map((h: { value: { version: number } }) => h.value.version)).toEqual([1, 2]);
    expect(history[1].txId).toMatch(/^tx-/);
    expect(history[1].value.legal.status).toBe('WRRB_REGISTERED');
    expect(await w.call(CALLERS.reg, 'query', 'GetHistory', 'policyParams', '')).toHaveLength(1);
  });

  it('GetFarmerPII: collection members only, never inspectors', async () => {
    const w = await seededWorld();
    expect(await w.call(CALLERS.bank, 'query', 'GetFarmerPII', 'FRM-001')).toMatchObject({ farmerId: 'FRM-001', nidaNo: 'NIDA-FRM-001' });
    await expect(w.call(CALLERS.ins01, 'query', 'GetFarmerPII', 'FRM-001')).rejects.toThrow('NOT_AUTHORISED: InspectorMSP is not a member of farmerPII');
    await expect(w.call(CALLERS.reg, 'query', 'GetFarmerPII', 'FRM-404')).rejects.toThrow(/^NOT_FOUND/);
  });
});
