import stringify from 'json-stringify-deterministic';
import sortKeysRecursive from 'sort-keys-recursive';

/**
 * Deterministic JSON (spec §0.4): every endorsing peer must produce byte-identical
 * state, or the endorsements won't match and the tx is rejected. Plain
 * JSON.stringify follows property insertion order, which can differ between code paths.
 *
 * Note: sort-keys-recursive also sorts arrays of plain values (['h2','h1'] is
 * stored as ['h1','h2']). Arrays of objects keep their order. So never rely on
 * the stored order of a list of strings or numbers; keep ordered history in
 * arrays of objects (escrow entries, amendments, quality history).
 */
export function toBytes(value: object): Uint8Array {
  return Buffer.from(stringify(sortKeysRecursive(value)));
}

export function fromBytes<T>(bytes: Uint8Array): T {
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
}
