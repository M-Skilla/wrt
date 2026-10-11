/** API client. Every request carries the demo identity header; the backend maps it to a wallet identity. */
const IDENTITY_KEY = 'wrt.identity';

export function storedIdentity(): string | null {
  try {
    return localStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
}

export function storeIdentity(label: string | null): void {
  try {
    if (label) localStorage.setItem(IDENTITY_KEY, label);
    else localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // storage unavailable (private mode): identity lives for this page only
  }
}

export interface TxInfo {
  txId: string;
  blockNumber: number;
  endorsers: string[];
}

export interface TxResult<T> {
  result: T;
  tx: TxInfo;
}

/** An error from the API. `message` is the chaincode text, shown verbatim (spec §11). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly txId?: string,
  ) {
    super(message);
  }
}

let currentIdentity: string | null = storedIdentity();
export function setApiIdentity(label: string | null): void {
  currentIdentity = label;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (currentIdentity) headers['X-WRT-Identity'] = currentIdentity;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  } catch {
    throw new ApiError(0, 'API_UNREACHABLE', 'API_UNREACHABLE: the WRT backend is not responding on :3001');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; txId?: string } };
  if (!res.ok) {
    throw new ApiError(res.status, json.error?.code ?? `HTTP_${res.status}`, json.error?.message ?? res.statusText, json.error?.txId);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<TxResult<T>>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<TxResult<T>>('PUT', path, body),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ sha256: string; size: number; filename: string }>('POST', '/uploads', form);
  },
};
