import type { FastifyBaseLogger } from 'fastify';
import type { Loan } from '@wrt/shared';
import { config } from './config.js';
import { evaluate, submit } from './fabric/ledger.js';

export interface KeeperRun {
  at: string;
  checked: number;
  submitted: { loanId: string; fn: string; txId: string }[];
  errors: { loanId: string; message: string }[];
}

let lastRun: KeeperRun | undefined;
let busy = false;

export function lastKeeperRun(): KeeperRun | undefined {
  return lastRun;
}

/**
 * One keeper pass (spec §5.5). For every open loan, first EVALUATE the check
 * (a dry run on one peer, nothing written); only if it reports a change is the
 * same function SUBMITTED for 3-of-4 endorsement. The rules live in chaincode,
 * so anyone with any identity could run this and get the same outcome.
 */
export async function runKeeper(log: FastifyBaseLogger): Promise<KeeperRun> {
  const run: KeeperRun = { at: new Date().toISOString(), checked: 0, submitted: [], errors: [] };
  if (busy) return lastRun ?? run;
  busy = true;
  try {
    const id = config.keeperIdentity;
    const loans = await evaluate<Loan[]>(id, 'QueryContract:List', ['loan', JSON.stringify({ status: { $in: ['ACCEPTED', 'ACTIVE', 'MARGIN_CALL'] } })]);
    for (const loan of loans) {
      run.checked++;
      const fn = loan.status === 'ACCEPTED' ? 'LoanContract:EvaluateDisbursement' : 'LoanContract:EvaluateLoan';
      try {
        const dry = await evaluate<{ changed?: boolean; released?: boolean }>(id, fn, [loan.id]);
        if (dry.changed || dry.released) {
          const { tx } = await submit(id, fn, [loan.id]);
          run.submitted.push({ loanId: loan.id, fn, txId: tx.txId });
        }
      } catch (err) {
        run.errors.push({ loanId: loan.id, message: (err as Error).message });
      }
    }
    if (run.submitted.length || run.errors.length) log.info({ keeper: run }, 'keeper pass');
  } catch (err) {
    run.errors.push({ loanId: '*', message: (err as Error).message });
    log.warn({ err: (err as Error).message }, 'keeper pass failed');
  } finally {
    busy = false;
    lastRun = run;
  }
  return run;
}

export function startKeeper(log: FastifyBaseLogger): void {
  if (!config.keeperEnabled) {
    log.info('keeper disabled (KEEPER_ENABLED=false)');
    return;
  }
  log.info({ everyMs: config.keeperIntervalMs, identity: config.keeperIdentity }, 'keeper enabled');
  setInterval(() => void runKeeper(log), config.keeperIntervalMs).unref();
}
