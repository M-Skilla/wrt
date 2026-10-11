import type { Dispute, DisputeSubject, DisputeType, PartyRef, Sha256Hex } from '../shared/types';
import type { WrtContext } from './context';
import { nextSequence, pad } from './counter';
import { keys } from './lookups';
import { createAsset } from './state';
import { txIso } from './time';

/** Creates an OPEN dispute with the next DSP-NNNN id and emits DisputeOpened. */
export async function openDispute(
  ctx: WrtContext,
  subject: DisputeSubject,
  type: DisputeType,
  raisedBy: PartyRef,
  claim: string,
  evidence: Sha256Hex[],
): Promise<Dispute> {
  const id = `DSP-${pad(await nextSequence(ctx, 'dispute'), 4)}`;
  const dispute = await createAsset<Dispute>(
    ctx,
    keys.dispute(ctx, id),
    { docType: 'dispute', id, subject, type, raisedBy, claim, evidence, raisedAt: txIso(ctx), status: 'OPEN' },
    `dispute ${id}`,
  );
  ctx.emit('DisputeOpened', { disputeId: id, subject, type, raisedBy });
  return dispute;
}
