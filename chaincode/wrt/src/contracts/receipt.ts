import { Info, Transaction } from 'fabric-contract-api';
import type { Attestation, CropReading, Deposit, QualityCheckReason, WarehouseReceipt } from '../shared/types';
import { getCaller, partyOf, requireRole } from '../lib/access';
import { drawInspector } from '../lib/assignment';
import { WrtContext, WrtContract } from '../lib/context';
import { compactId, nextSequence, pad } from '../lib/counter';
import { openDispute } from '../lib/disputes';
import { WrtError } from '../lib/errors';
import { assessLtv } from '../lib/loan-risk';
import {
  getDeposit,
  getFarmer,
  getInspector,
  getLoan,
  getReceipt,
  getWarehouse,
  keys,
  listInspectors,
  requireActive,
} from '../lib/lookups';
import { mintReceipt } from '../lib/mint';
import { getPolicy } from '../lib/policy';
import { getPrice } from '../lib/collateral';
import { createAsset, updateAsset } from '../lib/state';
import { assertTransition } from '../lib/state-machine';
import { setDepositStatus, setReceiptStatus } from '../lib/status';
import { checkTolerance } from '../lib/tolerance';
import { txIso } from '../lib/time';
import { parseJson, requireInteger, requireSha256List, requireText } from '../lib/validate';

/** Parses a grade / netKg / moistureBp reading. Integers only. */
export function parseReading(name: string, raw: string): CropReading {
  const r = parseJson<Record<string, unknown>>(name, raw);
  return {
    grade: requireText(`${name}.grade`, r.grade),
    netKg: requireInteger(`${name}.netKg`, r.netKg, { min: 1 }),
    moistureBp: requireInteger(`${name}.moistureBp`, r.moistureBp, { min: 0, max: 10_000 }),
  };
}

function parseBool(name: string, raw: string): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new WrtError('INVALID_ARGUMENT', `${name} must be "true" or "false"`);
}

/** Writes new crop values onto a receipt, logging each change (spec §4.3: never silent). */
export function amendReceipt(
  ctx: WrtContext,
  receipt: WarehouseReceipt,
  reading: CropReading,
  source: 'QUALITY_CHECK' | 'DISPUTE',
  disputeId?: string,
): void {
  const at = txIso(ctx);
  for (const field of ['grade', 'netKg', 'moistureBp'] as const) {
    if (receipt[field] !== reading[field]) {
      receipt.amendments.push({ at, field, from: receipt[field], to: reading[field], source, ...(disputeId ? { disputeId } : {}) });
    }
  }
  receipt.grade = reading.grade;
  receipt.netKg = reading.netKg;
  receipt.moistureBp = reading.moistureBp;
}

@Info({ title: 'ReceiptContract', description: 'Deposits, attestation, minting, WRRB, quality checks, withdrawal (spec §5.1, §5.3, §5.4)' })
export class ReceiptContract extends WrtContract {
  constructor() {
    super('ReceiptContract');
  }

  /**
   * Warehouse operator records a deposit with declared figures (spec §5.1 step 1).
   * The chaincode then draws the inspector from the tx ID (step 2).
   */
  @Transaction()
  async RecordDeposit(
    ctx: WrtContext,
    farmerId: string,
    commodity: string,
    declaredJson: string,
    declaredEvidenceJson: string,
    sampleSealNo: string,
  ): Promise<string> {
    const op = requireRole(ctx, 'WarehouseMSP', ['warehouse_operator']);
    const warehouse = await getWarehouse(ctx, op.entityId);
    requireActive(warehouse, 'warehouse');
    requireActive(await getFarmer(ctx, farmerId), 'farmer');
    const declared = parseReading('declared', declaredJson);
    await getPrice(ctx, requireText('commodity', commodity), declared.grade); // known commodity and grade
    const evidence = requireSha256List('declaredEvidence', parseJson('declaredEvidence', declaredEvidenceJson));

    const { inspectorId } = drawInspector(await listInspectors(ctx), ctx.stub.getTxID(), warehouse.id);
    const id = `DEP-${compactId(warehouse.id)}-${pad(await nextSequence(ctx, `deposit~${warehouse.id}`), 4)}`;
    const deposit = await createAsset<Deposit>(
      ctx,
      keys.deposit(ctx, id),
      {
        docType: 'deposit',
        id,
        warehouseId: warehouse.id,
        farmerId,
        commodity,
        declared,
        declaredEvidence: evidence,
        sampleSealNo: requireText('sampleSealNo', sampleSealNo),
        assignedInspectorId: inspectorId,
        status: 'PENDING_ATTESTATION',
      },
      `deposit ${id}`,
    );
    return JSON.stringify(deposit);
  }

