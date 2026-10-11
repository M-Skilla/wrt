import { createHash } from 'node:crypto';
import { ApiError, type Tx } from './api.js';

const c = { dim: '\x1b[2m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', bold: '\x1b[1m', reset: '\x1b[0m' };
let stepNo = 0;

export function title(text: string): void {
  stepNo = 0;
  console.log(`\n${c.bold}${text}${c.reset}`);
}

/** Runs and logs one step. Logs the tx id and endorsing orgs for submits. */
export async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  stepNo++;
  const out = await fn();
  const tx = (out as { tx?: Tx } | undefined)?.tx;
  const meta = tx ? ` ${c.dim}block ${tx.blockNumber} · tx ${tx.txId.slice(0, 8)}… · ${tx.endorsers.map((e) => e.replace('MSP', '')).join(' ')}${c.reset}` : '';
  console.log(`  ${c.green}✓${c.reset} ${String(stepNo).padStart(2)}. ${label}${meta}`);
  return out;
}

/** A step that must fail with the given error code. */
export async function expectError(label: string, code: string, fn: () => Promise<unknown>): Promise<ApiError> {
  stepNo++;
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === code) {
      console.log(`  ${c.green}✓${c.reset} ${String(stepNo).padStart(2)}. ${label} ${c.yellow}→ ${err.message}${c.reset}`);
      return err;
    }
    throw err;
  }
  throw new Error(`expected ${code} for "${label}", but it succeeded`);
}

export function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(`check failed: ${message}`);
  console.log(`     ${c.dim}✓ ${message}${c.reset}`);
}

export function note(text: string): void {
  console.log(`     ${c.dim}${text}${c.reset}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Waits in real time (demo durations), printing a countdown every 30 s. */
export async function wait(secs: number, why: string): Promise<void> {
  note(`waiting ${secs}s: ${why}`);
  for (let left = secs; left > 0; left -= 30) {
    await sleep(Math.min(30, left) * 1000);
    if (left - 30 > 0) note(`  ${left - 30}s left`);
  }
}

/** Deterministic fake evidence hash, as if a photo had been uploaded. */
export function evidence(label: string): string {
  return createHash('sha256').update(label).digest('hex');
}

export async function main(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    console.log(`\n${c.green}${c.bold}${name} passed${c.reset} ${c.dim}(${Math.round((Date.now() - start) / 1000)}s)${c.reset}`);
  } catch (err) {
    console.error(`\n${c.red}${c.bold}${name} FAILED:${c.reset} ${(err as Error).message}`);
    process.exitCode = 1;
    throw err;
  }
}

export function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
}
