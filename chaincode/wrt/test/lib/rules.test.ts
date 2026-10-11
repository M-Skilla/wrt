import { requireAnyRole, requireEntity, requireMember, requireRole } from '../../src/lib/access';
import { drawInspector } from '../../src/lib/assignment';
import { above, atOrAbove, ltvBp, maxOutstandingBelow } from '../../src/lib/collateral';
import { checkTolerance } from '../../src/lib/tolerance';
import type { Inspector } from '../../src/shared/types';
import { CALLERS, mockContext } from '../support/mocks';

describe('access control (spec §3.4)', () => {
  it('accepts the right role from the right org', () => {
    expect(requireRole(mockContext(CALLERS.reg), 'RegulatorMSP', ['regulator_officer'])).toEqual(CALLERS.reg);
  });

  it('rejects the wrong role', () => {
    expect(() => requireRole(mockContext(CALLERS.bank), 'RegulatorMSP', ['regulator_officer'])).toThrow(
      'NOT_AUTHORISED: requires regulator_officer @ RegulatorMSP; caller is lender_officer LND-BANK-01 @ LenderMSP',
    );
  });

  it('rejects a role attribute issued by the wrong org CA', () => {
    const forged = mockContext({ mspId: 'LenderMSP', role: 'regulator_officer', entityId: 'REG-01' });
    expect(() => requireRole(forged, 'RegulatorMSP', ['regulator_officer'])).toThrow(/^NOT_AUTHORISED/);
    expect(() => requireRole(forged, 'LenderMSP', ['regulator_officer'])).toThrow(/^NOT_AUTHORISED/);
    expect(() => requireAnyRole(forged, ['regulator_officer'])).toThrow(/^NOT_AUTHORISED/);
  });

  it('rejects an org admin with no wrt attributes', () => {
    expect(() => requireRole(mockContext({ mspId: 'WarehouseMSP' }), 'WarehouseMSP', ['warehouse_operator'])).toThrow(/no role/);
    expect(() => requireAnyRole(mockContext({ mspId: 'WarehouseMSP' }), ['farmer'])).toThrow(/^NOT_AUTHORISED/);
  });

  it('rejects a role with no entity', () => {
    expect(() => requireRole(mockContext({ mspId: 'WarehouseMSP', role: 'farmer' }), 'WarehouseMSP', ['farmer'])).toThrow(/^NOT_AUTHORISED/);
  });

  it('scopes mutations to the caller entity', () => {
    expect(() => requireEntity(mockContext(CALLERS.wh001), 'WH-001')).not.toThrow();
    expect(() => requireEntity(mockContext(CALLERS.wh001), 'WH-002')).toThrow('NOT_AUTHORISED: acts for WH-001, not WH-002');
  });

  it('lets any of the four orgs run permissionless checks, but nobody else', () => {
    expect(requireMember(mockContext({ mspId: 'InspectorMSP' })).mspId).toBe('InspectorMSP');
    expect(() => requireMember(mockContext({ mspId: 'OrdererMSP' as never }))).toThrow(/unknown org/);
  });
});

describe('inspector draw (spec §5.1 step 2)', () => {
  const ins = (id: string, status = 'ACTIVE', conflicts: string[] = []) =>
    ({ id, status, conflictWarehouseIds: conflicts }) as unknown as Inspector;
  const pool = [ins('INS-03'), ins('INS-01'), ins('INS-02', 'ACTIVE', ['WH-002']), ins('INS-04', 'SUSPENDED')];

  it('is deterministic for a tx ID', () => {
    expect(drawInspector(pool, 'tx-abc', 'WH-001')).toEqual(drawInspector([...pool].reverse(), 'tx-abc', 'WH-001'));
  });

  it('only draws ACTIVE, unconflicted, non-excluded inspectors', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { inspectorId, poolSize } = drawInspector(pool, `tx-${i}`, 'WH-002', ['INS-03']);
      expect(poolSize).toBe(1);
      seen.add(inspectorId);
    }
    expect([...seen]).toEqual(['INS-01']);
  });

  it('spreads draws across the pool', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(drawInspector(pool, `tx-${i}`, 'WH-001').inspectorId);
    expect([...seen].sort()).toEqual(['INS-01', 'INS-02', 'INS-03']);
  });

  it('fails when nobody is eligible', () => {
    expect(() => drawInspector(pool, 'tx', 'WH-002', ['INS-01', 'INS-03'])).toThrow('INVALID_ARGUMENT: no eligible inspector for WH-002');
  });
});

describe('tolerance check (spec §5.1 step 4)', () => {
  const policy = { weightToleranceBp: 50, moistureToleranceBp: 100, gradeMustMatch: true };
  const declared = { grade: 'G1', netKg: 12450, moistureBp: 1300 };

  it('passes the handoff sample: -0.40% weight, +0.2 pp moisture', () => {
    const r = checkTolerance(declared, { grade: 'G1', netKg: 12400, moistureBp: 1320 }, true, policy);
    expect(r).toEqual({ withinTolerance: true, failures: [], weightGapBp: -40, moistureGapBp: 20 });
  });

  it('flags S2: 10,000 kg declared, 9,200 observed', () => {
    const r = checkTolerance({ grade: 'G1', netKg: 10000, moistureBp: 1300 }, { grade: 'G1', netKg: 9200, moistureBp: 1300 }, true, policy);
    expect(r.withinTolerance).toBe(false);
    expect(r.weightGapBp).toBe(-800);
    expect(r.failures[0]).toMatch(/weight/);
  });

  it('is exact at the boundary: 0.5% passes, one kg more fails', () => {
    expect(checkTolerance({ ...declared, netKg: 10000 }, { ...declared, netKg: 10050 }, true, policy).withinTolerance).toBe(true);
    expect(checkTolerance({ ...declared, netKg: 10000 }, { ...declared, netKg: 10051 }, true, policy).withinTolerance).toBe(false);
  });

  it('flags moisture, grade and seal', () => {
    const r = checkTolerance(declared, { grade: 'G2', netKg: 12450, moistureBp: 1401 }, false, policy);
    expect(r.failures).toHaveLength(3);
    expect(r.failures.join(' ')).toMatch(/moisture.*grade.*seal/);
  });

  it('ignores grade when gradeMustMatch is off', () => {
    expect(checkTolerance(declared, { ...declared, grade: 'G2' }, true, { ...policy, gradeMustMatch: false }).withinTolerance).toBe(true);
  });
});

describe('LTV maths (integer only)', () => {
  it('computes LTV in bp, rounded down', () => {
    expect(ltvBp(4_540_000, 10_540_000)).toBe(4307);
    expect(ltvBp(1, 0)).toBe(Number.MAX_SAFE_INTEGER);
    expect(ltvBp(0, 0)).toBe(0);
  });

  it('compares thresholds exactly', () => {
    expect(atOrAbove(7500, 10000, 7500)).toBe(true);
    expect(atOrAbove(7499, 10000, 7500)).toBe(false);
    expect(above(6000, 10000, 6000)).toBe(false);
    expect(above(6001, 10000, 6000)).toBe(true);
  });

  it('finds the largest amount strictly under a threshold', () => {
    const c = 10_540_000;
    const max = maxOutstandingBelow(c, 7500);
    expect(atOrAbove(max, c, 7500)).toBe(false);
    expect(atOrAbove(max + 1, c, 7500)).toBe(true);
  });
});
