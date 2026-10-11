import type { Context } from 'fabric-contract-api';
import type { DocType } from '../shared/types';

/** Composite key `docType~part1~part2…` (spec §4). E.g. assetKey(ctx, 'receipt', 'WRT-WH001-000123'). */
export function assetKey(ctx: Context, docType: DocType, ...parts: string[]): string {
  return ctx.stub.createCompositeKey(docType, parts);
}

/** The single policyParams asset. */
export function policyKey(ctx: Context): string {
  return assetKey(ctx, 'policyParams', 'current');
}
