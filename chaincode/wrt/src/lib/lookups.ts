import type { Context } from 'fabric-contract-api';
import type { Deposit, Dispute, Escrow, Farmer, Inspector, Lender, Loan, Warehouse, WarehouseReceipt } from '../shared/types';
import { WrtError } from './errors';
import { collect } from './iter';
import { assetKey } from './keys';
import { getAsset } from './state';

export const keys = {
  warehouse: (ctx: Context, id: string) => assetKey(ctx, 'warehouse', id),
  lender: (ctx: Context, id: string) => assetKey(ctx, 'lender', id),
  inspector: (ctx: Context, id: string) => assetKey(ctx, 'inspector', id),
  farmer: (ctx: Context, id: string) => assetKey(ctx, 'farmer', id),
  deposit: (ctx: Context, id: string) => assetKey(ctx, 'deposit', id),
  receipt: (ctx: Context, id: string) => assetKey(ctx, 'receipt', id),
  loan: (ctx: Context, id: string) => assetKey(ctx, 'loan', id),
  escrow: (ctx: Context, loanId: string) => assetKey(ctx, 'escrow', loanId),
  dispute: (ctx: Context, id: string) => assetKey(ctx, 'dispute', id),
};

export const getWarehouse = (ctx: Context, id: string) => getAsset<Warehouse>(ctx, keys.warehouse(ctx, id), `warehouse ${id}`);
export const getLender = (ctx: Context, id: string) => getAsset<Lender>(ctx, keys.lender(ctx, id), `lender ${id}`);
export const getInspector = (ctx: Context, id: string) => getAsset<Inspector>(ctx, keys.inspector(ctx, id), `inspector ${id}`);
export const getFarmer = (ctx: Context, id: string) => getAsset<Farmer>(ctx, keys.farmer(ctx, id), `farmer ${id}`);
export const getDeposit = (ctx: Context, id: string) => getAsset<Deposit>(ctx, keys.deposit(ctx, id), `deposit ${id}`);
export const getReceipt = (ctx: Context, id: string) => getAsset<WarehouseReceipt>(ctx, keys.receipt(ctx, id), `receipt ${id}`);
export const getLoan = (ctx: Context, id: string) => getAsset<Loan>(ctx, keys.loan(ctx, id), `loan ${id}`);
export const getEscrow = (ctx: Context, loanId: string) => getAsset<Escrow>(ctx, keys.escrow(ctx, loanId), `escrow for ${loanId}`);
export const getDispute = (ctx: Context, id: string) => getAsset<Dispute>(ctx, keys.dispute(ctx, id), `dispute ${id}`);

/**
 * All inspectors, via a composite-key range read. Unlike a CouchDB rich query,
 * a range read is re-checked at commit, so an inspector added in the same block
 * can't make two peers draw differently without the tx being invalidated.
 */
export async function listInspectors(ctx: Context): Promise<Inspector[]> {
  return collect<Inspector>(ctx.stub.getStateByPartialCompositeKey('inspector', []));
}

/** Onboarding governance (spec §3.4): hosted entities transact only while ACTIVE. */
export function requireActive(entity: { id: string; status: string }, label: string): void {
  if (entity.status !== 'ACTIVE') {
    throw new WrtError('NOT_AUTHORISED', `${label} ${entity.id} is ${entity.status}`);
  }
}
