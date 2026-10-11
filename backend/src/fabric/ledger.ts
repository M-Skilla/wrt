import type { FastifyBaseLogger } from 'fastify';
import { contractFor } from './gateway.js';
import { HttpError, toHttpError, validationCodeName } from './errors.js';
import { endorsersOfPrepared } from './protos.js';

const utf8 = new TextDecoder();
let log: FastifyBaseLogger | Console = console;
export function setLedgerLogger(logger: FastifyBaseLogger): void {
  log = logger;
}

export interface TxInfo {
  txId: string;
  blockNumber: number;
  endorsers: string[];
}

export interface SubmitOptions {
  /** Private inputs (e.g. farmer PII): sent to endorsers, never written to the block. */
  transient?: Record<string, string>;
  /** Pin the endorsing orgs, e.g. the farmerPII collection members. */
  endorsingOrgs?: string[];
}

function parse<T>(bytes: Uint8Array): T {
  const text = utf8.decode(bytes);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Submit = endorse (3 of 4 peers run the chaincode and sign) -> order -> commit.
 * Used for anything that changes state. Waits for the commit and fails if the
 * peers marked the tx invalid (e.g. ENDORSEMENT_POLICY_FAILURE, MVCC_READ_CONFLICT).
 */
export async function submit<T>(identity: string, fn: string, args: string[], opts: SubmitOptions = {}): Promise<{ result: T; tx: TxInfo }> {
  const proposal = contractFor(identity).newProposal(fn, {
    arguments: args,
    ...(opts.transient ? { transientData: opts.transient } : {}),
    ...(opts.endorsingOrgs ? { endorsingOrganizations: opts.endorsingOrgs } : {}),
  });
  const txId = proposal.getTransactionId();
  try {
    const transaction = await proposal.endorse();
    const endorsers = endorsersOfPrepared(transaction.getBytes());
    const commit = await transaction.submit();
    const status = await commit.getStatus();
    const blockNumber = Number(status.blockNumber);
    if (!status.successful) {
      const name = validationCodeName(status.code);
      log.warn({ txId, fn, identity, endorsers, block: blockNumber, status: name }, 'tx rejected at commit');
      throw new HttpError(409, name, `${name}: transaction ${txId} was rejected by the peers`, txId);
    }
    log.info({ txId, fn, identity, endorsers, block: blockNumber }, 'tx committed');
    return { result: parse<T>(transaction.getResult()), tx: { txId, blockNumber, endorsers } };
  } catch (err) {
    const mapped = toHttpError(err, txId);
    if (!(err instanceof HttpError)) log.warn({ txId, fn, identity, code: mapped.code, message: mapped.message }, 'tx failed');
    throw mapped;
  }
}

/** Evaluate = run the chaincode on the identity's own peer only. Read-only: nothing is ordered or written. */
export async function evaluate<T>(identity: string, fn: string, args: string[] = []): Promise<T> {
  try {
    return parse<T>(await contractFor(identity).evaluateTransaction(fn, ...args));
  } catch (err) {
    throw toHttpError(err);
  }
}
