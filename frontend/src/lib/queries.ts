/** Data hooks. Every read is evaluated on the current identity's own peer by the backend. */
import { useQuery } from '@tanstack/react-query';
import type { Deposit, Dispute, Farmer, FarmerPII, Inspector, Lender, Loan, PolicyParams, ReferencePrice, Warehouse, WarehouseReceipt } from '@wrt/shared';
import { api } from './api';
import type { DisputeView, ExplorerTx, HistoryRow, KeeperInfo, LoanView, NetworkInfo, ReceiptView, StreamEvent, WalletIdentity } from './types';

function qs(params: Record<string, string | undefined>): string {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][];
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
}

export const useIdentities = () => useQuery({ queryKey: ['identities'], queryFn: () => api.get<WalletIdentity[]>('/identities') });
export const useNetwork = () => useQuery({ queryKey: ['network'], queryFn: () => api.get<NetworkInfo>('/network'), refetchInterval: 5_000 });

export const usePolicy = () => useQuery({ queryKey: ['policy'], queryFn: () => api.get<PolicyParams>('/policy') });
export const usePrices = () => useQuery({ queryKey: ['prices'], queryFn: () => api.get<ReferencePrice[]>('/prices') });
export const useWarehouses = () => useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<Warehouse[]>('/warehouses') });
export const useLenders = () => useQuery({ queryKey: ['lenders'], queryFn: () => api.get<Lender[]>('/lenders') });
export const useInspectors = () => useQuery({ queryKey: ['inspectors'], queryFn: () => api.get<Inspector[]>('/inspectors') });
export const useFarmers = (registeredByWarehouseId?: string) =>
  useQuery({ queryKey: ['farmers', registeredByWarehouseId], queryFn: () => api.get<Farmer[]>(`/farmers${qs({ registeredByWarehouseId })}`) });
export const useFarmerPII = (farmerId: string | undefined, enabled = true) =>
  useQuery({ queryKey: ['pii', farmerId], queryFn: () => api.get<FarmerPII>(`/farmers/${farmerId}/pii`), enabled: !!farmerId && enabled, retry: false, staleTime: 300_000 });

export const useDeposits = (f: { warehouseId?: string; status?: string; assignedInspectorId?: string; farmerId?: string } = {}, enabled = true) =>
  useQuery({ queryKey: ['deposits', f], queryFn: () => api.get<Deposit[]>(`/deposits${qs(f)}`), enabled });
export const useReceipts = (
  f: { warehouseId?: string; holderFarmerId?: string; status?: string; legal_status?: string; lien_lenderId?: string; pendingQualityCheck_assignedInspectorId?: string } = {},
  enabled = true,
) => useQuery({ queryKey: ['receipts', f], queryFn: () => api.get<WarehouseReceipt[]>(`/receipts${qs(f)}`), enabled });
export const useReceipt = (id: string | undefined) => useQuery({ queryKey: ['receipt', id], queryFn: () => api.get<ReceiptView>(`/receipts/${id}`), enabled: !!id });
export const useReceiptHistory = (id: string | undefined) =>
  useQuery({ queryKey: ['receipt-history', id], queryFn: () => api.get<HistoryRow<WarehouseReceipt>[]>(`/receipts/${id}/history`), enabled: !!id });

export const useLoans = (f: { lenderId?: string; farmerId?: string; status?: string; receiptId?: string } = {}, enabled = true) =>
  useQuery({ queryKey: ['loans', f], queryFn: () => api.get<Loan[]>(`/loans${qs(f)}`), enabled });
export const useLoanViews = (f: { lenderId?: string; farmerId?: string; status?: string } = {}, enabled = true) =>
  useQuery({ queryKey: ['loan-views', f], queryFn: () => api.get<LoanView[]>(`/loans${qs({ ...f, view: '1' })}`), enabled });
export const useLoan = (id: string | undefined) => useQuery({ queryKey: ['loan', id], queryFn: () => api.get<LoanView>(`/loans/${id}`), enabled: !!id });
export const useLoanHistory = (id: string | undefined) =>
  useQuery({ queryKey: ['loan-history', id], queryFn: () => api.get<HistoryRow<Loan>[]>(`/loans/${id}/history`), enabled: !!id });

export const useDisputes = (f: { status?: string; type?: string; subject_id?: string; reinspection_inspectorId?: string } = {}, enabled = true) =>
  useQuery({ queryKey: ['disputes', f], queryFn: () => api.get<Dispute[]>(`/disputes${qs(f)}`), enabled });
export const useDispute = (id: string | undefined) => useQuery({ queryKey: ['dispute', id], queryFn: () => api.get<DisputeView>(`/disputes/${id}`), enabled: !!id });
export const useDisputeHistory = (id: string | undefined) =>
  useQuery({ queryKey: ['dispute-history', id], queryFn: () => api.get<HistoryRow<Dispute>[]>(`/disputes/${id}/history`), enabled: !!id });

export const useExplorerTxs = (status?: 'rejected' | 'valid', limit = 50) =>
  useQuery({ queryKey: ['explorer', status, limit], queryFn: () => api.get<{ height: number; txs: ExplorerTx[] }>(`/explorer/txs${qs({ status, limit: String(limit) })}`) });
export const useKeeper = () => useQuery({ queryKey: ['keeper'], queryFn: () => api.get<KeeperInfo>('/keeper') });
export const useRecentEvents = () => useQuery({ queryKey: ['events-recent'], queryFn: () => api.get<StreamEvent[]>('/events/recent') });
