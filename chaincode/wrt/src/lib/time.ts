import type { Context } from 'fabric-contract-api';
import type { IsoTimestamp, Seconds } from '../shared/types';

/**
 * All chaincode time comes from the transaction timestamp, which the client sets
 * once and every endorsing peer sees identically. Date.now() would differ per peer.
 * Whole seconds only: durations in WRT are integer seconds.
 */
export function txSeconds(ctx: Context): Seconds {
  return ctx.stub.getTxTimestamp().seconds.toNumber();
}

export function txIso(ctx: Context): IsoTimestamp {
  return isoFromSeconds(txSeconds(ctx));
}

export function isoFromSeconds(secs: Seconds): IsoTimestamp {
  return new Date(secs * 1000).toISOString();
}

export function secondsFromIso(iso: IsoTimestamp): Seconds {
  return Math.floor(Date.parse(iso) / 1000);
}
