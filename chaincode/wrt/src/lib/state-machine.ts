import type {
  DepositStatus,
  DisputeStatus,
  EntityStatus,
  LoanStatus,
  ReceiptLegalStatus,
  ReceiptStatus,
} from '../shared/types';
import { WrtError } from './errors';

/**
 * Every status change in WRT goes through assertTransition (spec §6).
 * Contract code never assigns `status = ...` without calling it first.
 */

export interface StatusByDomain {
  deposit: DepositStatus;
  receipt: ReceiptStatus;
  receiptLegal: ReceiptLegalStatus;
  loan: LoanStatus;
  dispute: DisputeStatus;
  entity: EntityStatus;
}

export type Domain = keyof StatusByDomain;

/** For each domain, each status maps to the statuses it may move to next. */
export type TransitionTable = {
  readonly [D in Domain]: Readonly<Record<StatusByDomain[D], readonly StatusByDomain[D][]>>;
};

// TODO(human): fill in the allowed next statuses for each status, from spec §5,
// then implement assertTransition. Tests: test/lib/state-machine.test.ts
export const TRANSITIONS: TransitionTable = {
  deposit: {
    PENDING_ATTESTATION: [],
    ATTESTED: [],
    MISMATCH_DISPUTED: [],
    REJECTED: [],
  },
  receipt: {
    ISSUED: [],
    PLEDGED: [],
    UNDER_DISPUTE: [],
    DEFAULTED: [],
    LIQUIDATED: [],
    REDEEMED: [],
    CANCELLED: [],
  },
  receiptLegal: {
    PENDING_WRRB: [],
    WRRB_REGISTERED: [],
  },
  loan: {
    OFFERED: [],
    ACCEPTED: [],
    ACTIVE: [],
    MARGIN_CALL: [],
    REPAID: [],
    DEFAULTED: [],
    LIQUIDATED: [],
    CANCELLED: [],
  },
  dispute: {
    OPEN: [],
    REINSPECTION_ASSIGNED: [],
    REINSPECTED: [],
    RESOLVED: [],
  },
  entity: {
    ACTIVE: [],
    SUSPENDED: [],
    REVOKED: [],
  },
};

/** Throws WrtError('ILLEGAL_TRANSITION', ...) unless `to` is listed under `from`. */
export function assertTransition<D extends Domain>(domain: D, from: StatusByDomain[D], to: StatusByDomain[D]): void {
  throw new Error('not implemented');
}
// end TODO(human)
