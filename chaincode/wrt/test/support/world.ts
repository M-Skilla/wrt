/**
 * A tiny in-memory "network": one shared ledger, transactions run one after
 * another, each with a new tx ID and a clock that moves forward. Events are
 * flushed through afterTransaction exactly as Fabric would.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DisputeContract } from '../../src/contracts/dispute';
import { LoanContract } from '../../src/contracts/loan';
import { QueryContract } from '../../src/contracts/query';
import { ReceiptContract } from '../../src/contracts/receipt';
import { RegistryContract } from '../../src/contracts/registry';
import type { WrtContract, WrtContext } from '../../src/lib/context';
import { CALLERS, type Caller, MockStub, mockContext } from './mocks';

export const SEED = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../scripts/seed-data.json'), 'utf8'));

export const contracts = {
  registry: new RegistryContract(),
  receipt: new ReceiptContract(),
  loan: new LoanContract(),
  dispute: new DisputeContract(),
  query: new QueryContract(),
};

type ContractName = keyof typeof contracts;

export const HASH = (c: string) => c.repeat(64).slice(0, 64);

export class World {
  readonly stub = new MockStub();
  private tx = 0;
  private last: { name: string; payload: any }[] = [];

  /** Runs one transaction as `caller` and returns the parsed result. */
  async call<T = any>(caller: Caller, contract: ContractName, fn: string, ...args: string[]): Promise<T> {
    this.tx += 1;
    this.stub.txId = `tx-${String(this.tx).padStart(4, '0')}`;
    this.stub.txSeconds += 1;
    const ctx = mockContext(caller, this.stub);
    const before = this.stub.events.length;
    const c = contracts[contract] as unknown as WrtContract & Record<string, (ctx: WrtContext, ...a: string[]) => Promise<string>>;
    const out = await c[fn]!(ctx, ...args);
    await c.afterTransaction(ctx, out);
    this.last = this.stub.events.slice(before)[0]?.payload.events ?? [];
    return JSON.parse(out) as T;
  }

  /** Moves the clock forward without a transaction. */
  advance(secs: number): void {
    this.stub.txSeconds += secs;
  }

  /** Domain events emitted by the most recent call (empty if it emitted none). */
  lastEvents(): { name: string; payload: any }[] {
    return this.last;
  }

  eventNames(): string[] {
    return this.lastEvents().map((e) => e.name);
  }

  get<T = any>(docType: string, id: string): Promise<T> {
    return this.call<T>(CALLERS.reg, 'query', 'Get', docType, id);
  }
}

/** Initialised ledger with the seed data and FRM-001 registered by WH-001. */
export async function seededWorld(): Promise<World> {
  const w = new World();
  await w.call(CALLERS.reg, 'registry', 'InitLedger', JSON.stringify(SEED));
  const mfi = SEED._onboarding['LND-MFI-01'];
  await w.call(CALLERS.reg, 'registry', 'RegisterLender', mfi.id, mfi.name, mfi.type, mfi.licenseNo);
  for (const id of ['FRM-001', 'FRM-002']) {
    w.stub.transient = new Map([['pii', Buffer.from(JSON.stringify({ fullName: `Farmer ${id}`, phone: '+255700000001', nidaNo: `NIDA-${id}`, villageOrWard: 'Kongwa' }))]]);
    await w.call(CALLERS.wh001, 'registry', 'RegisterFarmer', id);
  }
  w.stub.transient = new Map();
  return w;
}

export const MAIZE_G1 = { grade: 'G1', netKg: 12400, moistureBp: 1340 };

/** Records a deposit and returns it with the drawn inspector as a caller. */
export async function deposit(w: World, declared = MAIZE_G1, farmerId = 'FRM-001') {
  const dep = await w.call(CALLERS.wh001, 'receipt', 'RecordDeposit', farmerId, 'MAIZE', JSON.stringify(declared), JSON.stringify([HASH('a')]), 'TZ-SL-0098812');
  return { dep, inspector: inspectorCaller(dep.assignedInspectorId) };
}

export function inspectorCaller(id: string): Caller {
  return { mspId: 'InspectorMSP', role: 'inspector', entityId: id };
}

/** Deposit -> attestation within tolerance -> WRRB registration. Returns the receipt. */
export async function registeredReceipt(w: World, reading = MAIZE_G1, farmerId = 'FRM-001') {
  const { dep, inspector } = await deposit(w, reading, farmerId);
  const att = await w.call(inspector, 'receipt', 'SubmitAttestation', dep.id, JSON.stringify(reading), JSON.stringify([HASH('b')]), 'true');
  return w.call(CALLERS.reg, 'receipt', 'RecordWrrbRegistration', att.receipt.id, `WRRB/DOD/${att.receipt.id}`);
}

/** Offer -> accept -> fund (auto-disburse). Returns the loan id. */
export async function activeLoan(w: World, receiptId: string, principal = 6_000_000, termSecs = 600) {
  const loan = await w.call(CALLERS.mfi, 'loan', 'OfferLoan', receiptId, String(principal), '900', String(termSecs));
  await w.call(CALLERS.frm001, 'loan', 'AcceptLoan', loan.id);
  await w.call(CALLERS.mfi, 'loan', 'FundEscrow', loan.id, String(principal), 'BANK-SIM-77104');
  return loan.id as string;
}
