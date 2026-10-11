/**
 * WRT data contract, shared by chaincode, backend and frontend.
 *
 * Source: docs/WRT_IMPLEMENTATION_SPEC.md §4 (data model), §3.3–3.4 (PII, roles),
 * §6 (events), §11 (error mapping), plus status mappings in
 * wrt-design/DESIGN_HANDOFF.md §4. Fields not in the spec are marked "Not in spec".
 *
 * Change this file only on purpose: every layer depends on it.
 *
 * Rules:
 *  - No floats. Money is integer TZS, weight integer kg, ratios integer basis points.
 *  - Timestamps are ISO-8601 strings taken from the tx timestamp, never the wall clock.
 *  - [PROPOSED] values (commodities, grades, policy defaults) live in seed data,
 *    not here, so Commodity and Grade are plain strings.
 *  - This file has no imports, so the chaincode can copy it in at package time.
 */

// ===========================================================================
// Units
// ===========================================================================

/** Money in whole Tanzanian shillings. */
export type Tzs = number;
/** Weight in whole kilograms. */
export type Kg = number;
/** Ratio in basis points: 10_000 bp = 100%. Moisture 13.00% = 1300. */
export type BasisPoints = number;
/** Duration in whole seconds. */
export type Seconds = number;
/** ISO-8601 timestamp derived from ctx.stub.getTxTimestamp(). */
export type IsoTimestamp = string;
/** Lowercase hex sha256 digest (evidence files, PII hash). */
export type Sha256Hex = string;
/** Fabric transaction ID. */
export type TxId = string;

export const BP_DENOMINATOR = 10_000;

/** e.g. 'MAIZE'. Allowed values come from seeded reference prices. */
export type Commodity = string;
/** e.g. 'G1'. Allowed values come from seeded reference prices. */
export type Grade = string;

// ===========================================================================
// Organisations and identities (§3.1, §3.4)
// ===========================================================================

export const MSP_IDS = ['WarehouseMSP', 'LenderMSP', 'InspectorMSP', 'RegulatorMSP'] as const;
export type MspId = (typeof MSP_IDS)[number];

/** Value of the `wrt.role` certificate attribute. */
export const ROLES = [
  'warehouse_operator',
  'farmer',
  'lender_officer',
  'inspector',
  'regulator_officer',
] as const;
export type Role = (typeof ROLES)[number];

/** Which org CA issues each role's certificate. Farmers are hosted by the Warehouse org. */
export const ROLE_MSP: Readonly<Record<Role, MspId>> = {
  warehouse_operator: 'WarehouseMSP',
  farmer: 'WarehouseMSP',
  lender_officer: 'LenderMSP',
  inspector: 'InspectorMSP',
  regulator_officer: 'RegulatorMSP',
};

/** Who did something: role plus the `wrt.entityId` they act for. */
export interface PartyRef {
  role: Role;
  entityId: string;
}

// ===========================================================================
// Ledger plumbing (§4)
// ===========================================================================

