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

// Allowed moves, derived from the workflows in spec §5. Statuses with an empty
// list are terminal. Choices beyond the spec are noted inline.
export const TRANSITIONS: TransitionTable = {
  deposit: {
    PENDING_ATTESTATION: ['ATTESTED', 'MISMATCH_DISPUTED'], // §5.1 step 4
    MISMATCH_DISPUTED: ['ATTESTED', 'REJECTED'], // §5.6 MINT_MISMATCH ruling
    ATTESTED: [],
    REJECTED: [],
  },
  receipt: {
    ISSUED: ['PLEDGED', 'UNDER_DISPUTE', 'REDEEMED'],
    PLEDGED: ['ISSUED', 'UNDER_DISPUTE', 'DEFAULTED'],
    // Restores statusBeforeDispute, or CANCELLED on FRAUDULENT. A CORRECTED ruling that
    // pushes LTV past liquidation restores PLEDGED first, then defaults.
    UNDER_DISPUTE: ['ISSUED', 'PLEDGED', 'CANCELLED'],
    // Decision: a defaulted receipt can't be disputed; it goes to liquidation.
    DEFAULTED: ['LIQUIDATED'],
    LIQUIDATED: [],
    REDEEMED: [],
    CANCELLED: [],
  },
  receiptLegal: {
    PENDING_WRRB: ['WRRB_REGISTERED'],
    WRRB_REGISTERED: [],
  },
  loan: {
    OFFERED: ['ACCEPTED', 'CANCELLED'],
    // Decision: an accepted but undisbursed loan can be cancelled (escrow refunded to the
    // lender, lien lifted), e.g. by the lender or by a FRAUDULENT ruling on the receipt.
    ACCEPTED: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['MARGIN_CALL', 'REPAID', 'DEFAULTED'],
    MARGIN_CALL: ['ACTIVE', 'REPAID', 'DEFAULTED'],
    DEFAULTED: ['LIQUIDATED'],
    REPAID: [],
    LIQUIDATED: [],
    CANCELLED: [],
  },
  dispute: {
    OPEN: ['REINSPECTION_ASSIGNED'],
    REINSPECTION_ASSIGNED: ['REINSPECTED'],
    REINSPECTED: ['RESOLVED'],
    RESOLVED: [],
  },
  entity: {
    ACTIVE: ['SUSPENDED', 'REVOKED'],
    SUSPENDED: ['ACTIVE', 'REVOKED'],
    REVOKED: [],
  },
};

/** Throws WrtError('ILLEGAL_TRANSITION', ...) unless `to` is listed under `from`. */
export function assertTransition<D extends Domain>(domain: D, from: StatusByDomain[D], to: StatusByDomain[D]): void {
  const table = TRANSITIONS[domain] as Readonly<Record<StatusByDomain[D], readonly StatusByDomain[D][]>>;
  if (!table[from].includes(to)) {
    throw new WrtError('ILLEGAL_TRANSITION', `${domain} ${from} -> ${to}`);
  }
}
