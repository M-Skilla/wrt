import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { networkFor } from './gateway.js';
import { parseBlock, type ParsedTx } from './protos.js';

export interface ExplorerTx extends Omit<ParsedTx, 'chaincodeEvent'> {
  blockNumber: number;
  validationCode: string;
  eventNames: string[];
}

/**
 * In-memory index of every transaction on the channel, built from the block stream
 * starting at block 0. Key history (GetHistory) only returns VALID writes; rejected
 * attempts such as scenario S6 are only visible here, in the blocks.
 */
const byTxId = new Map<string, ExplorerTx>();
const ordered: ExplorerTx[] = [];
let height = 0;
let running = false;

export function explorerHeight(): number {
  return height;
}

export function txById(txId: string): ExplorerTx | undefined {
  return byTxId.get(txId);
}

export function recentTxs(limit = 50, filter?: (t: ExplorerTx) => boolean): ExplorerTx[] {
  const out: ExplorerTx[] = [];
  for (let i = ordered.length - 1; i >= 0 && out.length < limit; i--) {
    const t = ordered[i]!;
    if (!filter || filter(t)) out.push(t);
  }
  return out;
}

export function txsInBlock(block: number): ExplorerTx[] {
  return ordered.filter((t) => t.blockNumber === block);
}

function eventNames(payload: Uint8Array | undefined): string[] {
  if (!payload) return [];
  try {
    const batch = JSON.parse(Buffer.from(payload).toString('utf8')) as { events?: { name: string }[] };
    return (batch.events ?? []).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function startExplorer(log: FastifyBaseLogger): Promise<void> {
  if (running) return;
  running = true;
  let next = 0n;
  for (;;) {
    try {
      const blocks = await networkFor(config.serviceIdentity).getBlockEvents({ startBlock: next });
      for await (const block of blocks) {
        const parsed = parseBlock(block);
        for (const t of parsed.txs) {
          const { chaincodeEvent, ...rest } = t;
          const entry: ExplorerTx = { ...rest, blockNumber: parsed.number, eventNames: eventNames(chaincodeEvent?.payload) };
          if (!byTxId.has(entry.txId)) ordered.push(entry);
          byTxId.set(entry.txId, entry);
        }
        height = parsed.number + 1;
        next = BigInt(height);
      }
    } catch (err) {
      log.warn({ err: (err as Error).message, resumeFrom: Number(next) }, 'block stream dropped; reconnecting');
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}
