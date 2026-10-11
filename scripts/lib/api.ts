/**
 * Minimal typed client for the WRT API, acting as one demo identity at a time.
 * Every scenario step goes through the same REST endpoints the UI uses.
 */
const BASE = process.env.WRT_API ?? 'http://localhost:3001';

export interface Tx {
  txId: string;
  blockNumber: number;
  endorsers: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(identity: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(identity ? { 'X-WRT-Identity': identity } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } } & T;
  if (!res.ok) {
    throw new ApiError(res.status, json.error?.code ?? 'HTTP_' + res.status, json.error?.message ?? res.statusText);
  }
  return json;
}

export function as(identity: string) {
  return {
    get: <T = any>(path: string) => request<T>(identity, 'GET', path),
    post: <T = any>(path: string, body: unknown = {}) => request<{ result: T; tx: Tx }>(identity, 'POST', path, body),
    put: <T = any>(path: string, body: unknown) => request<{ result: T; tx: Tx }>(identity, 'PUT', path, body),
  };
}

export const anon = {
  get: <T = any>(path: string) => request<T>(null, 'GET', path),
  post: <T = any>(path: string) => request<T>(null, 'POST', path, {}),
};

export const ID = {
  wh001: 'wh-001-operator',
  wh002: 'wh-002-operator',
  frm001: 'frm-001-farmer',
  frm002: 'frm-002-farmer',
  frm003: 'frm-003-farmer',
  frm004: 'frm-004-farmer',
  bank: 'lnd-bank-01-officer',
  mfi: 'lnd-mfi-01-officer',
  ins: (id: string) => `${id.toLowerCase()}-inspector`,
  reg: 'reg-01-officer',
  keeper: 'keeper-svc',
} as const;
