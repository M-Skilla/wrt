import { Info, Transaction } from 'fabric-contract-api';
import { DOC_TYPES, type DocType, type FarmerPII } from '../shared/types';
import { getCaller } from '../lib/access';
import { WrtContext, WrtContract } from '../lib/context';
import { WrtError } from '../lib/errors';
import { collect, collectHistory } from '../lib/iter';
import { assetKey, policyKey } from '../lib/keys';
import { keys } from '../lib/lookups';
import { getAsset } from '../lib/state';
import { fromBytes } from '../lib/serialize';
import { parseJson, requireOneOf } from '../lib/validate';
import { PII_COLLECTION } from './registry';

/**
 * Fields each docType may be filtered on in List(). Each has a CouchDB index under
 * META-INF/statedb/couchdb/indexes, so no query scans the whole database.
 */
const FILTERABLE: Partial<Record<DocType, readonly string[]>> = {
  warehouse: ['status', 'region'],
  lender: ['status', 'type'],
  inspector: ['status'],
  farmer: ['status', 'registeredByWarehouseId'],
  referencePrice: ['commodity', 'grade'],
  deposit: ['status', 'warehouseId', 'farmerId', 'assignedInspectorId'],
  receipt: ['status', 'warehouseId', 'holderFarmerId', 'legal.status', 'lien.lenderId', 'pendingQualityCheck.assignedInspectorId'],
  loan: ['status', 'lenderId', 'farmerId', 'receiptId'],
  dispute: ['status', 'type', 'subject.id', 'reinspection.inspectorId'],
};

/** PII collection members (spec §3.3). Inspectors are excluded. */
const PII_READERS = ['WarehouseMSP', 'LenderMSP', 'RegulatorMSP'];

@Info({ title: 'QueryContract', description: 'Read-only queries, history and PII (spec §6)' })
export class QueryContract extends WrtContract {
  constructor() {
    super('QueryContract');
  }

  /** The caller's MSP and wrt.* attributes, as the chaincode sees them. */
  @Transaction(false)
  async WhoAmI(ctx: WrtContext): Promise<string> {
    return JSON.stringify(getCaller(ctx));
  }

  /** One asset by docType and id. referencePrice ids are "COMMODITY~GRADE"; policyParams ignores the id. */
  @Transaction(false)
  async Get(ctx: WrtContext, docType: string, id: string): Promise<string> {
    const type = requireOneOf('docType', docType, DOC_TYPES);
    const key = type === 'policyParams' ? policyKey(ctx) : assetKey(ctx, type, ...id.split('~'));
    return JSON.stringify(await getAsset(ctx, key, `${type} ${id}`));
  }

  /** Convenience getters named as in spec §6 ("Get<Asset>"). */
  @Transaction(false)
  async GetReceipt(ctx: WrtContext, id: string): Promise<string> {
    return this.Get(ctx, 'receipt', id);
  }

  @Transaction(false)
  async GetLoan(ctx: WrtContext, id: string): Promise<string> {
    return this.Get(ctx, 'loan', id);
  }

  @Transaction(false)
  async GetEscrow(ctx: WrtContext, loanId: string): Promise<string> {
    return this.Get(ctx, 'escrow', loanId);
  }

  @Transaction(false)
  async GetDispute(ctx: WrtContext, id: string): Promise<string> {
    return this.Get(ctx, 'dispute', id);
  }

  @Transaction(false)
  async GetDeposit(ctx: WrtContext, id: string): Promise<string> {
    return this.Get(ctx, 'deposit', id);
  }

  @Transaction(false)
  async GetPolicyParams(ctx: WrtContext): Promise<string> {
    return this.Get(ctx, 'policyParams', 'current');
  }

  /**
   * CouchDB rich query over one docType, e.g. List('receipt', '{"warehouseId":"WH-001","status":{"$in":["ISSUED","PLEDGED"]}}').
   * Values are exact matches or {"$in": [...]}. Results are sorted by id here, so the
   * order is stable whatever CouchDB returns.
   */
  @Transaction(false)
  async List(ctx: WrtContext, docType: string, filterJson: string): Promise<string> {
    const type = requireOneOf('docType', docType, DOC_TYPES);
    const filter = parseJson<Record<string, unknown>>('filter', filterJson || '{}');
    const allowed = FILTERABLE[type] ?? [];
    const selector: Record<string, unknown> = { docType: type };
    for (const [field, value] of Object.entries(filter).sort(([a], [b]) => a.localeCompare(b))) {
      if (!allowed.includes(field)) {
        throw new WrtError('INVALID_ARGUMENT', `${type} cannot be filtered on ${field}; allowed: ${allowed.join(', ') || 'none'}`);
      }
      const isIn = typeof value === 'object' && value !== null && Array.isArray((value as { $in?: unknown }).$in);
      if (!(typeof value === 'string' || isIn)) {
        throw new WrtError('INVALID_ARGUMENT', `filter ${field} must be a string or {"$in": [...]}`);
      }
      selector[field] = value;
    }
    const rows = await collect<Record<string, unknown>>(ctx.stub.getQueryResult(JSON.stringify({ selector })));
    const id = (r: Record<string, unknown>) => String(r.id ?? r.loanId ?? `${String(r.commodity)}~${String(r.grade)}`);
    rows.sort((a, b) => id(a).localeCompare(id(b)));
    return JSON.stringify(rows);
  }

  /** Every committed version of an asset with its tx ID and time (spec §6, GetHistory). */
  @Transaction(false)
  async GetHistory(ctx: WrtContext, docType: string, id: string): Promise<string> {
    const type = requireOneOf('docType', docType, DOC_TYPES);
    const key = type === 'policyParams' ? policyKey(ctx) : assetKey(ctx, type, ...id.split('~'));
    return JSON.stringify(await collectHistory(ctx.stub.getHistoryForKey(key)));
  }

  /** Farmer PII from the private collection: Warehouse, Lender and Regulator members only. */
  @Transaction(false)
  async GetFarmerPII(ctx: WrtContext, farmerId: string): Promise<string> {
    const caller = getCaller(ctx);
    if (!PII_READERS.includes(caller.mspId)) {
      throw new WrtError('NOT_AUTHORISED', `${caller.mspId} is not a member of ${PII_COLLECTION}`);
    }
    const bytes = await ctx.stub.getPrivateData(PII_COLLECTION, keys.farmer(ctx, farmerId));
    if (!bytes || bytes.length === 0) {
      throw new WrtError('NOT_FOUND', `no PII for farmer ${farmerId}`);
    }
    return JSON.stringify(fromBytes<FarmerPII>(bytes));
  }
}
