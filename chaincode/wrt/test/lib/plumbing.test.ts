import { WrtContract } from '../../src/lib/context';
import { WrtError } from '../../src/lib/errors';
import { assetKey } from '../../src/lib/keys';
import { fromBytes, toBytes } from '../../src/lib/serialize';
import { createAsset, getAsset, readAsset, updateAsset } from '../../src/lib/state';
import { isoFromSeconds, secondsFromIso, txIso } from '../../src/lib/time';
import { parseAmount, parseBp, parseInteger, parseJson, requireInteger, requireOneOf, requireSha256List, requireText } from '../../src/lib/validate';
import type { Lender } from '../../src/shared/types';
import { CALLERS, mockContext } from '../support/mocks';

describe('serialize', () => {
  it('produces identical bytes regardless of key insertion order', () => {
    const a = toBytes({ b: 1, a: { d: [2, 1], c: 'x' } });
    const b = toBytes({ a: { c: 'x', d: [2, 1] }, b: 1 });
    expect(Buffer.from(a).toString()).toBe(Buffer.from(b).toString());
    expect(Buffer.from(a).toString()).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it('sorts arrays of plain values but keeps the order of arrays of objects (sort-keys-recursive)', () => {
    const out = Buffer.from(toBytes({ hashes: ['h2', 'h1'], entries: [{ t: 'FUND' }, { t: 'DISBURSE' }] })).toString();
    expect(out).toBe('{"entries":[{"t":"FUND"},{"t":"DISBURSE"}],"hashes":["h1","h2"]}');
  });

  it('round-trips', () => {
    expect(fromBytes(toBytes({ x: [1, { y: 'z' }] }))).toEqual({ x: [1, { y: 'z' }] });
  });
});

describe('time', () => {
  it('derives ISO time from the tx timestamp, not the wall clock', () => {
    const ctx = mockContext(CALLERS.reg);
    expect(txIso(ctx)).toBe('2026-10-11T09:41:00.000Z');
    ctx.stub.txSeconds += 60;
    expect(txIso(ctx)).toBe('2026-10-11T09:42:00.000Z');
  });

  it('converts between ISO and seconds', () => {
    expect(secondsFromIso(isoFromSeconds(1_790_000_000))).toBe(1_790_000_000);
  });
});

describe('validate', () => {
  it.each(['0', '42', '-7', '9007199254740991'])('accepts integer %s', (raw) => {
    expect(parseInteger('n', raw)).toBe(Number(raw));
  });

  it.each(['1.5', '1e3', '0x10', ' 7', '07', '', 'abc', '9007199254740993'])('rejects %j', (raw) => {
    expect(() => parseInteger('n', raw)).toThrow(/^INVALID_ARGUMENT: /);
  });

  it('enforces bounds', () => {
    expect(() => parseAmount('principalTzs', '-1')).toThrow('INVALID_ARGUMENT: principalTzs must be ≥ 0');
    expect(() => parseBp('maxLtvBp', '10001')).toThrow('INVALID_ARGUMENT: maxLtvBp must be ≤ 10000');
    expect(parseBp('maxLtvBp', '6000')).toBe(6000);
  });

  it('rejects floats inside JSON arguments', () => {
    expect(requireInteger('netKg', 12400)).toBe(12400);
    expect(() => requireInteger('netKg', 12400.5)).toThrow(/^INVALID_ARGUMENT: netKg must be an integer/);
    expect(() => requireInteger('netKg', '12400')).toThrow(/^INVALID_ARGUMENT/);
  });

  it('checks text, enums, JSON and hash lists', () => {
    expect(requireText('name', 'Kongwa')).toBe('Kongwa');
    expect(() => requireText('name', '  ')).toThrow('INVALID_ARGUMENT: name is required');
    expect(requireOneOf('type', 'MFI', ['BANK', 'MFI'] as const)).toBe('MFI');
    expect(() => requireOneOf('type', 'BROKER', ['BANK', 'MFI'] as const)).toThrow(/^INVALID_ARGUMENT/);
    expect(parseJson('obs', '{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJson('obs', '{a:1}')).toThrow('INVALID_ARGUMENT: obs is not valid JSON');
    const hash = 'a'.repeat(64);
    expect(requireSha256List('evidence', [hash])).toEqual([hash]);
    expect(() => requireSha256List('evidence', ['A'.repeat(64)])).toThrow(/^INVALID_ARGUMENT/);
    expect(() => requireSha256List('evidence', 'nope')).toThrow(/^INVALID_ARGUMENT/);
  });
});

describe('state', () => {
  const lender = { docType: 'lender', id: 'LND-BANK-01', name: 'Bank', type: 'BANK', licenseNo: 'L1', status: 'ACTIVE' } as const;

  it('creates at version 1 with tx-time bookkeeping, then bumps on update', async () => {
    const ctx = mockContext(CALLERS.reg);
    const key = assetKey(ctx, 'lender', lender.id);
    const created = await createAsset<Lender>(ctx, key, lender, 'lender LND-BANK-01');
    expect(created).toMatchObject({ version: 1, createdAt: '2026-10-11T09:41:00.000Z', updatedAt: '2026-10-11T09:41:00.000Z' });

    ctx.stub.txSeconds += 3600;
    const updated = await updateAsset<Lender>(ctx, key, { ...created, status: 'SUSPENDED' });
    expect(updated).toMatchObject({ version: 2, createdAt: '2026-10-11T09:41:00.000Z', updatedAt: '2026-10-11T10:41:00.000Z' });
    expect(await getAsset<Lender>(ctx, key, 'lender')).toEqual(updated);
  });

  it('refuses duplicates and reports missing assets', async () => {
    const ctx = mockContext(CALLERS.reg);
    const key = assetKey(ctx, 'lender', lender.id);
    expect(await readAsset(ctx, key)).toBeUndefined();
    await expect(getAsset(ctx, key, 'lender LND-BANK-01')).rejects.toThrow('NOT_FOUND: lender LND-BANK-01 does not exist');
    await createAsset<Lender>(ctx, key, lender, 'lender LND-BANK-01');
    await expect(createAsset<Lender>(ctx, key, lender, 'lender LND-BANK-01')).rejects.toThrow(
      'ALREADY_EXISTS: lender LND-BANK-01 already exists',
    );
  });
});

describe('events', () => {
  class Probe extends WrtContract {}

  it('emits one batched Fabric event per tx, in order', async () => {
    const ctx = mockContext(CALLERS.reg);
    ctx.emit('ReceiptStatusChanged', { receiptId: 'R1', from: 'PLEDGED', to: 'ISSUED' });
    ctx.emit('LienReleased', { receiptId: 'R1', loanId: 'LN-1' });
    await new Probe().afterTransaction(ctx, undefined);
    expect(ctx.stub.events).toEqual([
      {
        name: 'WrtEvents',
        payload: {
          txId: 'tx-0000',
          events: [
            { name: 'ReceiptStatusChanged', payload: { receiptId: 'R1', from: 'PLEDGED', to: 'ISSUED' } },
            { name: 'LienReleased', payload: { receiptId: 'R1', loanId: 'LN-1' } },
          ],
        },
      },
    ]);
  });

  it('emits nothing when the tx had no events', async () => {
    const ctx = mockContext(CALLERS.reg);
    await new Probe().afterTransaction(ctx, undefined);
    expect(ctx.stub.events).toEqual([]);
  });
});

describe('errors', () => {
  it('prefixes the message with the code', () => {
    const err = new WrtError('NOT_AUTHORISED', 'nope');
    expect(err.message).toBe('NOT_AUTHORISED: nope');
    expect(err.code).toBe('NOT_AUTHORISED');
  });
});
