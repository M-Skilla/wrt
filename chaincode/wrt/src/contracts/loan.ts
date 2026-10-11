import { Info, Transaction } from 'fabric-contract-api';
import type { ConditionResult, Escrow, Loan, PolicyParams, QualityCheckRequest, WarehouseReceipt } from '../shared/types';
import { getCaller, requireMember, requireRole } from '../lib/access';
import { drawInspector } from '../lib/assignment';
import { above, collateralValue, ltvBp } from '../lib/collateral';
import { WrtContext, WrtContract } from '../lib/context';
import { nextSequence, pad } from '../lib/counter';
import { addEscrowEntry, simRef } from '../lib/escrow';
import { WrtError } from '../lib/errors';
import { OPEN_LOAN, assessLtv, assessMaturity, cancelAcceptedLoan, outstanding, settleIfRepaid } from '../lib/loan-risk';
import { getEscrow, getFarmer, getLender, getLoan, getReceipt, getWarehouse, keys, listInspectors, requireActive } from '../lib/lookups';
import { durations, getPolicy } from '../lib/policy';
import { createAsset, updateAsset } from '../lib/state';
import { setLoanStatus, setReceiptStatus } from '../lib/status';
import { isoFromSeconds, secondsFromIso, txIso, txSeconds } from '../lib/time';
import { parseAmount, parseBp, parseInteger, requireText } from '../lib/validate';

function isExpired(ctx: WrtContext, receipt: WarehouseReceipt): boolean {
  return txSeconds(ctx) >= secondsFromIso(receipt.expiresAt);
}