/** Object types used as the docType field and the composite-key prefix (`objectType~id`). */
export const DOC_TYPES = [
  'warehouse',
  'lender',
  'inspector',
  'farmer',
  'referencePrice', // key: referencePrice~commodity~grade
  'policyParams', // singleton
  'deposit',
  'receipt',
  'loan',
  'escrow', // key: escrow~loanId
  'dispute',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Fields every stored asset carries. */
export interface AssetBase<T extends DocType> {
  docType: T;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** Starts at 1, incremented on each write. */
  version: number;
}

// ===========================================================================
// Registry assets (§4.1)
// ===========================================================================

export const ENTITY_STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export interface Warehouse extends AssetBase<'warehouse'> {
  id: string;
  name: string;
  region: string;
  /** WRRB operating licence number. */
  licenseNo: string;
  capacityKg: Kg;
  /** Indemnity bond / insurance reference (document stays off-chain). */
  bondRef: string;
  status: EntityStatus;
  /** Incremented on FRAUDULENT dispute outcomes. */
  penaltyCount: number;
}

export const LENDER_TYPES = ['BANK', 'MFI', 'SACCO'] as const;
export type LenderType = (typeof LENDER_TYPES)[number];

export interface Lender extends AssetBase<'lender'> {
  id: string;
  name: string;
  type: LenderType;
  licenseNo: string;
  status: EntityStatus;
}

export interface Inspector extends AssetBase<'inspector'> {
  id: string;
  name: string;
  accreditationNo: string;
  status: EntityStatus;
  /** Warehouses this inspector may never be assigned to. */
  conflictWarehouseIds: string[];
}

export interface Farmer extends AssetBase<'farmer'> {
  id: string;
  registeredByWarehouseId: string;
  /** sha256 of the canonical (deterministic) JSON of FarmerPII. */
  piiHash: Sha256Hex;
  status: EntityStatus;
}

/**
 * Stored only in the `farmerPII` private data collection (§3.3), never in
 * public state. Passed to RegisterFarmer as transient data, never as arguments.
 */
export interface FarmerPII {
  farmerId: string;
  fullName: string;
  phone: string;
  /** National ID number (NIDA). */
  nidaNo: string;
  villageOrWard: string;
}

export interface ReferencePrice extends AssetBase<'referencePrice'> {
  commodity: Commodity;
  grade: Grade;
  priceTzsPerKg: Tzs;
  /** Regulator entityId. */
  setBy: string;
  effectiveAt: IsoTimestamp;
}

// ===========================================================================
// Policy parameters (§4.5). Defaults are [PROPOSED] and live in seed data.
// ===========================================================================

/** The time-based parameters, which have both a real and a demo value. */
export interface PolicyDurations {
  marginCallGraceSecs: Seconds;
  maturityGraceSecs: Seconds;
  /** Window after issuance for a MINT_ACCURACY dispute without new evidence. */
  challengeWindowSecs: Seconds;
  /** Max age of the last quality check while a loan is active. */
  qualityCheckIntervalSecs: Seconds;
  /** Attestation freshness required for disbursement. */
  attestationMaxAgeSecs: Seconds;
}

export interface PolicyParams extends AssetBase<'policyParams'> {
  maxLtvBp: BasisPoints;
  marginCallLtvBp: BasisPoints;
  liquidationLtvBp: BasisPoints;
  weightToleranceBp: BasisPoints;
  /** Allowed moisture gap in bp of absolute moisture (100 = 1.0 percentage point). */
  moistureToleranceBp: BasisPoints;
  gradeMustMatch: boolean;
  /**
   * Not in spec as a nested shape: the spec gives each duration a real and a
   * demo value. Chaincode reads `demoDurations` when demoMode is true, otherwise `durations`.
   */
  durations: PolicyDurations;
  demoDurations: PolicyDurations;
  demoMode: boolean;
}

// ===========================================================================
// Deposit and attestation (§4.2, §5.1)
// ===========================================================================

/** A grade / weight / moisture reading, declared or observed. */
export interface CropReading {
  grade: Grade;
  netKg: Kg;
  moistureBp: BasisPoints;
}

export const ATTESTATION_SOURCES = ['HUMAN_INSPECTOR', 'IOT_DEVICE'] as const;
/** IOT_DEVICE is a future-work hook. Chaincode rejects it in the PoC. */
export type AttestationSource = (typeof ATTESTATION_SOURCES)[number];

export interface Attestation {
  inspectorId: string;
  source: AttestationSource;
  /** Future-work hook for IoT oracles. Unused in the PoC. */
  deviceId?: string;
  observed: CropReading;
  evidence: Sha256Hex[];
  sampleSealNoVerified: boolean;
  attestedAt: IsoTimestamp;
}

export const DEPOSIT_STATUSES = [
  'PENDING_ATTESTATION',
  'ATTESTED',
  'MISMATCH_DISPUTED',
  'REJECTED',
] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export interface Deposit extends AssetBase<'deposit'> {
  id: string;
  warehouseId: string;
  farmerId: string;
  commodity: Commodity;
  /** The warehouse operator's figures. */
  declared: CropReading;
  /** Weighbridge ticket photo, sample photo. */
  declaredEvidence: Sha256Hex[];
  /** Tamper seal on the retained sample bag. */
  sampleSealNo: string;
  /** Drawn deterministically from the tx ID (§5.1 step 2). */
  assignedInspectorId: string;
  attestation?: Attestation;
  status: DepositStatus;
  receiptId?: string;
}

// ===========================================================================
// Warehouse receipt (§4.3)
// ===========================================================================

export const RECEIPT_STATUSES = [
  'ISSUED',
  'PLEDGED',
  'UNDER_DISPUTE',
  'DEFAULTED',
  'LIQUIDATED',
  'REDEEMED',
  'CANCELLED',
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_LEGAL_STATUSES = ['PENDING_WRRB', 'WRRB_REGISTERED'] as const;
export type ReceiptLegalStatus = (typeof RECEIPT_LEGAL_STATUSES)[number];

export interface ReceiptLegal {
  status: ReceiptLegalStatus;
  wrrbReceiptNo?: string;
  /** Regulator entityId. */
  registeredBy?: string;
  registeredAt?: IsoTimestamp;
}

export interface Lien {
  loanId: string;
  lenderId: string;
  placedAt: IsoTimestamp;
}

export const QUALITY_CHECK_REASONS = ['LENDER_REQUEST', 'OVERDUE', 'REGULATOR_AUDIT'] as const;
export type QualityCheckReason = (typeof QUALITY_CHECK_REASONS)[number];

/**
 * Not in spec: the open request created by RequestQualityCheck (or flagged by
 * EvaluateLoan when overdue). The inspector queue shows who asked and when.
 */
export interface QualityCheckRequest {
  reason: QualityCheckReason;
  /** Absent when the keeper flagged it as overdue. */
  requestedBy?: PartyRef;
  requestedAt: IsoTimestamp;
  /** Drawn deterministically, excluding conflicted inspectors. */
  assignedInspectorId: string;
}

/** Not defined in the spec: one completed quality check, kept on the receipt. */
export interface QualityCheckSummary {
  at: IsoTimestamp;
  inspectorId: string;
  reason: QualityCheckReason;
  observed: CropReading;
  evidence: Sha256Hex[];
  txId: TxId;
}

export const AMENDABLE_FIELDS = ['grade', 'netKg', 'moistureBp'] as const;
export type AmendableField = (typeof AMENDABLE_FIELDS)[number];

/** A logged change to the receipt's crop values. Never silent. */
export interface Amendment {
  at: IsoTimestamp;
  field: AmendableField;
  from: string | number;
  to: string | number;
  /** Not in spec: quality checks also amend values (§5.4), so the source is recorded. */
  source: 'QUALITY_CHECK' | 'DISPUTE';
  /** Set when source is DISPUTE. */
  disputeId?: string;
}

export interface WarehouseReceipt extends AssetBase<'receipt'> {
  /** e.g. WRT-WH001-000123 */
  id: string;
  depositId: string;
  warehouseId: string;
  holderFarmerId: string;
  commodity: Commodity;
  /** Always the inspector-attested (or later amended) values. */
  grade: Grade;
  netKg: Kg;
  moistureBp: BasisPoints;
  issuedAt: IsoTimestamp;
  /** Storage term end [PROPOSED: issuedAt + 180 days]. */
  expiresAt: IsoTimestamp;
  legal: ReceiptLegal;
  status: ReceiptStatus;
  /** Restored when a dispute closes. */
  statusBeforeDispute?: ReceiptStatus;
  lien?: Lien;
  lastQualityCheckAt: IsoTimestamp;
  qualityHistory: QualityCheckSummary[];
  /** Not in spec: open quality-check request, if any. */
  pendingQualityCheck?: QualityCheckRequest;
  /** Not in spec: set by RequestWithdrawal, cleared by ConfirmRelease. */
  withdrawalRequestedAt?: IsoTimestamp;
  amendments: Amendment[];
}

// ===========================================================================
// Loan and escrow (§4.4, §5.2–5.3, §5.7)
// ===========================================================================

export const LOAN_STATUSES = [
  'OFFERED',
  'ACCEPTED',
  'ACTIVE',
  'MARGIN_CALL',
  'REPAID',
  'DEFAULTED',
  'LIQUIDATED',
  'CANCELLED',
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export interface MarginCall {
  raisedAt: IsoTimestamp;
  deadlineAt: IsoTimestamp;
  requiredPaydownTzs: Tzs;
  reason: string;
}

/** The six disbursement conditions (§5.2), in the order the UI lists them. */
export const DISBURSEMENT_CONDITIONS = [
  'ESCROW_COVERS_PRINCIPAL',
  'LIEN_ON_THIS_LOAN',
  'WRRB_REGISTERED_NOT_EXPIRED',
  'ATTESTATION_FRESH',
  'WAREHOUSE_ACTIVE',
  'NO_OPEN_DISPUTE',
] as const;
export type DisbursementCondition = (typeof DISBURSEMENT_CONDITIONS)[number];

/** Not defined in the spec: one row of the condition checklist. */
export interface ConditionResult {
  condition: DisbursementCondition;
  passed: boolean;
  /** Short evidence shown in mono, e.g. "6,000,000 ≥ 6,000,000" or "3 d old". */
  evidence: string;
}

/** Not in spec: needed to compute pausedSecs when the dispute closes. */
export interface LoanPause {
  disputeId: string;
  pausedAt: IsoTimestamp;
}

export interface Loan extends AssetBase<'loan'> {
  id: string;
  receiptId: string;
  lenderId: string;
  farmerId: string;
  principalTzs: Tzs;
  /** Flat interest for the whole term [PROPOSED]. */
  interestBp: BasisPoints;
  /** principalTzs + floor(principalTzs * interestBp / 10_000). */
  totalDueTzs: Tzs;
  termSecs: Seconds;
  offeredAt: IsoTimestamp;
  acceptedAt?: IsoTimestamp;
  disbursedAt?: IsoTimestamp;
  maturityAt?: IsoTimestamp;
  /** Time frozen by disputes, added to maturity. */
  pausedSecs: Seconds;
  /** Set while a dispute has the loan clock paused. */
  pause?: LoanPause;
  repaidTzs: Tzs;
  status: LoanStatus;
  marginCall?: MarginCall;
  /** Result of the last evaluation, shown in the UI. */
  disbursementConditions: ConditionResult[];
}

export const ESCROW_ENTRY_TYPES = [
  'FUND',
  'DISBURSE_TO_FARMER',
  'REPAYMENT',
  'RELEASE_TO_LENDER',
  'REFUND_TO_LENDER',
  'LIQUIDATION_PROCEEDS',
  'SURPLUS_TO_FARMER',
  'COMPENSATION',
] as const;
export type EscrowEntryType = (typeof ESCROW_ENTRY_TYPES)[number];

export interface EscrowEntry {
  at: IsoTimestamp;
  type: EscrowEntryType;
  /** Always positive. The type says whether money came in or went out. */
  amountTzs: Tzs;
  /** Reference of the simulated off-chain transfer, e.g. MPESA-SIM-4471920. */
  paymentRef: string;
  txId: TxId;
}

/** One per loan, key escrow~loanId. */
export interface Escrow extends AssetBase<'escrow'> {
  loanId: string;
  balanceTzs: Tzs;
  entries: EscrowEntry[];
}

// ===========================================================================
// Disputes (§4.6, §5.6)
// ===========================================================================

export const DISPUTE_SUBJECT_KINDS = ['DEPOSIT', 'RECEIPT'] as const;
export type DisputeSubjectKind = (typeof DISPUTE_SUBJECT_KINDS)[number];

export interface DisputeSubject {
  kind: DisputeSubjectKind;
  id: string;
}

export const DISPUTE_TYPES = [
  'MINT_MISMATCH',
  'MINT_ACCURACY',
  'QUALITY_DEGRADATION',
  'OTHER',
] as const;
export type DisputeType = (typeof DISPUTE_TYPES)[number];

export const DISPUTE_STATUSES = [
  'OPEN',
  'REINSPECTION_ASSIGNED',
  'REINSPECTED',
  'RESOLVED',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_OUTCOMES = [
  'CONFIRMED',
  'CORRECTED',
  'FRAUDULENT',
  'NATURAL_DEGRADATION',
  'STORAGE_NEGLIGENCE',
] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export const LIABILITIES = ['NONE', 'WAREHOUSE', 'FARMER', 'INSPECTOR'] as const;
export type Liability = (typeof LIABILITIES)[number];

export interface Reinspection {
  inspectorId: string;
  assignedAt: IsoTimestamp;
  observed?: CropReading;
  evidence?: Sha256Hex[];
  submittedAt?: IsoTimestamp;
}

export interface DisputeResolution {
  outcome: DisputeOutcome;
  liability: Liability;
  findings: string;
  compensationTzs: Tzs;
  /** Regulator entityId. */
  resolvedBy: string;
  resolvedAt: IsoTimestamp;
}

export interface Dispute extends AssetBase<'dispute'> {
  id: string;
  subject: DisputeSubject;
  type: DisputeType;
  raisedBy: PartyRef;
  claim: string;
  evidence: Sha256Hex[];
  raisedAt: IsoTimestamp;
  reinspection?: Reinspection;
  status: DisputeStatus;
  resolution?: DisputeResolution;
}

// ===========================================================================
// Chaincode events (§6, plus LienReleased from §5.3)
//
// Fabric delivers only one event per transaction: a second setEvent() call
// overwrites the first. So each transaction emits at most one Fabric event,
// named CHAINCODE_EVENT_NAME, whose payload is a ChaincodeEventBatch listing
// every domain event in the order it happened.
// ===========================================================================

export const CHAINCODE_EVENT_NAME = 'WrtEvents';

export interface ChaincodeEventPayloads {
  ReceiptIssued: { receiptId: string; depositId: string; warehouseId: string; holderFarmerId: string };
  ReceiptStatusChanged: { receiptId: string; from: ReceiptStatus; to: ReceiptStatus };
  DisputeOpened: { disputeId: string; subject: DisputeSubject; type: DisputeType; raisedBy: PartyRef };
  DisputeResolved: { disputeId: string; outcome: DisputeOutcome; liability: Liability };
  LoanStatusChanged: { loanId: string; from: LoanStatus; to: LoanStatus };
  EscrowReleased: { loanId: string; type: EscrowEntryType; amountTzs: Tzs };
  MarginCall: { loanId: string; ltvBp: BasisPoints; deadlineAt: IsoTimestamp; requiredPaydownTzs: Tzs };
  LienReleased: { receiptId: string; loanId: string };
}

export type ChaincodeEventName = keyof ChaincodeEventPayloads;

/** Discriminated union of every domain event, keyed by `name`. */
export type ChaincodeEvent = {
  [N in ChaincodeEventName]: { name: N; payload: ChaincodeEventPayloads[N] };
}[ChaincodeEventName];

/** Payload of the single CHAINCODE_EVENT_NAME event a transaction emits. */
export interface ChaincodeEventBatch {
  txId: TxId;
  /** Never empty: a transaction with nothing to report emits no event. */
  events: ChaincodeEvent[];
}

// ===========================================================================
// Error codes (§11). Chaincode errors start with a code; the UI shows them verbatim.
// ===========================================================================

export const ERROR_CODES = [
  'ILLEGAL_TRANSITION',
  'NOT_AUTHORISED',
  'LTV_EXCEEDED',
  'ENDORSEMENT_POLICY_FAILURE',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'INVALID_ARGUMENT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
