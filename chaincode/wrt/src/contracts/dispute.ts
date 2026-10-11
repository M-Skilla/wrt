import { Info, Transaction } from 'fabric-contract-api';
import {
  DISPUTE_OUTCOMES,
  LIABILITIES,
  type Deposit,
  type Dispute,
  type DisputeOutcome,
  type Liability,
  type Loan,
  type PolicyParams,
  type Warehouse,
  type WarehouseReceipt,
} from '../shared/types';
import { partyOf, requireAnyRole, requireRole } from '../lib/access';
import { drawInspector } from '../lib/assignment';
import { WrtContext, WrtContract } from '../lib/context';
import { openDispute } from '../lib/disputes';
import { addEscrowEntry, simRef } from '../lib/escrow';
import { WrtError } from '../lib/errors';
import { OPEN_LOAN, assessLtv, cancelAcceptedLoan, defaultLoan, outstanding, settleIfRepaid } from '../lib/loan-risk';
import { getDeposit, getDispute, getEscrow, getInspector, getLoan, getReceipt, getWarehouse, keys, listInspectors, requireActive } from '../lib/lookups';
import { mintReceipt } from '../lib/mint';
import { durations, getPolicy } from '../lib/policy';
import { updateAsset } from '../lib/state';
import { assertTransition } from '../lib/state-machine';
import { setDepositStatus, setDisputeStatus, setReceiptStatus } from '../lib/status';
import { isoFromSeconds, secondsFromIso, txIso, txSeconds } from '../lib/time';
import { parseAmount, parseJson, requireOneOf, requireSha256List, requireText } from '../lib/validate';
import { amendReceipt, parseReading } from './receipt';

/** Types a person can raise; MINT_MISMATCH is only ever opened automatically at minting. */
const RAISABLE = ['MINT_ACCURACY', 'QUALITY_DEGRADATION', 'OTHER'] as const;

/** Liability the spec ties to an outcome (spec §5.6 table). Unlisted outcomes accept any liability. */
const REQUIRED_LIABILITY: Partial<Record<DisputeOutcome, Liability>> = {
  FRAUDULENT: 'WAREHOUSE',
  NATURAL_DEGRADATION: 'FARMER',
  STORAGE_NEGLIGENCE: 'WAREHOUSE',
};

@Info({ title: 'DisputeContract', description: 'Disputes, re-inspection and rulings (spec §5.6)' })
export class DisputeContract extends WrtContract {
  constructor() {
    super('DisputeContract');
  }

