import type { Dispute, Escrow, Loan, PolicyParams, ReferencePrice, WarehouseReceipt } from '@wrt/shared';
import { HttpError } from '../fabric/errors.js';
import { evaluate } from '../fabric/ledger.js';
import { txById } from '../fabric/explorer.js';

/** Display-only LTV in bp, integer division (decisions are made in chaincode). */
export function ltvBp(amount: number, collateral: number): number | null {
  if (collateral <= 0) return null;
  return Number((BigInt(amount) * 10_000n) / BigInt(collateral));
}

export async function priceOf(identity: string, commodity: string, grade: string): Promise<ReferencePrice | null> {
  try {
    return await evaluate<ReferencePrice>(identity, 'QueryContract:Get', ['referencePrice', `${commodity}~${grade}`]);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

export async function maybe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

export interface LoanView {
  loan: Loan;
  escrow: Escrow | null;
  receipt: WarehouseReceipt;
  price: ReferencePrice | null;
  collateralTzs: number | null;
  outstandingTzs: number;
  ltvBp: number | null;
  policy: Pick<PolicyParams, 'maxLtvBp' | 'marginCallLtvBp' | 'liquidationLtvBp' | 'demoMode' | 'durations' | 'demoDurations'>;
}

export async function loanView(identity: string, loan: Loan, policy?: PolicyParams): Promise<LoanView> {
  const [receipt, escrow, pol] = await Promise.all([
    evaluate<WarehouseReceipt>(identity, 'QueryContract:GetReceipt', [loan.receiptId]),
    maybe(evaluate<Escrow>(identity, 'QueryContract:GetEscrow', [loan.id])),
    policy ? Promise.resolve(policy) : evaluate<PolicyParams>(identity, 'QueryContract:GetPolicyParams'),
  ]);
  const price = await priceOf(identity, receipt.commodity, receipt.grade);
  const collateralTzs = price ? receipt.netKg * price.priceTzsPerKg : null;
  const outstandingTzs = Math.max(0, loan.totalDueTzs - loan.repaidTzs);
  const basis = loan.status === 'OFFERED' || loan.status === 'ACCEPTED' ? loan.principalTzs : outstandingTzs;
  return {
    loan,
    escrow,
    receipt,
    price,
    collateralTzs,
    outstandingTzs,
    ltvBp: collateralTzs ? ltvBp(basis, collateralTzs) : null,
    policy: {
      maxLtvBp: pol.maxLtvBp,
      marginCallLtvBp: pol.marginCallLtvBp,
      liquidationLtvBp: pol.liquidationLtvBp,
      demoMode: pol.demoMode,
      durations: pol.durations,
      demoDurations: pol.demoDurations,
    },
  };
}

export interface HistoryRow<T> {
  version: number | null;
  txId: string;
  timestamp: string;
  isDelete: boolean;
  value: T | null;
  fn: string | null;
  creator: { mspId: string; name: string; role: string | null; entityId: string | null } | null;
  endorsers: string[];
  blockNumber: number | null;
}

/** GetHistory joined with block data: which function, who signed, which orgs endorsed. */
export async function historyOf<T>(identity: string, docType: string, id: string): Promise<HistoryRow<T>[]> {
  const rows = await evaluate<{ txId: string; timestamp: string; isDelete: boolean; value: T | null }[]>(identity, 'QueryContract:GetHistory', [docType, id]);
  // Newest first, as the LedgerHistory component lists v_N … v1 (Fabric's order is not guaranteed).
  rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return rows.map((r) => {
    const tx = txById(r.txId);
    return {
      ...r,
      version: (r.value as { version?: number } | null)?.version ?? null,
      fn: tx?.fn ?? null,
      creator: tx?.creator ?? null,
      endorsers: tx?.endorsers ?? [],
      blockNumber: tx?.blockNumber ?? null,
    };
  });
}

export async function disputesFor(identity: string, subjectId: string): Promise<Dispute[]> {
  return evaluate<Dispute[]>(identity, 'QueryContract:List', ['dispute', JSON.stringify({ 'subject.id': subjectId })]);
}
