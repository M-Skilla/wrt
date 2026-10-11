/** API response shapes beyond the shared data contract. */
import type { Deposit, Dispute, Escrow, Lender, Loan, PolicyParams, ReferencePrice, WarehouseReceipt } from '@wrt/shared';

export interface WalletIdentity {
  label: string;
  mspId: string;
  role: string | null;
  entityId: string | null;
  displayName?: string;
  detail?: string;
}

export interface Me {
  identity: WalletIdentity;
  chaincodeView: { mspId: string; role: string | null; entityId: string | null };
  entity: (Record<string, unknown> & { id?: string; name?: string; status?: string; type?: string }) | null;
  hostingTier: 1 | 2;
}

export interface NetworkInfo {
  channel: string;
  chaincode: string;
  height: number;
  policy: string;
  peers: Record<string, boolean>;
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

export interface ReceiptView {
  receipt: WarehouseReceipt;
  deposit: Deposit | null;
  price: ReferencePrice | null;
  collateralTzs: number | null;
  policy: PolicyParams;
  disputes: Dispute[];
  loans: Loan[];
  activeLoan: LoanView | null;
}

export interface DisputeView {
  dispute: Dispute;
  deposit: Deposit | null;
  receipt: WarehouseReceipt | null;
  loan: Loan | null;
}

export interface HistoryRow<T = Record<string, unknown>> {
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

export interface ExplorerTx {
  txId: string;
  timestamp: string;
  creator: { mspId: string; name: string; role: string | null; entityId: string | null };
  fn: string;
  args: string[];
  endorsers: string[];
  writes: { key: string; isDelete: boolean; value: unknown }[];
  blockNumber: number;
  validationCode: string;
  eventNames: string[];
}

export interface StreamEvent {
  id: number;
  name: string;
  payload: Record<string, unknown>;
  txId: string;
  blockNumber: number;
  receivedAt: string;
  org?: string;
}

export interface KeeperInfo {
  enabled: boolean;
  intervalMs: number;
  identity: string;
  lastRun: { at: string; checked: number; submitted: { loanId: string; fn: string; txId: string }[]; errors: { loanId: string; message: string }[] } | null;
}

export type { Lender };