  /**
   * The assigned inspector attests (spec §5.1 steps 3–4). Within tolerance and seal
   * verified: mint with the inspector's values. Otherwise: MISMATCH_DISPUTED and an
   * automatic MINT_MISMATCH dispute; no receipt exists.
   */
  @Transaction()
  async SubmitAttestation(ctx: WrtContext, depositId: string, observedJson: string, evidenceJson: string, sampleSealNoVerified: string): Promise<string> {
    const ins = requireRole(ctx, 'InspectorMSP', ['inspector']);
    requireActive(await getInspector(ctx, ins.entityId), 'inspector');
    const deposit = await getDeposit(ctx, depositId);
    if (deposit.assignedInspectorId !== ins.entityId) {
      throw new WrtError('NOT_AUTHORISED', `deposit ${depositId} is assigned to ${deposit.assignedInspectorId}`);
    }
    if (deposit.status !== 'PENDING_ATTESTATION') {
      throw new WrtError('ILLEGAL_TRANSITION', `deposit ${depositId} is ${deposit.status}, not PENDING_ATTESTATION`);
    }
    const policy = await getPolicy(ctx);
    const attestation: Attestation = {
      inspectorId: ins.entityId,
      source: 'HUMAN_INSPECTOR',
      observed: parseReading('observed', observedJson),
      evidence: requireSha256List('evidence', parseJson('evidence', evidenceJson)),
      sampleSealNoVerified: parseBool('sampleSealNoVerified', sampleSealNoVerified),
      attestedAt: txIso(ctx),
    };
    deposit.attestation = attestation;

    const tolerance = checkTolerance(deposit.declared, attestation.observed, attestation.sampleSealNoVerified, policy);
    if (tolerance.withinTolerance) {
      const receipt = await mintReceipt(ctx, deposit, attestation.observed, policy);
      await updateAsset(ctx, keys.deposit(ctx, deposit.id), deposit);
      return JSON.stringify({ outcome: 'MINTED', tolerance, deposit, receipt });
    }
    setDepositStatus(deposit, 'MISMATCH_DISPUTED');
    const dispute = await openDispute(
      ctx,
      { kind: 'DEPOSIT', id: deposit.id },
      'MINT_MISMATCH',
      partyOf(ins),
      `Automatic: ${tolerance.failures.join('; ')}`,
      attestation.evidence,
    );
    deposit.disputeId = dispute.id;
    await updateAsset(ctx, keys.deposit(ctx, deposit.id), deposit);
    return JSON.stringify({ outcome: 'MISMATCH_DISPUTED', tolerance, deposit, dispute });
  }

