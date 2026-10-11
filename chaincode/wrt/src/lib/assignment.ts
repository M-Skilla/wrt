import { createHash } from 'crypto';
import type { Inspector } from '../shared/types';
import { WrtError } from './errors';

/**
 * Deterministic inspector draw (spec §5.1 step 2): take ACTIVE inspectors, drop
 * those conflicted with the warehouse (and any explicitly excluded, e.g. the
 * original inspector on a re-inspection), sort by ID, pick index
 * int(sha256(txId)) mod n. Every endorsing peer sees the same tx ID, so every
 * peer draws the same inspector; nobody, including the warehouse, can choose.
 */
export function drawInspector(
  inspectors: readonly Inspector[],
  txId: string,
  warehouseId: string,
  exclude: readonly string[] = [],
): { inspectorId: string; poolSize: number } {
  const pool = inspectors
    .filter((i) => i.status === 'ACTIVE')
    .filter((i) => !i.conflictWarehouseIds.includes(warehouseId))
    .filter((i) => !exclude.includes(i.id))
    .map((i) => i.id)
    .sort();
  if (pool.length === 0) {
    throw new WrtError('INVALID_ARGUMENT', `no eligible inspector for ${warehouseId}`);
  }
  const digest = BigInt('0x' + createHash('sha256').update(txId).digest('hex'));
  const index = Number(digest % BigInt(pool.length));
  return { inspectorId: pool[index]!, poolSize: pool.length };
}
