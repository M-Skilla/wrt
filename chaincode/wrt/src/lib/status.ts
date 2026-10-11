import type { Deposit, DepositStatus, Dispute, DisputeStatus, Loan, LoanStatus, ReceiptStatus, WarehouseReceipt } from '../shared/types';
import type { WrtContext } from './context';
import { assertTransition } from './state-machine';

/**
 * The only places a status is assigned. Each goes through the state machine
 * first, and receipt/loan changes emit their events (spec §6).
 */

export function setReceiptStatus(ctx: WrtContext, receipt: WarehouseReceipt, to: ReceiptStatus): void {
  assertTransition('receipt', receipt.status, to);
  ctx.emit('ReceiptStatusChanged', { receiptId: receipt.id, from: receipt.status, to });
  receipt.status = to;
}

export function setLoanStatus(ctx: WrtContext, loan: Loan, to: LoanStatus): void {
  assertTransition('loan', loan.status, to);
  ctx.emit('LoanStatusChanged', { loanId: loan.id, from: loan.status, to });
  loan.status = to;
}

export function setDepositStatus(deposit: Deposit, to: DepositStatus): void {
  assertTransition('deposit', deposit.status, to);
  deposit.status = to;
}

export function setDisputeStatus(dispute: Dispute, to: DisputeStatus): void {
  assertTransition('dispute', dispute.status, to);
  dispute.status = to;
}