  /** Regulator records the WRRB receipt number; only then can the receipt be pledged (spec §5.1 step 5, §7.2). */
  @Transaction()
  async RecordWrrbRegistration(ctx: WrtContext, receiptId: string, wrrbReceiptNo: string): Promise<string> {
    const reg = requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    const receipt = await getReceipt(ctx, receiptId);
    if (['CANCELLED', 'REDEEMED', 'LIQUIDATED'].includes(receipt.status)) {
      throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receiptId} is ${receipt.status}`);
    }
    assertTransition('receiptLegal', receipt.legal.status, 'WRRB_REGISTERED');
    receipt.legal = {
      status: 'WRRB_REGISTERED',
      wrrbReceiptNo: requireText('wrrbReceiptNo', wrrbReceiptNo),
      registeredBy: reg.entityId,
      registeredAt: txIso(ctx),
    };
    return JSON.stringify(await updateAsset(ctx, keys.receipt(ctx, receiptId), receipt));
  }

  /**
   * Lender with the lien asks for a quality check; the regulator can order a spot
   * audit on any live receipt (spec §5.4, §7.1). An inspector is drawn from the tx ID.
   */
  @Transaction()
  async RequestQualityCheck(ctx: WrtContext, receiptId: string): Promise<string> {
    const caller = getCaller(ctx);
    const receipt = await getReceipt(ctx, receiptId);
    let reason: QualityCheckReason;
    let party;
    if (caller.role === 'regulator_officer') {
      party = partyOf(requireRole(ctx, 'RegulatorMSP', ['regulator_officer']));
      reason = 'REGULATOR_AUDIT';
    } else {
      const lender = requireRole(ctx, 'LenderMSP', ['lender_officer']);
      if (receipt.lien?.lenderId !== lender.entityId) {
        throw new WrtError('NOT_AUTHORISED', `${lender.entityId} holds no lien on ${receiptId}`);
      }
      party = partyOf(lender);
      reason = 'LENDER_REQUEST';
    }
    if (receipt.status !== 'ISSUED' && receipt.status !== 'PLEDGED') {
      throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receiptId} is ${receipt.status}; quality checks need ISSUED or PLEDGED`);
    }
    if (receipt.pendingQualityCheck) {
      throw new WrtError('ALREADY_EXISTS', `receipt ${receiptId} already has a pending quality check`);
    }
    const { inspectorId } = drawInspector(await listInspectors(ctx), ctx.stub.getTxID(), receipt.warehouseId);
    receipt.pendingQualityCheck = { reason, requestedBy: party, requestedAt: txIso(ctx), assignedInspectorId: inspectorId };
    return JSON.stringify(await updateAsset(ctx, keys.receipt(ctx, receiptId), receipt));
  }

  /**
   * The assigned inspector submits the check (spec §5.4). Values are amended with an
   * amendments entry, then LTV is recomputed: margin call or default may follow.
   */
  @Transaction()
  async SubmitQualityCheck(ctx: WrtContext, receiptId: string, observedJson: string, evidenceJson: string): Promise<string> {
    const ins = requireRole(ctx, 'InspectorMSP', ['inspector']);
    requireActive(await getInspector(ctx, ins.entityId), 'inspector');
    const receipt = await getReceipt(ctx, receiptId);
    const pending = receipt.pendingQualityCheck;
    if (!pending) {
      throw new WrtError('NOT_FOUND', `receipt ${receiptId} has no pending quality check`);
    }
    if (pending.assignedInspectorId !== ins.entityId) {
      throw new WrtError('NOT_AUTHORISED', `quality check on ${receiptId} is assigned to ${pending.assignedInspectorId}`);
    }
    if (receipt.status !== 'ISSUED' && receipt.status !== 'PLEDGED') {
      throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receiptId} is ${receipt.status}`);
    }
    const observed = parseReading('observed', observedJson);
    const evidence = requireSha256List('evidence', parseJson('evidence', evidenceJson));
    if (observed.grade !== receipt.grade || observed.netKg !== receipt.netKg || observed.moistureBp !== receipt.moistureBp) {
      await getPrice(ctx, receipt.commodity, observed.grade); // a new grade needs a price
    }
    amendReceipt(ctx, receipt, observed, 'QUALITY_CHECK');
    const now = txIso(ctx);
    receipt.qualityHistory.push({ at: now, inspectorId: ins.entityId, reason: pending.reason, observed, evidence, txId: ctx.stub.getTxID() });
    receipt.lastQualityCheckAt = now;
    delete receipt.pendingQualityCheck;

    let loan;
    if (receipt.lien) {
      loan = await getLoan(ctx, receipt.lien.loanId);
      if (await assessLtv(ctx, loan, receipt, await getPolicy(ctx))) {
        loan = await updateAsset(ctx, keys.loan(ctx, loan.id), loan);
      }
    }
    const saved = await updateAsset(ctx, keys.receipt(ctx, receiptId), receipt);
    return JSON.stringify({ receipt: saved, loan });
  }

  /** Farmer asks for the crop back; only an ISSUED receipt with no lien (spec §5.3). */
  @Transaction()
  async RequestWithdrawal(ctx: WrtContext, receiptId: string): Promise<string> {
    const farmer = requireRole(ctx, 'WarehouseMSP', ['farmer']);
    const receipt = await getReceipt(ctx, receiptId);
    if (receipt.holderFarmerId !== farmer.entityId) {
      throw new WrtError('NOT_AUTHORISED', `receipt ${receiptId} is held by ${receipt.holderFarmerId}`);
    }
    if (receipt.status !== 'ISSUED' || receipt.lien) {
      throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receiptId} is ${receipt.status}${receipt.lien ? ' with a lien' : ''}; withdrawal needs ISSUED with no lien`);
    }
    if (receipt.withdrawalRequestedAt) {
      throw new WrtError('ALREADY_EXISTS', `withdrawal of ${receiptId} already requested`);
    }
    receipt.withdrawalRequestedAt = txIso(ctx);
    return JSON.stringify(await updateAsset(ctx, keys.receipt(ctx, receiptId), receipt));
  }

  /** Warehouse operator confirms the goods left the store; the receipt is REDEEMED (spec §5.3). */
  @Transaction()
  async ConfirmRelease(ctx: WrtContext, receiptId: string, gatePassNo: string): Promise<string> {
    const op = requireRole(ctx, 'WarehouseMSP', ['warehouse_operator']);
    const receipt = await getReceipt(ctx, receiptId);
    if (receipt.warehouseId !== op.entityId) {
      throw new WrtError('NOT_AUTHORISED', `receipt ${receiptId} is held at ${receipt.warehouseId}`);
    }
    if (!receipt.withdrawalRequestedAt) {
      throw new WrtError('ILLEGAL_TRANSITION', `no withdrawal requested for ${receiptId}`);
    }
    if (receipt.lien) {
      throw new WrtError('ILLEGAL_TRANSITION', `receipt ${receiptId} has a lien`);
    }
    setReceiptStatus(ctx, receipt, 'REDEEMED');
    receipt.release = { gatePassNo: requireText('gatePassNo', gatePassNo), releasedAt: txIso(ctx), releasedBy: op.entityId };
    return JSON.stringify(await updateAsset(ctx, keys.receipt(ctx, receiptId), receipt));
  }
}
