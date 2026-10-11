import type { Iterators } from 'fabric-shim';
import { fromBytes } from './serialize';

/** Drains a state iterator (range, partial composite key or rich query) into parsed values. */
export async function collect<T>(iteratorPromise: Promise<Iterators.StateQueryIterator> | Iterators.StateQueryIterator): Promise<T[]> {
  const iterator = await iteratorPromise;
  const out: T[] = [];
  try {
    for (;;) {
      const res = await iterator.next();
      if (res.value && res.value.value && res.value.value.length > 0) {
        out.push(fromBytes<T>(res.value.value));
      }
      if (res.done) break;
    }
  } finally {
    await iterator.close();
  }
  return out;
}

export interface HistoryEntry<T> {
  txId: string;
  timestamp: string;
  isDelete: boolean;
  value: T | null;
}

/** Every committed version of a key (getHistoryForKey only returns valid txs). Order is the peer's; callers sort. */
export async function collectHistory<T>(iteratorPromise: Promise<Iterators.HistoryQueryIterator>): Promise<HistoryEntry<T>[]> {
  const iterator = await iteratorPromise;
  const out: HistoryEntry<T>[] = [];
  try {
    for (;;) {
      const res = await iterator.next();
      if (res.value) {
        const ts = res.value.timestamp;
        const secs = typeof ts.seconds === 'number' ? ts.seconds : ts.seconds.toNumber();
        out.push({
          txId: res.value.txId,
          timestamp: new Date(secs * 1000 + Math.floor(ts.nanos / 1e6)).toISOString(),
          isDelete: res.value.isDelete,
          value: res.value.value && res.value.value.length > 0 ? fromBytes<T>(res.value.value) : null,
        });
      }
      if (res.done) break;
    }
  } finally {
    await iterator.close();
  }
  return out;
}
