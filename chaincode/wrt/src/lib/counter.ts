import type { Context } from 'fabric-contract-api';
import { fromBytes, toBytes } from './serialize';

/**
 * Sequential IDs (DEP-WH001-0001, WRT-WH001-000001, LN-0001, DSP-0001).
 * Two transactions bumping the same counter in one block conflict (MVCC) and the
 * second is rejected; that's acceptable at PoC volumes and keeps IDs readable.
 */
export async function nextSequence(ctx: Context, name: string): Promise<number> {
  const key = ctx.stub.createCompositeKey('counter', [name]);
  const bytes = await ctx.stub.getState(key);
  const n = bytes && bytes.length > 0 ? fromBytes<{ n: number }>(bytes).n + 1 : 1;
  await ctx.stub.putState(key, toBytes({ n }));
  return n;
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** "WH-001" -> "WH001", used inside deposit and receipt IDs. */
export function compactId(id: string): string {
  return id.replace(/-/g, '');
}