/** Pledge preconditions shared by OfferLoan and AcceptLoan (spec §5.2 step 1). */
function requirePledgeable(ctx: WrtContext, receipt: WarehouseReceipt): void {
  if (receipt.status !== 'ISSUED') {
    throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receipt.id} is ${receipt.status}; only ISSUED receipts can be pledged`);
  }
  if (receipt.legal.status !== 'WRRB_REGISTERED') {
    throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receipt.id} is not WRRB-registered`);
  }
  if (isExpired(ctx, receipt)) {
    throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receipt.id} expired at ${receipt.expiresAt}`);
  }
  if (receipt.withdrawalRequestedAt) {
    throw new WrtError('ILLEGAL_TRANSITION', `withdrawal of ${receipt.id} has been requested`);
  }
}

@Info({ title: 'LoanContract', description: 'Loans, escrow, keeper checks and liquidation (spec §5.2, §5.3, §5.5, §5.7)' })
export class LoanContract extends WrtContract {
  constructor() {
    super('LoanContract');
  }

  /** Lender offers a loan against an eligible receipt; principal / collateral ≤ maxLtvBp. */
  @Transaction()
  async OfferLoan(ctx: WrtContext, receiptId: string, principalTzs: string, interestBp: string, termSecs: string): Promise<string> {
    const officer = requireRole(ctx, 'LenderMSP', ['lender_officer']);
    requireActive(await getLender(ctx, officer.entityId), 'lender');
    const receipt = await getReceipt(ctx, receiptId);
    requirePledgeable(ctx, receipt);
    const policy = await getPolicy(ctx);
    const principal = parseAmount('principalTzs', principalTzs);
    if (principal === 0) {
      throw new WrtError('INVALID_ARGUMENT', 'principalTzs must be positive');
    }
    const interest = parseBp('interestBp', interestBp);
    const term = parseInteger('termSecs', termSecs, { min: 1 });
    const collateral = await collateralValue(ctx, receipt);
    if (above(principal, collateral, policy.maxLtvBp)) {
      throw new WrtError('LTV_EXCEEDED', `LTV ${ltvBp(principal, collateral)} bp > max ${policy.maxLtvBp} bp (collateral ${collateral} TZS)`);
    }
    const id = `LN-${pad(await nextSequence(ctx, 'loan'), 4)}`;
    const loan = await createAsset<Loan>(
      ctx,
      keys.loan(ctx, id),
      {
        docType: 'loan',
        id,
        receiptId,
        lenderId: officer.entityId,
        farmerId: receipt.holderFarmerId,
        principalTzs: principal,
        interestBp: interest,
        totalDueTzs: principal + Math.floor((principal * interest) / 10_000),
        termSecs: term,
        offeredAt: txIso(ctx),
        pausedSecs: 0,
        repaidTzs: 0,
        status: 'OFFERED',
        disbursementConditions: [],
      },
      `loan ${id}`,
    );
    return JSON.stringify(loan);
  }

  /** Farmer accepts: lien placed, receipt PLEDGED, escrow opened (spec §5.2 step 2). */
  @Transaction()
  async AcceptLoan(ctx: WrtContext, loanId: string): Promise<string> {
    const farmer = requireRole(ctx, 'WarehouseMSP', ['farmer']);
    requireActive(await getFarmer(ctx, farmer.entityId), 'farmer');
    const loan = await getLoan(ctx, loanId);
    if (loan.farmerId !== farmer.entityId) {
      throw new WrtError('NOT_AUTHORISED', `loan ${loanId} was offered to ${loan.farmerId}`);
    }
    const receipt = await getReceipt(ctx, loan.receiptId);
    requirePledgeable(ctx, receipt);
    setLoanStatus(ctx, loan, 'ACCEPTED');
    loan.acceptedAt = txIso(ctx);
    setReceiptStatus(ctx, receipt, 'PLEDGED');
    receipt.lien = { loanId, lenderId: loan.lenderId, placedAt: txIso(ctx) };
    const escrow = await createAsset<Escrow>(ctx, keys.escrow(ctx, loanId), { docType: 'escrow', loanId, balanceTzs: 0, entries: [] }, `escrow ${loanId}`);
    await updateAsset(ctx, keys.receipt(ctx, receipt.id), receipt);
    return JSON.stringify({ loan: await updateAsset(ctx, keys.loan(ctx, loanId), loan), escrow });
  }

  /**
   * Lender withdraws an OFFERED loan, or the farmer declines it. An ACCEPTED but
   * undisbursed loan can also be cancelled by the lender: escrow refunded, lien lifted.
   */
  @Transaction()
  async CancelOffer(ctx: WrtContext, loanId: string): Promise<string> {
    const caller = getCaller(ctx);
    const loan = await getLoan(ctx, loanId);
    if (caller.role === 'farmer') {
      const farmer = requireRole(ctx, 'WarehouseMSP', ['farmer']);
      if (loan.farmerId !== farmer.entityId || loan.status !== 'OFFERED') {
        throw new WrtError('NOT_AUTHORISED', `farmer can only decline their own OFFERED loan`);
      }
    } else {
      const officer = requireRole(ctx, 'LenderMSP', ['lender_officer']);
      if (loan.lenderId !== officer.entityId) {
        throw new WrtError('NOT_AUTHORISED', `loan ${loanId} belongs to ${loan.lenderId}`);
      }
    }
    if (loan.status === 'ACCEPTED') {
      await this.unwindAccepted(ctx, loan);
    } else {
      setLoanStatus(ctx, loan, 'CANCELLED');
    }
    return JSON.stringify(await updateAsset(ctx, keys.loan(ctx, loanId), loan));
  }

  /** Lender funds the escrow, then disbursement is evaluated in the same tx (spec §5.2 step 3). */
  @Transaction()
  async FundEscrow(ctx: WrtContext, loanId: string, amountTzs: string, paymentRef: string): Promise<string> {
    const officer = requireRole(ctx, 'LenderMSP', ['lender_officer']);
    const loan = await getLoan(ctx, loanId);
    if (loan.lenderId !== officer.entityId) {
      throw new WrtError('NOT_AUTHORISED', `loan ${loanId} belongs to ${loan.lenderId}`);
    }
    if (loan.status !== 'ACCEPTED') {
      throw new WrtError('ILLEGAL_TRANSITION', `loan ${loanId} is ${loan.status}; funding needs ACCEPTED`);
    }
    const escrow = await getEscrow(ctx, loanId);
    addEscrowEntry(ctx, escrow, 'FUND', parseAmount('amountTzs', amountTzs), requireText('paymentRef', paymentRef));
    return this.disburseIfReady(ctx, loan, escrow);
  }

  /** Permissionless retry of the disbursement conditions (spec §5.2, §5.5). */
  @Transaction()
  async EvaluateDisbursement(ctx: WrtContext, loanId: string): Promise<string> {
    requireMember(ctx);
    const loan = await getLoan(ctx, loanId);
    if (loan.status !== 'ACCEPTED') {
      return JSON.stringify({ loan, released: false });
    }
    return this.disburseIfReady(ctx, loan, await getEscrow(ctx, loanId));
  }

  /** Farmer repays into escrow; full repayment releases to the lender and lifts the lien (spec §5.3). */
  @Transaction()
  async Repay(ctx: WrtContext, loanId: string, amountTzs: string, paymentRef: string): Promise<string> {
    const farmer = requireRole(ctx, 'WarehouseMSP', ['farmer']);
    const loan = await getLoan(ctx, loanId);
    if (loan.farmerId !== farmer.entityId) {
      throw new WrtError('NOT_AUTHORISED', `loan ${loanId} belongs to ${loan.farmerId}`);
    }
    if (!(OPEN_LOAN as readonly string[]).includes(loan.status)) {
      throw new WrtError('ILLEGAL_TRANSITION', `loan ${loanId} is ${loan.status}; repayment needs ACTIVE or MARGIN_CALL`);
    }
    const amount = parseAmount('amountTzs', amountTzs);
    if (amount === 0 || amount > outstanding(loan)) {
      throw new WrtError('INVALID_ARGUMENT', `amount must be between 1 and the outstanding ${outstanding(loan)} TZS`);
    }
    const escrow = await getEscrow(ctx, loanId);
    const receipt = await getReceipt(ctx, loan.receiptId);
    addEscrowEntry(ctx, escrow, 'REPAYMENT', amount, requireText('paymentRef', paymentRef));
    loan.repaidTzs += amount;
    if (!settleIfRepaid(ctx, loan, receipt, escrow) && loan.status === 'MARGIN_CALL') {
      await assessLtv(ctx, loan, receipt, await getPolicy(ctx)); // may cure the call
    }
    await updateAsset(ctx, keys.escrow(ctx, loanId), escrow);
    await updateAsset(ctx, keys.receipt(ctx, receipt.id), receipt);
    return JSON.stringify({ loan: await updateAsset(ctx, keys.loan(ctx, loanId), loan), escrow });
  }

  /**
   * Permissionless keeper check (spec §5.5): LTV thresholds, margin-call deadline,
   * maturity + grace, overdue quality checks. Paused loans are left alone.
   */
  @Transaction()
  async EvaluateLoan(ctx: WrtContext, loanId: string): Promise<string> {
    requireMember(ctx);
    const loan = await getLoan(ctx, loanId);
    if (!(OPEN_LOAN as readonly string[]).includes(loan.status) || loan.pause) {
      return JSON.stringify({ loan, changed: false });
    }
    const receipt = await getReceipt(ctx, loan.receiptId);
    const policy = await getPolicy(ctx);
    let changed = await assessLtv(ctx, loan, receipt, policy);
    if (!changed) {
      changed = assessMaturity(ctx, loan, receipt, policy);
    }
    let receiptChanged = changed && receipt.status === 'DEFAULTED';
    if ((OPEN_LOAN as readonly string[]).includes(loan.status) && this.qualityCheckOverdue(ctx, receipt, policy)) {
      receipt.pendingQualityCheck = await this.overdueRequest(ctx, receipt);
      receiptChanged = true;
    }
    if (receiptChanged) {
      await updateAsset(ctx, keys.receipt(ctx, receipt.id), receipt);
    }
    return JSON.stringify({ loan: changed ? await updateAsset(ctx, keys.loan(ctx, loanId), loan) : loan, changed: changed || receiptChanged });
  }

  /**
   * Lender records the sale of a defaulted receipt's crop. Waterfall (spec §5.7):
   * the lender gets held repayments plus proceeds up to what is still owed; any
   * surplus goes to the farmer.
   */
  @Transaction()
  async ExecuteLiquidation(ctx: WrtContext, loanId: string, saleProceedsTzs: string, buyerRef: string): Promise<string> {
    const officer = requireRole(ctx, 'LenderMSP', ['lender_officer']);
    const loan = await getLoan(ctx, loanId);
    if (loan.lenderId !== officer.entityId) {
      throw new WrtError('NOT_AUTHORISED', `loan ${loanId} belongs to ${loan.lenderId}`);
    }
    if (loan.status !== 'DEFAULTED') {
      throw new WrtError('ILLEGAL_TRANSITION', `loan ${loanId} is ${loan.status}; liquidation needs DEFAULTED`);
    }
    const receipt = await getReceipt(ctx, loan.receiptId);
    if (receipt.status !== 'DEFAULTED') {
      throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receipt.id} is ${receipt.status}; liquidation needs DEFAULTED`);
    }
    const proceeds = parseAmount('saleProceedsTzs', saleProceedsTzs);
    const escrow = await getEscrow(ctx, loanId);
    if (proceeds > 0) {
      addEscrowEntry(ctx, escrow, 'LIQUIDATION_PROCEEDS', proceeds, requireText('buyerRef', buyerRef));
    }
    const owed = outstanding(loan);
    const toLender = Math.min(proceeds, owed);
    const surplus = proceeds - toLender;
    loan.repaidTzs += toLender;
    if (surplus > 0) {
      addEscrowEntry(ctx, escrow, 'SURPLUS_TO_FARMER', surplus, simRef(ctx, 'MPESA'));
    }
    if (escrow.balanceTzs > 0) {
      addEscrowEntry(ctx, escrow, 'RELEASE_TO_LENDER', escrow.balanceTzs, simRef(ctx, 'BANK'));
    }
    setLoanStatus(ctx, loan, 'LIQUIDATED');
    setReceiptStatus(ctx, receipt, 'LIQUIDATED');
    await updateAsset(ctx, keys.escrow(ctx, loanId), escrow);
    await updateAsset(ctx, keys.receipt(ctx, receipt.id), receipt);
    return JSON.stringify({
      loan: await updateAsset(ctx, keys.loan(ctx, loanId), loan),
      escrow,
      waterfall: { proceeds, toLender, surplusToFarmer: surplus, shortfall: owed - toLender },
    });
  }

  // ------------------------------------------------------------------ helpers

  /** Disbursement conditions (spec §5.2 step 3). All must pass for automatic release. */
  private async conditions(ctx: WrtContext, loan: Loan, escrow: Escrow, receipt: WarehouseReceipt, policy: PolicyParams): Promise<ConditionResult[]> {
    const now = txSeconds(ctx);
    const ageSecs = now - secondsFromIso(receipt.lastQualityCheckAt);
    const maxAge = durations(policy).attestationMaxAgeSecs;
    const warehouse = await getWarehouse(ctx, receipt.warehouseId);
    const registered = receipt.legal.status === 'WRRB_REGISTERED';
    const expired = isExpired(ctx, receipt);
    return [
      {
        condition: 'ESCROW_COVERS_PRINCIPAL',
        passed: escrow.balanceTzs >= loan.principalTzs,
        evidence: `${escrow.balanceTzs} ≥ ${loan.principalTzs}`,
      },
      {
        condition: 'LIEN_ON_THIS_LOAN',
        passed: receipt.status === 'PLEDGED' && receipt.lien?.loanId === loan.id,
        evidence: `${receipt.status} · lien ${receipt.lien?.loanId ?? 'none'}`,
      },
      {
        condition: 'WRRB_REGISTERED_NOT_EXPIRED',
        passed: registered && !expired,
        evidence: `${registered ? receipt.legal.wrrbReceiptNo : 'not registered'} · ${expired ? 'expired' : 'valid to'} ${receipt.expiresAt.slice(0, 10)}`,
      },
      {
        condition: 'ATTESTATION_FRESH',
        passed: ageSecs <= maxAge,
        evidence: `${ageSecs}s old · max ${maxAge}s`,
      },
      {
        condition: 'WAREHOUSE_ACTIVE',
        passed: warehouse.status === 'ACTIVE',
        evidence: `${warehouse.id} ${warehouse.status}`,
      },
      {
        condition: 'NO_OPEN_DISPUTE',
        passed: receipt.status !== 'UNDER_DISPUTE',
        evidence: receipt.activeDisputeId ?? '0 open',
      },
    ];
  }

  private async disburseIfReady(ctx: WrtContext, loan: Loan, escrow: Escrow): Promise<string> {
    const receipt = await getReceipt(ctx, loan.receiptId);
    const policy = await getPolicy(ctx);
    loan.disbursementConditions = await this.conditions(ctx, loan, escrow, receipt, policy);
    const released = loan.disbursementConditions.every((c) => c.passed);
    if (released) {
      addEscrowEntry(ctx, escrow, 'DISBURSE_TO_FARMER', loan.principalTzs, simRef(ctx, 'MPESA'));
      setLoanStatus(ctx, loan, 'ACTIVE');
      loan.disbursedAt = txIso(ctx);
      loan.maturityAt = isoFromSeconds(txSeconds(ctx) + loan.termSecs);
    }
    await updateAsset(ctx, keys.escrow(ctx, loan.id), escrow);
    return JSON.stringify({ loan: await updateAsset(ctx, keys.loan(ctx, loan.id), loan), escrow, released });
  }

  private async unwindAccepted(ctx: WrtContext, loan: Loan): Promise<void> {
    const escrow = await getEscrow(ctx, loan.id);
    const receipt = await getReceipt(ctx, loan.receiptId);
    cancelAcceptedLoan(ctx, loan, receipt, escrow);
    await updateAsset(ctx, keys.escrow(ctx, loan.id), escrow);
    await updateAsset(ctx, keys.receipt(ctx, receipt.id), receipt);
  }

  private qualityCheckOverdue(ctx: WrtContext, receipt: WarehouseReceipt, policy: PolicyParams): boolean {
    if (receipt.pendingQualityCheck || receipt.status !== 'PLEDGED') return false;
    return txSeconds(ctx) - secondsFromIso(receipt.lastQualityCheckAt) > durations(policy).qualityCheckIntervalSecs;
  }

  private async overdueRequest(ctx: WrtContext, receipt: WarehouseReceipt): Promise<QualityCheckRequest> {
    const { inspectorId } = drawInspector(await listInspectors(ctx), ctx.stub.getTxID(), receipt.warehouseId);
    return { reason: 'OVERDUE', requestedAt: txIso(ctx), assignedInspectorId: inspectorId };
  }
}
