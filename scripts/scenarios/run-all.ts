/** Runs S7 (onboards the MFI) then S1–S6. S5 waits ~4 minutes in real time (demo durations). */
import { main } from '../lib/run.js';
import { s1 } from './S1.js';
import { s2 } from './S2.js';
import { s3 } from './S3.js';
import { s4 } from './S4.js';
import { s5 } from './S5.js';
import { s6 } from './S6.js';
import { s7 } from './S7.js';

const only = process.argv.slice(2).map((a) => a.toUpperCase());
const all: [string, () => Promise<unknown>][] = [
  ['S7', s7],
  ['S1', s1],
  ['S2', s2],
  ['S3', s3],
  ['S4', s4],
  ['S6', s6],
  ['S5', s5],
];
await main('All scenarios', async () => {
  for (const [name, fn] of all) {
    if (only.length === 0 || only.includes(name)) await fn();
  }
});
