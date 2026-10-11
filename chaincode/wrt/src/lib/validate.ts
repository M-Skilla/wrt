import { WrtError } from './errors';

/**
 * Input parsing for contract arguments, which always arrive as strings.
 * No floats anywhere (spec §0.5): "1.5", "1e3", "0x10" and " 7" are all rejected.
 */

const INTEGER = /^(0|-?[1-9]\d*)$/;

export function parseInteger(name: string, raw: string, opts: { min?: number; max?: number } = {}): number {
  if (typeof raw !== 'string' || !INTEGER.test(raw)) {
    throw new WrtError('INVALID_ARGUMENT', `${name} must be an integer, got "${raw}"`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new WrtError('INVALID_ARGUMENT', `${name} is out of range: ${raw}`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new WrtError('INVALID_ARGUMENT', `${name} must be ≥ ${opts.min}, got ${value}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new WrtError('INVALID_ARGUMENT', `${name} must be ≤ ${opts.max}, got ${value}`);
  }
  return value;
}

/** Non-negative integer amount (TZS, kg, seconds). */
export function parseAmount(name: string, raw: string): number {
  return parseInteger(name, raw, { min: 0 });
}

/** Basis points, 0..10_000. */
export function parseBp(name: string, raw: string): number {
  return parseInteger(name, raw, { min: 0, max: 10_000 });
}

/** Same rules as parseInteger, for numbers that arrived inside a JSON argument. */
export function requireInteger(name: string, value: unknown, opts: { min?: number; max?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new WrtError('INVALID_ARGUMENT', `${name} must be an integer, got ${JSON.stringify(value)}`);
  }
  return parseInteger(name, String(value), opts);
}

export function requireText(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WrtError('INVALID_ARGUMENT', `${name} is required`);
  }
  return value;
}

export function parseJson<T>(name: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new WrtError('INVALID_ARGUMENT', `${name} is not valid JSON`);
  }
}

export function requireOneOf<T extends string>(name: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new WrtError('INVALID_ARGUMENT', `${name} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function requireSha256List(name: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((h) => typeof h === 'string' && SHA256_HEX.test(h))) {
    throw new WrtError('INVALID_ARGUMENT', `${name} must be an array of lowercase hex sha256 hashes`);
  }
  return value as string[];
}
