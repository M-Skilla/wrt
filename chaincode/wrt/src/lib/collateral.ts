import type { Context } from 'fabric-contract-api';
import type { ReferencePrice, Tzs, WarehouseReceipt } from '../shared/types';
import { assetKey } from './keys';
import { getAsset } from './state';

export async function getPrice(ctx: Context, commodity: string, grade: string): Promise<ReferencePrice> {
  return getAsset<ReferencePrice>(ctx, assetKey(ctx, 'referencePrice', commodity, grade), `reference price ${commodity} ${grade}`);
}

/** Collateral value = netKg × reference price for the receipt's commodity and grade (spec §4.7). */
export async function collateralValue(ctx: Context, receipt: WarehouseReceipt): Promise<Tzs> {
  const price = await getPrice(ctx, receipt.commodity, receipt.grade);
  return receipt.netKg * price.priceTzsPerKg;
}

/** LTV in bp, rounded down. Display only: threshold decisions use atOrAbove(). */
export function ltvBp(amount: Tzs, collateral: Tzs): number {
  if (collateral <= 0) return amount > 0 ? Number.MAX_SAFE_INTEGER : 0;
  return Number((BigInt(amount) * 10_000n) / BigInt(collateral));
}

/** Exact check of amount / collateral ≥ thresholdBp / 10000, with no rounding. */
export function atOrAbove(amount: Tzs, collateral: Tzs, thresholdBp: number): boolean {
  return BigInt(amount) * 10_000n >= BigInt(thresholdBp) * BigInt(collateral);
}

/** Largest outstanding amount whose LTV is strictly below thresholdBp. */
export function maxOutstandingBelow(collateral: Tzs, thresholdBp: number): Tzs {
  // amount * 10000 < threshold * collateral  <=>  amount <= ceil(threshold*collateral/10000) - 1
  const product = BigInt(thresholdBp) * BigInt(collateral);
  const ceil = (product + 9_999n) / 10_000n;
  return Math.max(0, Number(ceil) - 1);
}

/** Exact check of amount / collateral > thresholdBp / 10000. */
export function above(amount: Tzs, collateral: Tzs, thresholdBp: number): boolean {
  return BigInt(amount) * 10_000n > BigInt(thresholdBp) * BigInt(collateral);
}
