import type { ErrorCode } from '../shared/types';

/**
 * Every chaincode error message starts with a code from shared ERROR_CODES,
 * e.g. "ILLEGAL_TRANSITION: receipt PLEDGED -> REDEEMED". The backend maps the
 * code to an HTTP status and the UI shows the message verbatim (spec §11).
 */
export class WrtError extends Error {
  constructor(
    readonly code: ErrorCode,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'WrtError';
  }
}
