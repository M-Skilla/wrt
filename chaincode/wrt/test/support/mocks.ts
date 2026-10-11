/**
 * In-memory stand-ins for the Fabric stub and client identity, so contract
 * functions run in plain Jest with no network. Only the stub methods WRT uses
 * are implemented; add more as later contracts need them.
 */
import type { ChaincodeEventBatch, MspId, Role } from '../../src/shared/types';
import { WrtContext } from '../../src/lib/context';

export interface Caller {
  mspId: MspId;
  role?: Role;
  entityId?: string;
}

interface Kv {
  key: string;
  value: Uint8Array;
}

/** Same next()/close() protocol as fabric-shim's iterators. */
function iterator<T>(items: T[]) {
  let i = 0;
  return {
    async next() {
      return i < items.length ? { value: items[i++], done: false } : { value: undefined, done: true };
    },
    async close() {},
  };
}

function pathValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Minimal CouchDB selector: exact match or {"$in": [...]}, on dotted paths. */
function matches(doc: unknown, selector: Record<string, unknown>): boolean {
  return Object.entries(selector).every(([field, cond]) => {
    const actual = pathValue(doc, field);
    if (cond && typeof cond === 'object' && Array.isArray((cond as { $in?: unknown[] }).$in)) {
      return (cond as { $in: unknown[] }).$in.includes(actual);
    }
    return actual === cond;
  });
}

export class MockStub {
  readonly state = new Map<string, Uint8Array>();
  readonly history = new Map<string, { txId: string; seconds: number; isDelete: boolean; value: Uint8Array }[]>();
  readonly privateData = new Map<string, Map<string, Uint8Array>>();
  readonly events: { name: string; payload: ChaincodeEventBatch }[] = [];
  txId = 'tx-0000';
  txSeconds = Date.UTC(2026, 9, 11, 9, 41) / 1000; // 11 Oct 2026 09:41 UTC, the handoff's "today"
  transient = new Map<string, Uint8Array>();

  async getState(key: string): Promise<Uint8Array> {
    return this.state.get(key) ?? new Uint8Array();
  }

  async putState(key: string, value: Uint8Array): Promise<void> {
    this.state.set(key, value);
    const list = this.history.get(key) ?? [];
    list.push({ txId: this.txId, seconds: this.txSeconds, isDelete: false, value });
    this.history.set(key, list);
  }

  async deleteState(key: string): Promise<void> {
    this.state.delete(key);
  }

  async getStateByPartialCompositeKey(objectType: string, attributes: string[]) {
    const prefix = this.createCompositeKey(objectType, attributes);
    const rows: Kv[] = [...this.state.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => ({ key, value }));
    return iterator(rows);
  }

  async getQueryResult(query: string) {
    const { selector } = JSON.parse(query) as { selector: Record<string, unknown> };
    const rows: Kv[] = [];
    for (const [key, value] of this.state.entries()) {
      let doc: unknown;
      try {
        doc = JSON.parse(Buffer.from(value).toString('utf8'));
      } catch {
        continue;
      }
      if (matches(doc, selector)) rows.push({ key, value });
    }
    return iterator(rows);
  }

  async getHistoryForKey(key: string) {
    const rows = (this.history.get(key) ?? []).map((h) => ({
      txId: h.txId,
      isDelete: h.isDelete,
      value: h.value,
      timestamp: { seconds: { toNumber: () => h.seconds }, nanos: 0 },
    }));
    return iterator(rows);
  }

  async putPrivateData(collection: string, key: string, value: Uint8Array): Promise<void> {
    const c = this.privateData.get(collection) ?? new Map<string, Uint8Array>();
    c.set(key, value);
    this.privateData.set(collection, c);
  }

  async getPrivateData(collection: string, key: string): Promise<Uint8Array> {
    return this.privateData.get(collection)?.get(key) ?? new Uint8Array();
  }

  createCompositeKey(objectType: string, attributes: string[]): string {
    // Same format as fabric-shim: \u0000 objectType \u0000 attr \u0000 ...
    return `\u0000${objectType}\u0000${attributes.map((a) => `${a}\u0000`).join('')}`;
  }

  getTxID(): string {
    return this.txId;
  }

  getTxTimestamp(): { seconds: { toNumber(): number }; nanos: number } {
    const secs = this.txSeconds;
    return { seconds: { toNumber: () => secs }, nanos: 0 };
  }

  getTransient(): Map<string, Uint8Array> {
    return this.transient;
  }

  setEvent(name: string, payload: Uint8Array): void {
    this.events.push({ name, payload: JSON.parse(Buffer.from(payload).toString('utf8')) });
  }
}

export class MockIdentity {
  constructor(private readonly caller: Caller) {}

  getMSPID(): string {
    return this.caller.mspId;
  }

  getID(): string {
    return `x509::CN=${this.caller.entityId ?? 'admin'}`;
  }

  getAttributeValue(name: string): string | null {
    if (name === 'wrt.role') return this.caller.role ?? null;
    if (name === 'wrt.entityId') return this.caller.entityId ?? null;
    return null;
  }
}

/** A WrtContext wired to a fresh (or shared) MockStub, acting as `caller`. */
export function mockContext(caller: Caller, stub: MockStub = new MockStub()): WrtContext & { stub: MockStub } {
  const ctx = new WrtContext() as WrtContext & { stub: MockStub };
  (ctx as unknown as { stub: MockStub }).stub = stub;
  (ctx as unknown as { clientIdentity: MockIdentity }).clientIdentity = new MockIdentity(caller);
  return ctx;
}

/** The seed identities from network/identities.conf, for readable tests. */
export const CALLERS = {
  wh001: { mspId: 'WarehouseMSP', role: 'warehouse_operator', entityId: 'WH-001' },
  wh002: { mspId: 'WarehouseMSP', role: 'warehouse_operator', entityId: 'WH-002' },
  frm001: { mspId: 'WarehouseMSP', role: 'farmer', entityId: 'FRM-001' },
  bank: { mspId: 'LenderMSP', role: 'lender_officer', entityId: 'LND-BANK-01' },
  mfi: { mspId: 'LenderMSP', role: 'lender_officer', entityId: 'LND-MFI-01' },
  ins01: { mspId: 'InspectorMSP', role: 'inspector', entityId: 'INS-01' },
  ins02: { mspId: 'InspectorMSP', role: 'inspector', entityId: 'INS-02' },
  reg: { mspId: 'RegulatorMSP', role: 'regulator_officer', entityId: 'REG-01' },
} as const satisfies Record<string, Caller>;