  /**
   * A party with an interest disputes a receipt: the lender with the lien, the holder,
   * the warehouse, any inspector, or the regulator. The receipt is frozen and any loan
   * clock pauses (spec §5.6 "Raising").
   */
  @Transaction()
  async RaiseDispute(ctx: WrtContext, receiptId: string, type: string, claim: string, evidenceJson: string): Promise<string> {
    const caller = requireAnyRole(ctx, ['lender_officer', 'farmer', 'warehouse_operator', 'inspector', 'regulator_officer']);
    const receipt = await getReceipt(ctx, receiptId);
    const interested =
      (caller.role === 'lender_officer' && receipt.lien?.lenderId === caller.entityId) ||
      (caller.role === 'farmer' && receipt.holderFarmerId === caller.entityId) ||
      (caller.role === 'warehouse_operator' && receipt.warehouseId === caller.entityId) ||
      caller.role === 'inspector' ||
      caller.role === 'regulator_officer';
    if (!interested) {
      throw new WrtError('NOT_AUTHORISED', `${caller.role} ${caller.entityId} has no interest in ${receiptId}`);
    }
    const disputeType = requireOneOf('type', type, RAISABLE);
    const evidence = requireSha256List('evidence', parseJson('evidence', evidenceJson || '[]'));
    if (receipt.status !== 'ISSUED' && receipt.status !== 'PLEDGED') {
      throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receiptId} is ${receipt.status}; disputes need ISSUED or PLEDGED`);
    }
    const policy = await getPolicy(ctx);
    const pastWindow = txSeconds(ctx) > secondsFromIso(receipt.issuedAt) + durations(policy).challengeWindowSecs;
    if (disputeType === 'MINT_ACCURACY' && pastWindow && evidence.length === 0) {
      throw new WrtError('INVALID_ARGUMENT', 'MINT_ACCURACY after the challenge window needs at least one evidence hash');
    }

    const dispute = await openDispute(ctx, { kind: 'RECEIPT', id: receiptId }, disputeType, partyOf(caller), requireText('claim', claim), evidence);
    receipt.statusBeforeDispute = receipt.status;
    receipt.activeDisputeId = dispute.id;
    setReceiptStatus(ctx, receipt, 'UNDER_DISPUTE');
    if (receipt.lien) {
      const loan = await getLoan(ctx, receipt.lien.loanId);
      if (['ACCEPTED', ...OPEN_LOAN].includes(loan.status) && !loan.pause) {
        loan.pause = { disputeId: dispute.id, pausedAt: txIso(ctx) };
        await updateAsset(ctx, keys.loan(ctx, loan.id), loan);
      }
    }
    await updateAsset(ctx, keys.receipt(ctx, receiptId), receipt);
    return JSON.stringify(dispute);
  }

  /** Regulator triggers a deterministic draw of a different, unconflicted inspector (spec §5.6). */
  @Transaction()
  async AssignReinspection(ctx: WrtContext, disputeId: string): Promise<string> {
    requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    const dispute = await getDispute(ctx, disputeId);
    const { warehouseId, exclude } = await this.subjectContext(ctx, dispute);
    setDisputeStatus(dispute, 'REINSPECTION_ASSIGNED');
    const { inspectorId, poolSize } = drawInspector(await listInspectors(ctx), ctx.stub.getTxID(), warehouseId, exclude);
    dispute.reinspection = { inspectorId, assignedAt: txIso(ctx) };
    const saved = await updateAsset(ctx, keys.dispute(ctx, disputeId), dispute);
    return JSON.stringify({ dispute: saved, draw: { inspectorId, poolSize, excluded: exclude } });
  }

  @Transaction()
  async SubmitReinspection(ctx: WrtContext, disputeId: string, observedJson: string, evidenceJson: string): Promise<string> {
    const ins = requireRole(ctx, 'InspectorMSP', ['inspector']);
    requireActive(await getInspector(ctx, ins.entityId), 'inspector');
    const dispute = await getDispute(ctx, disputeId);
    if (dispute.reinspection?.inspectorId !== ins.entityId) {
      throw new WrtError('NOT_AUTHORISED', `re-inspection of ${disputeId} is assigned to ${dispute.reinspection?.inspectorId ?? 'nobody'}`);
    }
    setDisputeStatus(dispute, 'REINSPECTED');
    dispute.reinspection = {
      ...dispute.reinspection,
      observed: parseReading('observed', observedJson),
      evidence: requireSha256List('evidence', parseJson('evidence', evidenceJson)),
      submittedAt: txIso(ctx),
    };
    return JSON.stringify(await updateAsset(ctx, keys.dispute(ctx, disputeId), dispute));
  }

  /** Regulator rules after re-inspection; effects per spec §5.6 tables. */
  @Transaction()
  async ResolveDispute(ctx: WrtContext, disputeId: string, outcome: string, liability: string, findings: string, compensationTzs: string): Promise<string> {
    const reg = requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    const dispute = await getDispute(ctx, disputeId);
    const result = requireOneOf('outcome', outcome, DISPUTE_OUTCOMES);
    const liable = requireOneOf('liability', liability, LIABILITIES);
    const required = REQUIRED_LIABILITY[result];
    if (required && liable !== required) {
      throw new WrtError('INVALID_ARGUMENT', `${result} requires liability ${required}`);
    }
    const compensation = parseAmount('compensationTzs', compensationTzs);
    setDisputeStatus(dispute, 'RESOLVED');
    dispute.resolution = {
      outcome: result,
      liability: liable,
      findings: requireText('findings', findings),
      compensationTzs: compensation,
      resolvedBy: reg.entityId,
      resolvedAt: txIso(ctx),
    };
    const policy = await getPolicy(ctx);
    const effects =
      dispute.subject.kind === 'DEPOSIT'
        ? await this.resolveDeposit(ctx, dispute, result, policy)
        : await this.resolveReceipt(ctx, dispute, result, compensation, policy);
    ctx.emit('DisputeResolved', { disputeId, outcome: result, liability: liable });
    const saved = await updateAsset(ctx, keys.dispute(ctx, disputeId), dispute);
    return JSON.stringify({ dispute: saved, ...effects });
  }

  // ------------------------------------------------------------------ helpers

  /** Warehouse for conflict exclusion, plus the inspectors who already looked at this crop. */
  private async subjectContext(ctx: WrtContext, dispute: Dispute): Promise<{ warehouseId: string; exclude: string[] }> {
    if (dispute.subject.kind === 'DEPOSIT') {
      const deposit = await getDeposit(ctx, dispute.subject.id);
      return { warehouseId: deposit.warehouseId, exclude: [deposit.assignedInspectorId] };
    }
    const receipt = await getReceipt(ctx, dispute.subject.id);
    const deposit = await getDeposit(ctx, receipt.depositId);
    const exclude = new Set<string>([deposit.attestation?.inspectorId ?? deposit.assignedInspectorId]);
    const lastCheck = receipt.qualityHistory[receipt.qualityHistory.length - 1];
    if (lastCheck) exclude.add(lastCheck.inspectorId);
    return { warehouseId: receipt.warehouseId, exclude: [...exclude].sort() };
  }

  private requireReinspected(dispute: Dispute) {
    const observed = dispute.reinspection?.observed;
    if (!observed) {
      throw new WrtError('ILLEGAL_TRANSITION', `dispute ${dispute.id} has no re-inspection reading`);
    }
    return observed;
  }

  /** FRAUDULENT: penalty and suspension (spec §5.6). */
  private async penalise(ctx: WrtContext, warehouseId: string): Promise<Warehouse> {
    const warehouse = await getWarehouse(ctx, warehouseId);
    warehouse.penaltyCount += 1;
    if (warehouse.status === 'ACTIVE') {
      assertTransition('entity', warehouse.status, 'SUSPENDED');
      warehouse.status = 'SUSPENDED';
    }
    return updateAsset(ctx, keys.warehouse(ctx, warehouseId), warehouse);
  }

  /** MINT_MISMATCH rulings (spec §5.6 "For MINT_MISMATCH"). */
  private async resolveDeposit(ctx: WrtContext, dispute: Dispute, outcome: DisputeOutcome, policy: PolicyParams) {
    const deposit: Deposit = await getDeposit(ctx, dispute.subject.id);
    let receipt: WarehouseReceipt | undefined;
    let warehouse: Warehouse | undefined;
    if (outcome === 'CONFIRMED') {
      receipt = await mintReceipt(ctx, deposit, deposit.declared, policy);
    } else if (outcome === 'CORRECTED') {
      receipt = await mintReceipt(ctx, deposit, this.requireReinspected(dispute), policy);
    } else if (outcome === 'FRAUDULENT') {
      setDepositStatus(deposit, 'REJECTED');
      warehouse = await this.penalise(ctx, deposit.warehouseId);
    } else {
      throw new WrtError('INVALID_ARGUMENT', `${outcome} does not apply to a MINT_MISMATCH dispute`);
    }
    await updateAsset(ctx, keys.deposit(ctx, deposit.id), deposit);
    return { deposit, receipt, warehouse };
  }

  /** Rulings on a frozen receipt (spec §5.6 outcome table). */
  private async resolveReceipt(ctx: WrtContext, dispute: Dispute, outcome: DisputeOutcome, compensation: number, policy: PolicyParams) {
    const receipt = await getReceipt(ctx, dispute.subject.id);
    let loan: Loan | undefined = receipt.lien ? await getLoan(ctx, receipt.lien.loanId) : undefined;
    const escrow = loan ? await getEscrow(ctx, loan.id) : undefined;
    let warehouse: Warehouse | undefined;

    // Unpause the loan clock: frozen time extends maturity and any margin-call deadline.
    if (loan?.pause) {
      const frozen = Math.max(0, txSeconds(ctx) - secondsFromIso(loan.pause.pausedAt));
      loan.pausedSecs += frozen;
      if (loan.marginCall) {
        loan.marginCall.deadlineAt = isoFromSeconds(secondsFromIso(loan.marginCall.deadlineAt) + frozen);
      }
      delete loan.pause;
    }

    if (outcome === 'FRAUDULENT') {
      setReceiptStatus(ctx, receipt, 'CANCELLED');
      warehouse = await this.penalise(ctx, receipt.warehouseId);
      if (loan && escrow) {
        if (loan.status === 'ACCEPTED') {
          cancelAcceptedLoan(ctx, loan, receipt, escrow);
        } else if ((OPEN_LOAN as readonly string[]).includes(loan.status)) {
          defaultLoan(ctx, loan, receipt);
        }
        if (compensation > 0 && loan.status === 'DEFAULTED') {
          // Claim against the warehouse bond, paid through to the lender.
          const credit = Math.min(compensation, outstanding(loan));
          if (credit > 0) {
            addEscrowEntry(ctx, escrow, 'COMPENSATION', credit, `BOND-CLAIM-${dispute.id}`);
            loan.repaidTzs += credit;
            addEscrowEntry(ctx, escrow, 'RELEASE_TO_LENDER', credit, simRef(ctx, 'BANK'));
          }
        }
      }
    } else {
      if (outcome !== 'CONFIRMED') {
        amendReceipt(ctx, receipt, this.requireReinspected(dispute), 'DISPUTE', dispute.id);
      }
      const restore = receipt.statusBeforeDispute ?? 'ISSUED';
      setReceiptStatus(ctx, receipt, restore);
      if (loan && escrow && (OPEN_LOAN as readonly string[]).includes(loan.status)) {
        if (outcome === 'STORAGE_NEGLIGENCE' && compensation > 0) {
          // Warehouse compensation restores collateral value: credited to the loan (spec §5.6, S4).
          const credit = Math.min(compensation, outstanding(loan));
          if (credit > 0) {
            addEscrowEntry(ctx, escrow, 'COMPENSATION', credit, `BOND-CLAIM-${dispute.id}`);
            loan.repaidTzs += credit;
          }
        }
        if (!settleIfRepaid(ctx, loan, receipt, escrow)) {
          await assessLtv(ctx, loan, receipt, policy);
        }
      }
    }
    delete receipt.statusBeforeDispute;
    delete receipt.activeDisputeId;

    await updateAsset(ctx, keys.receipt(ctx, receipt.id), receipt);
    if (loan && escrow) {
      await updateAsset(ctx, keys.escrow(ctx, loan.id), escrow);
      loan = await updateAsset(ctx, keys.loan(ctx, loan.id), loan);
    }
    return { receipt, loan, warehouse };
  }
}

