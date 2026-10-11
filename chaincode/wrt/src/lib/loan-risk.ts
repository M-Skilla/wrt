import type { Escrow, Loan, PolicyParams, WarehouseReceipt } from '../shared/types';
import { atOrAbove, collateralValue, ltvBp, maxOutstandingBelow } from './collateral';
import type { WrtContext } from './context';
import { addEscrowEntry, simRef } from './escrow';
import { durations } from './policy';
import { setLoanStatus, setReceiptStatus } from './status';
import { isoFromSeconds, secondsFromIso, txIso, txSeconds } from './time';

export const OPEN_LOAN = ['ACTIVE', 'MARGIN_CALL'] as const;

export function outstanding(loan: Loan): number {
  return Math.max(0, loan.totalDueTzs - loan.repaidTzs);
}

/** Maturity pushed back by time frozen in disputes (spec §4.4 pausedSecs). */
export function effectiveMaturitySecs(loan: Loan): number | null {
  return loan.maturityAt ? secondsFromIso(loan.maturityAt) + loan.pausedSecs : null;
}

/** Defaults the loan and its receipt (spec §5.7: "A DEFAULTED loan sets the receipt to DEFAULTED"). */
export function defaultLoan(ctx: WrtContext, loan: Loan, receipt: WarehouseReceipt): void {
  setLoanStatus(ctx, loan, 'DEFAULTED');
  delete loan.marginCall;
  if (receipt.status === 'PLEDGED') {
    setReceiptStatus(ctx, receipt, 'DEFAULTED');
  }
}

/**
 * LTV rules (spec §5.4, §5.5) for an ACTIVE or MARGIN_CALL loan whose clock is
 * not paused. Order matters: liquidation threshold first, then deadlines, then
 * margin call / cure. Returns true if anything changed.
 */
export async function assessLtv(ctx: WrtContext, loan: Loan, receipt: WarehouseReceipt, policy: PolicyParams): Promise<boolean> {
  if (!(OPEN_LOAN as readonly string[]).includes(loan.status) || loan.pause) {
    return false;
  }
  const collateral = await collateralValue(ctx, receipt);
  const owed = outstanding(loan);
  const now = txSeconds(ctx);

  if (atOrAbove(owed, collateral, policy.liquidationLtvBp)) {
    defaultLoan(ctx, loan, receipt);
    return true;
  }
  if (loan.status === 'MARGIN_CALL' && loan.marginCall && now > secondsFromIso(loan.marginCall.deadlineAt)) {
    defaultLoan(ctx, loan, receipt);
    return true;
  }
  if (loan.status === 'ACTIVE' && atOrAbove(owed, collateral, policy.marginCallLtvBp)) {
    const requiredPaydownTzs = owed - maxOutstandingBelow(collateral, policy.marginCallLtvBp);
    setLoanStatus(ctx, loan, 'MARGIN_CALL');
    loan.marginCall = {
      raisedAt: txIso(ctx),
      deadlineAt: isoFromSeconds(now + durations(policy).marginCallGraceSecs),
      requiredPaydownTzs,
      reason: `LTV ${ltvBp(owed, collateral)} bp ≥ margin-call threshold ${policy.marginCallLtvBp} bp`,
    };
    ctx.emit('MarginCall', {
      loanId: loan.id,
      ltvBp: ltvBp(owed, collateral),
      deadlineAt: loan.marginCall.deadlineAt,
      requiredPaydownTzs,
    });
    return true;
  }
  if (loan.status === 'MARGIN_CALL' && !atOrAbove(owed, collateral, policy.marginCallLtvBp)) {
    setLoanStatus(ctx, loan, 'ACTIVE'); // cured (spec §5.3)
    delete loan.marginCall;
    return true;
  }
  return false;
}

/** Maturity + grace (spec §5.5). True if the loan was defaulted. */
export function assessMaturity(ctx: WrtContext, loan: Loan, receipt: WarehouseReceipt, policy: PolicyParams): boolean {
  if (!(OPEN_LOAN as readonly string[]).includes(loan.status) || loan.pause) {
    return false;
  }
  const maturity = effectiveMaturitySecs(loan);
  if (maturity !== null && txSeconds(ctx) > maturity + durations(policy).maturityGraceSecs && outstanding(loan) > 0) {
    defaultLoan(ctx, loan, receipt);
    return true;
  }
  return false;
}

/**
 * Full repayment (spec §5.3): release held funds to the lender, mark REPAID,
 * lift the lien, return the receipt to ISSUED. If the receipt is frozen by a
 * dispute, it returns to ISSUED when the dispute closes.
 */
export function settleIfRepaid(ctx: WrtContext, loan: Loan, receipt: WarehouseReceipt, escrow: Escrow): boolean {
  if (loan.repaidTzs < loan.totalDueTzs) {
    return false;
  }
  if (escrow.balanceTzs > 0) {
    addEscrowEntry(ctx, escrow, 'RELEASE_TO_LENDER', escrow.balanceTzs, simRef(ctx, 'BANK'));
  }
  setLoanStatus(ctx, loan, 'REPAID');
  delete loan.marginCall;
  delete receipt.lien;
  if (receipt.status === 'UNDER_DISPUTE') {
    receipt.statusBeforeDispute = 'ISSUED';
  } else {
    setReceiptStatus(ctx, receipt, 'ISSUED');
  }
  ctx.emit('LienReleased', { receiptId: receipt.id, loanId: loan.id });
  return true;
}

/** Cancels an ACCEPTED (undisbursed) loan: refund whatever was funded, lift the lien. Caller persists. */
export function cancelAcceptedLoan(ctx: WrtContext, loan: Loan, receipt: WarehouseReceipt, escrow: Escrow): void {
  if (escrow.balanceTzs > 0) {
    addEscrowEntry(ctx, escrow, 'REFUND_TO_LENDER', escrow.balanceTzs, simRef(ctx, 'BANK'));
  }
  delete receipt.lien;
  if (receipt.status === 'UNDER_DISPUTE') {
    receipt.statusBeforeDispute = 'ISSUED';
  } else if (receipt.status === 'PLEDGED') {
    setReceiptStatus(ctx, receipt, 'ISSUED');
  }
  setLoanStatus(ctx, loan, 'CANCELLED');
  delete loan.pause;
  ctx.emit('LienReleased', { receiptId: receipt.id, loanId: loan.id });
}
