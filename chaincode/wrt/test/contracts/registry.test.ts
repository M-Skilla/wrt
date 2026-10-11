import { CALLERS } from '../support/mocks';
import { SEED, World, seededWorld } from '../support/world';

describe('RegistryContract', () => {
  it('InitLedger seeds everything once, regulator only', async () => {
    const w = new World();
    await expect(w.call(CALLERS.wh001, 'registry', 'InitLedger', JSON.stringify(SEED))).rejects.toThrow(/^NOT_AUTHORISED/);
    expect(await w.call(CALLERS.reg, 'registry', 'InitLedger', JSON.stringify(SEED))).toEqual({
      warehouses: 2,
      lenders: 2,
      inspectors: 3,
      referencePrices: 12,
    });
    await expect(w.call(CALLERS.reg, 'registry', 'InitLedger', JSON.stringify(SEED))).rejects.toThrow('ALREADY_EXISTS: ledger is already initialised');
    expect(await w.get('warehouse', 'WH-001')).toMatchObject({ name: 'Kongwa Grain Store', status: 'ACTIVE', penaltyCount: 0, version: 1 });
    expect(await w.get('referencePrice', 'MAIZE~G1')).toMatchObject({ priceTzsPerKg: 850, setBy: 'REG-01' });
    expect(await w.get('policyParams', 'current')).toMatchObject({ maxLtvBp: 6000, demoMode: true });
  });

  it('rejects a policy with unordered LTV thresholds or float values', async () => {
    const w = new World();
    const bad = { ...SEED, policy: { ...SEED.policy, marginCallLtvBp: 5000 } };
    await expect(w.call(CALLERS.reg, 'registry', 'InitLedger', JSON.stringify(bad))).rejects.toThrow(/maxLtvBp < marginCallLtvBp/);
    const float = { ...SEED, policy: { ...SEED.policy, maxLtvBp: 6000.5 } };
    await expect(w.call(CALLERS.reg, 'registry', 'InitLedger', JSON.stringify(float))).rejects.toThrow(/^INVALID_ARGUMENT: maxLtvBp must be an integer/);
  });

  it('registers entities (regulator only) and refuses duplicates', async () => {
    const w = await seededWorld();
    await expect(w.call(CALLERS.bank, 'registry', 'RegisterLender', 'LND-SACCO-01', 'Umoja SACCO', 'SACCO', 'L-9')).rejects.toThrow(/^NOT_AUTHORISED/);
    expect(await w.call(CALLERS.reg, 'registry', 'RegisterLender', 'LND-SACCO-01', 'Umoja SACCO', 'SACCO', 'L-9')).toMatchObject({ type: 'SACCO', status: 'ACTIVE' });
    await expect(w.call(CALLERS.reg, 'registry', 'RegisterLender', 'LND-X', 'X', 'BROKER', 'L')).rejects.toThrow(/^INVALID_ARGUMENT: type/);
    expect(await w.call(CALLERS.reg, 'registry', 'RegisterWarehouse', 'WH-003', 'Store', 'Iringa', 'LIC', '1000', 'BOND')).toMatchObject({ capacityKg: 1000 });
    await expect(w.call(CALLERS.reg, 'registry', 'RegisterWarehouse', 'WH-003', 'Store', 'Iringa', 'LIC', '1000', 'BOND')).rejects.toThrow(/^ALREADY_EXISTS/);
    await expect(w.call(CALLERS.reg, 'registry', 'RegisterWarehouse', 'WH-004', 'Store', 'Iringa', 'LIC', '10.5', 'BOND')).rejects.toThrow(/^INVALID_ARGUMENT/);
    expect(await w.call(CALLERS.reg, 'registry', 'AccreditInspector', 'INS-04', 'New', 'ACC', '["WH-001"]')).toMatchObject({ conflictWarehouseIds: ['WH-001'] });
    await expect(w.call(CALLERS.reg, 'registry', 'AccreditInspector', 'INS-05', 'New', 'ACC', '{"a":1}')).rejects.toThrow(/^INVALID_ARGUMENT/);
  });

  it('suspends and reinstates through the state machine', async () => {
    const w = await seededWorld();
    expect(await w.call(CALLERS.reg, 'registry', 'SetWarehouseStatus', 'WH-002', 'SUSPENDED')).toMatchObject({ status: 'SUSPENDED', version: 2 });
    expect(await w.call(CALLERS.reg, 'registry', 'SetEntityStatus', 'warehouse', 'WH-002', 'ACTIVE')).toMatchObject({ status: 'ACTIVE' });
    await w.call(CALLERS.reg, 'registry', 'SetEntityStatus', 'lender', 'LND-MFI-01', 'REVOKED');
    await expect(w.call(CALLERS.reg, 'registry', 'SetEntityStatus', 'lender', 'LND-MFI-01', 'ACTIVE')).rejects.toThrow(
      'ILLEGAL_TRANSITION: entity REVOKED -> ACTIVE',
    );
    await expect(w.call(CALLERS.wh001, 'registry', 'SetEntityStatus', 'warehouse', 'WH-001', 'SUSPENDED')).rejects.toThrow(/^NOT_AUTHORISED/);
  });

  it('lets the registering warehouse (or the regulator) suspend a farmer, nobody else', async () => {
    const w = await seededWorld();
    await expect(w.call(CALLERS.wh002, 'registry', 'SetEntityStatus', 'farmer', 'FRM-001', 'SUSPENDED')).rejects.toThrow(/another warehouse/);
    expect(await w.call(CALLERS.wh001, 'registry', 'SetEntityStatus', 'farmer', 'FRM-001', 'SUSPENDED')).toMatchObject({ status: 'SUSPENDED' });
    expect(await w.call(CALLERS.reg, 'registry', 'SetEntityStatus', 'farmer', 'FRM-001', 'ACTIVE')).toMatchObject({ status: 'ACTIVE' });
    await expect(w.call(CALLERS.bank, 'registry', 'SetEntityStatus', 'farmer', 'FRM-001', 'SUSPENDED')).rejects.toThrow(/^NOT_AUTHORISED/);
  });

  it('RegisterFarmer keeps PII private: transient in, hash public, data in the collection', async () => {
    const w = await seededWorld();
    const farmer = await w.get('farmer', 'FRM-001');
    expect(farmer).toMatchObject({ registeredByWarehouseId: 'WH-001', status: 'ACTIVE' });
    expect(farmer.piiHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(farmer)).not.toMatch(/NIDA|Kongwa|\+255/);
    expect(w.stub.privateData.get('farmerPII')?.size).toBe(2);

    await expect(w.call(CALLERS.wh001, 'registry', 'RegisterFarmer', 'FRM-009')).rejects.toThrow(/transient data/);
    w.stub.transient = new Map([['pii', Buffer.from('{"fullName":"X"}')]]);
    await expect(w.call(CALLERS.wh001, 'registry', 'RegisterFarmer', 'FRM-009')).rejects.toThrow('INVALID_ARGUMENT: pii.phone is required');
    await expect(w.call(CALLERS.bank, 'registry', 'RegisterFarmer', 'FRM-009')).rejects.toThrow(/^NOT_AUTHORISED/);
  });

  it('a suspended warehouse cannot register farmers', async () => {
    const w = await seededWorld();
    await w.call(CALLERS.reg, 'registry', 'SetWarehouseStatus', 'WH-001', 'SUSPENDED');
    w.stub.transient = new Map([['pii', Buffer.from('{}')]]);
    await expect(w.call(CALLERS.wh001, 'registry', 'RegisterFarmer', 'FRM-009')).rejects.toThrow('NOT_AUTHORISED: warehouse WH-001 is SUSPENDED');
  });

  it('sets and updates reference prices; rejects zero', async () => {
    const w = await seededWorld();
    expect(await w.call(CALLERS.reg, 'registry', 'SetReferencePrice', 'MAIZE', 'G1', '900')).toMatchObject({ priceTzsPerKg: 900, version: 2 });
    expect(await w.call(CALLERS.reg, 'registry', 'SetReferencePrice', 'BEANS', 'G1', '2000')).toMatchObject({ version: 1 });
    await expect(w.call(CALLERS.reg, 'registry', 'SetReferencePrice', 'BEANS', 'G2', '0')).rejects.toThrow(/positive/);
  });

  it('SetPolicyParams replaces the policy (regulator only)', async () => {
    const w = await seededWorld();
    const next = { ...SEED.policy, demoMode: false, maxLtvBp: 5500 };
    expect(await w.call(CALLERS.reg, 'registry', 'SetPolicyParams', JSON.stringify(next))).toMatchObject({ demoMode: false, maxLtvBp: 5500, version: 2 });
    await expect(w.call(CALLERS.bank, 'registry', 'SetPolicyParams', JSON.stringify(next))).rejects.toThrow(/^NOT_AUTHORISED/);
    const missing = { ...SEED.policy, durations: {} };
    await expect(w.call(CALLERS.reg, 'registry', 'SetPolicyParams', JSON.stringify(missing))).rejects.toThrow(/durations.marginCallGraceSecs/);
  });
});
