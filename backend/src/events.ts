import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type { ChaincodeEvent, ChaincodeEventBatch } from '@wrt/shared';
import { config } from './config.js';
import { networkFor } from './fabric/gateway.js';

export type StreamEvent = ChaincodeEvent & {
  /** Monotonic id for SSE Last-Event-ID resume. */
  id: number;
  txId: string;
  blockNumber: number;
  receivedAt: string;
  /** MSP of the submitting client, when known. */
  org?: string;
};

const RECENT_LIMIT = 300;
const recent: StreamEvent[] = [];
const clients = new Set<FastifyReply>();
let seq = 0;

export function recentEvents(sinceId = 0): StreamEvent[] {
  return recent.filter((e) => e.id > sinceId);
}

function broadcast(event: StreamEvent): void {
  recent.push(event);
  if (recent.length > RECENT_LIMIT) recent.shift();
  const frame = `id: ${event.id}\nevent: wrt\ndata: ${JSON.stringify(event)}\n\n`;
  for (const reply of clients) reply.raw.write(frame);
}

/**
 * Server-Sent Events endpoint. Replays anything the client missed (Last-Event-ID),
 * then streams live; a heartbeat comment keeps proxies from closing the connection.
 */
export function attachSseClient(reply: FastifyReply, lastEventId: number): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': config.corsOrigin,
  });
  reply.raw.write('retry: 3000\n\n');
  for (const e of recentEvents(lastEventId)) {
    reply.raw.write(`id: ${e.id}\nevent: wrt\ndata: ${JSON.stringify(e)}\n\n`);
  }
  clients.add(reply);
  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
  reply.raw.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(reply);
  });
}

/**
 * Listens to WRT chaincode events from block 0 and fans them out over SSE.
 * Each Fabric event is a batch (one per tx); it is split into domain events here.
 * On a dropped connection it resumes from the last block it saw, skipping the
 * transactions of that block it already delivered.
 */
export async function startEventListener(log: FastifyBaseLogger, orgOf: (txId: string) => string | undefined): Promise<void> {
  let resumeBlock = 0n;
  let deliveredInResumeBlock = new Set<string>();
  for (;;) {
    try {
      const events = await networkFor(config.serviceIdentity).getChaincodeEvents(config.chaincode, { startBlock: resumeBlock });
      for await (const ev of events) {
        if (ev.blockNumber !== resumeBlock) {
          resumeBlock = ev.blockNumber;
          deliveredInResumeBlock = new Set();
        }
        if (deliveredInResumeBlock.has(ev.transactionId)) continue;
        deliveredInResumeBlock.add(ev.transactionId);
        const batch = JSON.parse(Buffer.from(ev.payload).toString('utf8')) as ChaincodeEventBatch;
        const org = orgOf(ev.transactionId);
        for (const domain of batch.events) {
          broadcast({
            ...domain,
            id: ++seq,
            txId: ev.transactionId,
            blockNumber: Number(ev.blockNumber),
            receivedAt: new Date().toISOString(),
            ...(org ? { org } : {}),
          });
        }
      }
    } catch (err) {
      log.warn({ err: (err as Error).message, resumeFrom: Number(resumeBlock) }, 'event stream dropped; reconnecting');
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}
