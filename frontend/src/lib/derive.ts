/** Derived views shared by pages and the sidebar counts. */
import type { Deposit, Dispute, WarehouseReceipt } from '@wrt/shared';
import { useDeposits, useDisputes, useReceipts, useWarehouses } from './queries';

const LIVE_RECEIPT = ['ISSUED', 'PLEDGED', 'UNDER_DISPUTE', 'DEFAULTED'];

/** Receipts the chaincode would accept in OfferLoan: ISSUED, WRRB-registered, unexpired, no withdrawal, warehouse ACTIVE. */
export function useEligibleCollateral(): { data: WarehouseReceipt[] | undefined; isLoading: boolean; error: unknown } {
  const receipts = useReceipts({ status: 'ISSUED', legal_status: 'WRRB_REGISTERED' });
  const warehouses = useWarehouses();
  const active = new Set((warehouses.data ?? []).filter((w) => w.status === 'ACTIVE').map((w) => w.id));
  const now = Date.now();
  const data =
    receipts.data && warehouses.data
      ? receipts.data.filter((r) => !r.withdrawalRequestedAt && new Date(r.expiresAt).getTime() > now && active.has(r.warehouseId))
      : undefined;
  return { data, isLoading: receipts.isLoading || warehouses.isLoading, error: receipts.error ?? warehouses.error };
}

export function useCustody(warehouseId: string | undefined) {
  const q = useReceipts({ warehouseId, status: LIVE_RECEIPT.join(',') }, !!warehouseId);
  return q;
}

export interface InspectorQueue {
  attest: Deposit[];
  quality: WarehouseReceipt[];
  reinspect: Dispute[];
}

export function useInspectorQueue(inspectorId: string | undefined): { data: InspectorQueue | undefined; isLoading: boolean; error: unknown } {
  const deposits = useDeposits({ assignedInspectorId: inspectorId, status: 'PENDING_ATTESTATION' }, !!inspectorId);
  const receipts = useReceipts({ pendingQualityCheck_assignedInspectorId: inspectorId }, !!inspectorId);
  const disputes = useDisputes({ reinspection_inspectorId: inspectorId, status: 'REINSPECTION_ASSIGNED' }, !!inspectorId);
  const data =
    deposits.data && receipts.data && disputes.data ? { attest: deposits.data, quality: receipts.data, reinspect: disputes.data } : undefined;
  return { data, isLoading: deposits.isLoading || receipts.isLoading || disputes.isLoading, error: deposits.error ?? receipts.error ?? disputes.error };
}

export const queueSize = (q: InspectorQueue | undefined) => (q ? q.attest.length + q.quality.length + q.reinspect.length : undefined);
