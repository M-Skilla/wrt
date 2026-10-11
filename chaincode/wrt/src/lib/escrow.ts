import type { Escrow, EscrowEntryType, Tzs } from '../shared/types';
import type { WrtContext } from './context';
import { WrtError } from './errors';
import { txIso } from './time';

const OUTFLOWS: readonly EscrowEntryType[] = ['DISBURSE_TO_FARMER', 'RELEASE_TO_LENDER', 'REFUND_TO_LENDER', 'SURPLUS_TO_FARMER'];

/**
 * Appends an escrow entry and moves the balance. Inflows: FUND, REPAYMENT,
 * LIQUIDATION_PROCEEDS, COMPENSATION. Outflows emit EscrowReleased.
 * Real money moves off-chain; paymentRef records the simulated transfer (spec §4.4).
 */
export function addEscrowEntry(ctx: WrtContext, escrow: Escrow, type: EscrowEntryType, amountTzs: Tzs, paymentRef: string): void {
  if (amountTzs <= 0) {
    throw new WrtError('INVALID_ARGUMENT', `escrow ${type} amount must be positive`);
  }
  const outflow = OUTFLOWS.includes(type);
  if (outflow && amountTzs > escrow.balanceTzs) {
    throw new WrtError('INVALID_ARGUMENT', `escrow ${escrow.loanId} holds ${escrow.balanceTzs}, cannot release ${amountTzs}`);
  }
  escrow.balanceTzs += outflow ? -amountTzs : amountTzs;
  escrow.entries.push({ at: txIso(ctx), type, amountTzs, paymentRef, txId: ctx.stub.getTxID() });
  if (outflow) {
    ctx.emit('EscrowReleased', { loanId: escrow.loanId, type, amountTzs });
  }
}

/** Simulated off-chain payment reference for transfers the chaincode itself initiates. */
export function simRef(ctx: WrtContext, prefix: string): string {
  return `${prefix}-SIM-${ctx.stub.getTxID().slice(0, 10).toUpperCase()}`;
}
