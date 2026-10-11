import type { Deposit, WarehouseReceipt } from '@wrt/shared';
import { ID, as } from './api.js';
import { evidence, step } from './run.js';

export interface Reading {
  grade: string;
  netKg: number;
  moistureBp: number;
}

export const MAIZE_G1: Reading = { grade: 'G1', netKg: 12400, moistureBp: 1340 };
let seal = Date.now() % 1_000_000;

/** Warehouse records a deposit; the chaincode draws the inspector. */
export async function recordDeposit(warehouse: string, farmerId: string, commodity: string, declared: Reading): Promise<Deposit> {
  const { result } = await step(`${warehouse} records deposit for ${farmerId}: ${commodity} ${declared.grade} ${declared.netKg} kg`, () =>
    as(warehouse).post<Deposit>('/deposits', {
      farmerId,
      commodity,
      declared,
      declaredEvidence: [evidence(`weighbridge-${farmerId}-${seal}`), evidence(`sample-photo-${seal}`)],
      sampleSealNo: `TZ-SL-${String(seal++).padStart(7, '0')}`,
    }),
  );
  return result;
}

/** The drawn inspector attests. */
export async function attest(deposit: Deposit, observed: Reading, sealVerified = true) {
  const inspector = ID.ins(deposit.assignedInspectorId);
  return (
    await step(`${deposit.assignedInspectorId} (drawn from tx hash) attests: ${observed.grade} ${observed.netKg} kg`, () =>
      as(inspector).post<{ outcome: string; receipt?: WarehouseReceipt; dispute?: { id: string } }>(`/deposits/${deposit.id}/attestation`, {
        observed,
        evidence: [evidence(`inspection-${deposit.id}`)],
        sampleSealNoVerified: sealVerified,
      }),
    )
  ).result;
}

/** Deposit -> attestation within tolerance -> WRRB registration. */
export async function mintRegisteredReceipt(warehouse: string, farmerId: string, reading = MAIZE_G1, commodity = 'MAIZE'): Promise<WarehouseReceipt> {
  const deposit = await recordDeposit(warehouse, farmerId, commodity, reading);
  const minted = await attest(deposit, reading);
  if (!minted.receipt) throw new Error(`expected a receipt, got ${minted.outcome}`);
  const receiptId = minted.receipt.id;
  const { result } = await step(`REG-01 records WRRB registration for ${receiptId}`, () =>
    as(ID.reg).post<WarehouseReceipt>(`/receipts/${receiptId}/wrrb`, { wrrbReceiptNo: `WRRB/${warehouse.slice(0, 6).toUpperCase()}/${receiptId.slice(-6)}` }),
  );
  return result;
}

/** Offer -> accept -> fund (auto-disburses). Returns the loan id. */
export async function activeLoan(lender: string, farmer: string, receiptId: string, principalTzs: number, termSecs: number): Promise<string> {
  const { result: loan } = await step(`${lender} offers ${principalTzs.toLocaleString('en-US')} TZS against ${receiptId}`, () =>
    as(lender).post<{ id: string }>('/loans', { receiptId, principalTzs, interestBp: 900, termSecs }),
  );
  await step(`${farmer} accepts ${loan.id}: lien placed, escrow opened`, () => as(farmer).post(`/loans/${loan.id}/accept`));
  const { result } = await step(`${lender} funds escrow: conditions checked, auto-disbursed`, () =>
    as(lender).post<{ released: boolean }>(`/loans/${loan.id}/fund`, { amountTzs: principalTzs, paymentRef: `BANK-SIM-${Date.now() % 100000}` }),
  );
  if (!result.released) throw new Error('expected automatic disbursement');
  return loan.id;
}
