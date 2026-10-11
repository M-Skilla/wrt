import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { config } from './config.js';
import { HttpError } from './fabric/errors.js';

/**
 * Evidence files stay off-chain (spec §11): stored under uploads/ named by their
 * sha256, and only the hash goes on-chain. Reading a file re-hashes it, so a
 * swapped file is detected instead of served.
 */
export function storeUpload(data: Buffer, filename: string): { sha256: string; size: number; filename: string } {
  mkdirSync(config.uploadDir, { recursive: true });
  const sha256 = createHash('sha256').update(data).digest('hex');
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const target = path.join(config.uploadDir, `${sha256}${ext}`);
  if (!existsSync(target)) writeFileSync(target, data);
  return { sha256, size: data.length, filename };
}

export function readUpload(sha256: string): { data: Buffer; file: string; verified: boolean } {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new HttpError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT: not a sha256 hash');
  const file = existsSync(config.uploadDir) ? readdirSync(config.uploadDir).find((f) => f.startsWith(sha256)) : undefined;
  if (!file) throw new HttpError(404, 'NOT_FOUND', `NOT_FOUND: no evidence file for ${sha256}`);
  const data = readFileSync(path.join(config.uploadDir, file));
  const verified = createHash('sha256').update(data).digest('hex') === sha256;
  return { data, file, verified };
}
