import { CommitError, CommitStatusError, EndorseError, GatewayError } from '@hyperledger/fabric-gateway';
import { ERROR_CODES } from '@wrt/shared';

/** An error with an HTTP status and a stable code the UI can show verbatim (spec §11). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly txId?: string,
  ) {
    super(message);
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_ARGUMENT: 400,
  NOT_AUTHORISED: 403,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  ILLEGAL_TRANSITION: 409,
  LTV_EXCEEDED: 422,
  ENDORSEMENT_POLICY_FAILURE: 409,
  MVCC_READ_CONFLICT: 409,
  PHANTOM_READ_CONFLICT: 409,
};

const CHAINCODE_ERROR = new RegExp(`(${ERROR_CODES.join('|')}): ([^\\n]*)`);

/** Finds "<CODE>: <message>" from the chaincode inside a Gateway error and its per-peer details. */
function chaincodeMessage(err: GatewayError): { code: string; message: string } | undefined {
  for (const text of [err.message, ...err.details.map((d) => d.message)]) {
    const m = CHAINCODE_ERROR.exec(text);
    if (m) return { code: m[1]!, message: `${m[1]}: ${m[2]!.trim()}` };
  }
  return undefined;
}

/**
 * Maps anything thrown by a submit/evaluate to an HttpError:
 *  - chaincode errors (illegal transition, not authorised, LTV exceeded, ...) keep their code and text;
 *  - commit failures carry the Fabric validation code (e.g. ENDORSEMENT_POLICY_FAILURE);
 *  - not enough reachable peers to satisfy 3-of-4 is reported as such.
 */
export function toHttpError(err: unknown, txId?: string): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof CommitError) {
    const name = validationCodeName(err.code);
    return new HttpError(STATUS_BY_CODE[name] ?? 409, name, `${name}: transaction ${err.transactionId} was rejected by the peers`, err.transactionId);
  }
  if (err instanceof GatewayError) {
    const cc = chaincodeMessage(err);
    if (cc) return new HttpError(STATUS_BY_CODE[cc.code] ?? 400, cc.code, cc.message, txId);
    const text = [err.message, ...err.details.map((d) => `${d.mspId}: ${d.message}`)].join(' | ');
    if (/no combination of peers|endorsement policy|not enough/i.test(text)) {
      return new HttpError(503, 'ENDORSEMENT_POLICY_FAILURE', `ENDORSEMENT_POLICY_FAILURE: cannot reach enough peers to collect 3 of 4 endorsements (${text})`, txId);
    }
    if (err.code === 14 /* UNAVAILABLE */ || err.code === 4 /* DEADLINE_EXCEEDED */) {
      return new HttpError(503, 'PEER_UNAVAILABLE', `PEER_UNAVAILABLE: ${text}`, txId);
    }
    const kind = err instanceof EndorseError ? 'endorse' : err instanceof CommitStatusError ? 'commit status' : 'submit';
    return new HttpError(502, 'FABRIC_ERROR', `FABRIC_ERROR (${kind}): ${text}`, txId);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new HttpError(500, 'INTERNAL', message, txId);
}

// Filled from fabric-protos at startup (see protos.ts) to avoid a circular import.
let codeNames: Record<number, string> = {};
export function setValidationCodeNames(names: Record<number, string>): void {
  codeNames = names;
}
export function validationCodeName(code: number): string {
  return codeNames[code] ?? `TX_VALIDATION_CODE_${code}`;
}
