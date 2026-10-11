/** Status -> chip colour and label (handoff §4). Status is always text + colour. */
export type ChipTone = 'cyan' | 'steel' | 'yellow' | 'red' | 'green' | 'neutral';

const MAP: Record<string, Record<string, [ChipTone, string]>> = {
  receipt: {
    ISSUED: ['cyan', 'Issued'],
    PLEDGED: ['steel', 'Pledged'],
    UNDER_DISPUTE: ['yellow', 'Under dispute'],
    DEFAULTED: ['red', 'Defaulted'],
    LIQUIDATED: ['red', 'Liquidated'],
    CANCELLED: ['red', 'Cancelled'],
    REDEEMED: ['green', 'Redeemed'],
  },
  legal: {
    PENDING_WRRB: ['neutral', 'Pending WRRB'],
    WRRB_REGISTERED: ['green', 'WRRB registered'],
  },
  loan: {
    OFFERED: ['neutral', 'Offered'],
    ACCEPTED: ['neutral', 'Accepted'],
    CANCELLED: ['neutral', 'Cancelled'],
    ACTIVE: ['cyan', 'Active'],
    MARGIN_CALL: ['yellow', 'Margin call'],
    REPAID: ['green', 'Repaid'],
    DEFAULTED: ['red', 'Defaulted'],
    LIQUIDATED: ['red', 'Liquidated'],
  },
  deposit: {
    PENDING_ATTESTATION: ['neutral', 'Awaiting'],
    ATTESTED: ['cyan', 'Attested'],
    MISMATCH_DISPUTED: ['red', 'Mismatch disputed'],
    REJECTED: ['red', 'Rejected'],
  },
  dispute: {
    OPEN: ['red', 'Open'],
    REINSPECTION_ASSIGNED: ['steel', 'Re-inspection assigned'],
    REINSPECTED: ['yellow', 'Reinspected'],
    RESOLVED: ['green', 'Resolved'],
  },
  entity: {
    ACTIVE: ['green', 'Active'],
    SUSPENDED: ['red', 'Suspended'],
    REVOKED: ['red', 'Revoked'],
  },
  escrow: {
    FUND: ['neutral', 'FUND'],
    DISBURSE_TO_FARMER: ['cyan', 'DISBURSE_TO_FARMER'],
    REPAYMENT: ['steel', 'REPAYMENT'],
    RELEASE_TO_LENDER: ['green', 'RELEASE_TO_LENDER'],
    REFUND_TO_LENDER: ['neutral', 'REFUND_TO_LENDER'],
    LIQUIDATION_PROCEEDS: ['red', 'LIQUIDATION_PROCEEDS'],
    SURPLUS_TO_FARMER: ['cyan', 'SURPLUS_TO_FARMER'],
    COMPENSATION: ['yellow', 'COMPENSATION'],
  },
};

export type StatusDomain = keyof typeof MAP;

export function statusChip(domain: StatusDomain, status: string): [ChipTone, string] {
  return MAP[domain]?.[status] ?? ['neutral', status];
}

export const ESCROW_OUTFLOWS = new Set(['DISBURSE_TO_FARMER', 'RELEASE_TO_LENDER', 'REFUND_TO_LENDER', 'SURPLUS_TO_FARMER']);
