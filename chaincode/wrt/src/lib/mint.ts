import type { CropReading, Deposit, PolicyParams, WarehouseReceipt } from '../shared/types';
import type { WrtContext } from './context';
import { compactId, nextSequence, pad } from './counter';
import { keys } from './lookups';
import { durations } from './policy';
import { createAsset } from './state';
import { setDepositStatus } from './status';
import { isoFromSeconds, txIso, txSeconds } from './time';

/**
 * Mints a receipt for a deposit with the given reading (the inspector's, or the
 * declared/re-inspected values after a MINT_MISMATCH ruling). Status ISSUED,
 * legal status PENDING_WRRB (spec §5.1 step 4).
 */
export async function mintReceipt(ctx: WrtContext, deposit: Deposit, reading: CropReading, policy: PolicyParams): Promise<WarehouseReceipt> {
  const seq = await nextSequence(ctx, `receipt~${deposit.warehouseId}`);
  const id = `WRT-${compactId(deposit.warehouseId)}-${pad(seq, 6)}`;
  const now = txIso(ctx);
  const receipt = await createAsset<WarehouseReceipt>(
    ctx,
    keys.receipt(ctx, id),
    {
      docType: 'receipt',
      id,
      depositId: deposit.id,
      warehouseId: deposit.warehouseId,
      holderFarmerId: deposit.farmerId,
      commodity: deposit.commodity,
      grade: reading.grade,
      netKg: reading.netKg,
      moistureBp: reading.moistureBp,
      issuedAt: now,
      expiresAt: isoFromSeconds(txSeconds(ctx) + durations(policy).receiptTermSecs),
      legal: { status: 'PENDING_WRRB' },
      status: 'ISSUED',
      lastQualityCheckAt: deposit.attestation?.attestedAt ?? now,
      qualityHistory: [],
      amendments: [],
    },
    `receipt ${id}`,
  );
  setDepositStatus(deposit, 'ATTESTED');
  deposit.receiptId = id;
  ctx.emit('ReceiptIssued', { receiptId: id, depositId: deposit.id, warehouseId: deposit.warehouseId, holderFarmerId: deposit.farmerId });
  return receipt;
}
