import { createHash } from 'crypto';
import { Info, Transaction } from 'fabric-contract-api';
import {
  ENTITY_STATUSES,
  LENDER_TYPES,
  type EntityStatus,
  type Farmer,
  type FarmerPII,
  type Inspector,
  type Lender,
  type PolicyDurations,
  type PolicyParams,
  type ReferencePrice,
  type Warehouse,
} from '../shared/types';
import { requireRole } from '../lib/access';
import { WrtContext, WrtContract } from '../lib/context';
import { WrtError } from '../lib/errors';
import { assetKey, policyKey } from '../lib/keys';
import { getWarehouse, keys, requireActive } from '../lib/lookups';
import { readAsset, createAsset, getAsset, updateAsset } from '../lib/state';
import { assertTransition } from '../lib/state-machine';
import { toBytes } from '../lib/serialize';
import { txIso } from '../lib/time';
import { parseAmount, parseJson, requireInteger, requireOneOf, requireText } from '../lib/validate';

export const PII_COLLECTION = 'farmerPII';

type EntityKind = 'warehouse' | 'lender' | 'inspector' | 'farmer';
const ENTITY_KINDS: readonly EntityKind[] = ['warehouse', 'lender', 'inspector', 'farmer'];

interface SeedData {
  warehouses?: { id: string; name: string; region: string; licenseNo: string; capacityKg: number; bondRef: string }[];
  lenders?: { id: string; name: string; type: string; licenseNo: string }[];
  inspectors?: { id: string; name: string; accreditationNo: string; conflictWarehouseIds?: string[] }[];
  referencePrices?: { commodity: string; grade: string; priceTzsPerKg: number }[];
  policy: unknown;
}

const DURATION_FIELDS: readonly (keyof PolicyDurations)[] = [
  'marginCallGraceSecs',
  'maturityGraceSecs',
  'challengeWindowSecs',
  'qualityCheckIntervalSecs',
  'attestationMaxAgeSecs',
  'receiptTermSecs',
];

function parseDurations(name: string, raw: unknown): PolicyDurations {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const out = {} as PolicyDurations;
  for (const field of DURATION_FIELDS) {
    out[field] = requireInteger(`${name}.${field}`, obj[field], { min: 1 });
  }
  return out;
}

/** Validates a full policy (spec §4.5). Thresholds must be ordered max < margin call < liquidation. */
function parsePolicy(raw: unknown): Omit<PolicyParams, 'docType' | 'createdAt' | 'updatedAt' | 'version'> {
  const p = (raw ?? {}) as Record<string, unknown>;
  const policy = {
    maxLtvBp: requireInteger('maxLtvBp', p.maxLtvBp, { min: 1, max: 10_000 }),
    marginCallLtvBp: requireInteger('marginCallLtvBp', p.marginCallLtvBp, { min: 1, max: 10_000 }),
    liquidationLtvBp: requireInteger('liquidationLtvBp', p.liquidationLtvBp, { min: 1, max: 10_000 }),
    weightToleranceBp: requireInteger('weightToleranceBp', p.weightToleranceBp, { min: 0, max: 10_000 }),
    moistureToleranceBp: requireInteger('moistureToleranceBp', p.moistureToleranceBp, { min: 0, max: 10_000 }),
    gradeMustMatch: p.gradeMustMatch === true,
    durations: parseDurations('durations', p.durations),
    demoDurations: parseDurations('demoDurations', p.demoDurations),
    demoMode: p.demoMode === true,
  };
  if (!(policy.maxLtvBp < policy.marginCallLtvBp && policy.marginCallLtvBp < policy.liquidationLtvBp)) {
    throw new WrtError('INVALID_ARGUMENT', 'LTV thresholds must satisfy maxLtvBp < marginCallLtvBp < liquidationLtvBp');
  }
  return policy;
}

@Info({ title: 'RegistryContract', description: 'Onboarding, reference prices and policy (spec §6)' })
export class RegistryContract extends WrtContract {
  constructor() {
    super('RegistryContract');
  }

  /** Seeds warehouses, lenders, inspectors, prices and policy from seed data. Regulator only, once. */
  @Transaction()
  async InitLedger(ctx: WrtContext, seedJson: string): Promise<string> {
    const reg = requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    if (await readAsset(ctx, policyKey(ctx))) {
      throw new WrtError('ALREADY_EXISTS', 'ledger is already initialised');
    }
    const seed = parseJson<SeedData>('seed', seedJson);
    await createAsset<PolicyParams>(ctx, policyKey(ctx), { docType: 'policyParams', ...parsePolicy(seed.policy) }, 'policy parameters');
    for (const w of seed.warehouses ?? []) {
      await this.putWarehouse(ctx, w.id, w.name, w.region, w.licenseNo, String(w.capacityKg), w.bondRef);
    }
    for (const l of seed.lenders ?? []) {
      await this.putLender(ctx, l.id, l.name, l.type, l.licenseNo);
    }
    for (const i of seed.inspectors ?? []) {
      await this.putInspector(ctx, i.id, i.name, i.accreditationNo, i.conflictWarehouseIds ?? []);
    }
    for (const p of seed.referencePrices ?? []) {
      await this.putPrice(ctx, p.commodity, p.grade, String(p.priceTzsPerKg), reg.entityId);
    }
    return JSON.stringify({
      warehouses: seed.warehouses?.length ?? 0,
      lenders: seed.lenders?.length ?? 0,
      inspectors: seed.inspectors?.length ?? 0,
      referencePrices: seed.referencePrices?.length ?? 0,
    });
  }

  @Transaction()
  async RegisterWarehouse(
    ctx: WrtContext,
    id: string,
    name: string,
    region: string,
    licenseNo: string,
    capacityKg: string,
    bondRef: string,
  ): Promise<string> {
    requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    return JSON.stringify(await this.putWarehouse(ctx, id, name, region, licenseNo, capacityKg, bondRef));
  }

  @Transaction()
  async RegisterLender(ctx: WrtContext, id: string, name: string, type: string, licenseNo: string): Promise<string> {
    requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    return JSON.stringify(await this.putLender(ctx, id, name, type, licenseNo));
  }

  @Transaction()
  async AccreditInspector(ctx: WrtContext, id: string, name: string, accreditationNo: string, conflictWarehouseIdsJson: string): Promise<string> {
    requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    const conflicts = parseJson<unknown>('conflictWarehouseIds', conflictWarehouseIdsJson || '[]');
    if (!Array.isArray(conflicts) || !conflicts.every((c) => typeof c === 'string')) {
      throw new WrtError('INVALID_ARGUMENT', 'conflictWarehouseIds must be an array of warehouse IDs');
    }
    return JSON.stringify(await this.putInspector(ctx, id, name, accreditationNo, conflicts as string[]));
  }

  @Transaction()
  async SetWarehouseStatus(ctx: WrtContext, id: string, status: string): Promise<string> {
    return this.SetEntityStatus(ctx, 'warehouse', id, status);
  }

  /** Suspend, reinstate or revoke any registered entity (regulator; farmers also by their warehouse). */
  @Transaction()
  async SetEntityStatus(ctx: WrtContext, kind: string, id: string, status: string): Promise<string> {
    const entityKind = requireOneOf('kind', kind, ENTITY_KINDS);
    const to = requireOneOf<EntityStatus>('status', status, ENTITY_STATUSES);
    const key = assetKey(ctx, entityKind, id);
    const entity = await getAsset<Warehouse | Lender | Inspector | Farmer>(ctx, key, `${entityKind} ${id}`);
    if (entityKind === 'farmer') {
      // The warehouse that registered a farmer may suspend them too.
      const caller = ctx.clientIdentity.getAttributeValue('wrt.role');
      if (caller === 'warehouse_operator') {
        const op = requireRole(ctx, 'WarehouseMSP', ['warehouse_operator']);
        if ((entity as Farmer).registeredByWarehouseId !== op.entityId) {
          throw new WrtError('NOT_AUTHORISED', `farmer ${id} was registered by another warehouse`);
        }
      } else {
        requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
      }
    } else {
      requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    }
    assertTransition('entity', entity.status, to);
    entity.status = to;
    return JSON.stringify(await updateAsset(ctx, key, entity));
  }

  /**
   * Warehouse operator registers a farmer. PII arrives in transient data (key "pii"),
   * never as an argument, so it is not written into the block (spec §3.3). Public
   * state keeps only the sha256 of the canonical PII JSON.
   */
  @Transaction()
  async RegisterFarmer(ctx: WrtContext, farmerId: string): Promise<string> {
    const op = requireRole(ctx, 'WarehouseMSP', ['warehouse_operator']);
    requireActive(await getWarehouse(ctx, op.entityId), 'warehouse');
    requireText('farmerId', farmerId);
    const raw = ctx.stub.getTransient().get('pii');
    if (!raw || raw.length === 0) {
      throw new WrtError('INVALID_ARGUMENT', 'farmer PII must be passed as transient data under key "pii"');
    }
    const input = parseJson<Record<string, unknown>>('pii', Buffer.from(raw).toString('utf8'));
    const pii: FarmerPII = {
      farmerId,
      fullName: requireText('pii.fullName', input.fullName),
      phone: requireText('pii.phone', input.phone),
      nidaNo: requireText('pii.nidaNo', input.nidaNo),
      villageOrWard: requireText('pii.villageOrWard', input.villageOrWard),
    };
    const canonical = toBytes(pii);
    const piiHash = createHash('sha256').update(canonical).digest('hex');
    const farmer = await createAsset<Farmer>(
      ctx,
      keys.farmer(ctx, farmerId),
      { docType: 'farmer', id: farmerId, registeredByWarehouseId: op.entityId, piiHash, status: 'ACTIVE' },
      `farmer ${farmerId}`,
    );
    await ctx.stub.putPrivateData(PII_COLLECTION, keys.farmer(ctx, farmerId), canonical);
    return JSON.stringify(farmer);
  }

  @Transaction()
  async SetReferencePrice(ctx: WrtContext, commodity: string, grade: string, priceTzsPerKg: string): Promise<string> {
    const reg = requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    return JSON.stringify(await this.putPrice(ctx, commodity, grade, priceTzsPerKg, reg.entityId));
  }

  /** Replaces the policy parameters (Regulator only, spec §4.5). */
  @Transaction()
  async SetPolicyParams(ctx: WrtContext, policyJson: string): Promise<string> {
    requireRole(ctx, 'RegulatorMSP', ['regulator_officer']);
    const current = await getAsset<PolicyParams>(ctx, policyKey(ctx), 'policy parameters');
    const next = { ...current, ...parsePolicy(parseJson('policy', policyJson)) };
    return JSON.stringify(await updateAsset(ctx, policyKey(ctx), next));
  }

  // ------------------------------------------------------------------ helpers

  private async putWarehouse(ctx: WrtContext, id: string, name: string, region: string, licenseNo: string, capacityKg: string, bondRef: string) {
    return createAsset<Warehouse>(
      ctx,
      keys.warehouse(ctx, requireText('id', id)),
      {
        docType: 'warehouse',
        id,
        name: requireText('name', name),
        region: requireText('region', region),
        licenseNo: requireText('licenseNo', licenseNo),
        capacityKg: parseAmount('capacityKg', capacityKg),
        bondRef: requireText('bondRef', bondRef),
        status: 'ACTIVE',
        penaltyCount: 0,
      },
      `warehouse ${id}`,
    );
  }

  private async putLender(ctx: WrtContext, id: string, name: string, type: string, licenseNo: string) {
    return createAsset<Lender>(
      ctx,
      keys.lender(ctx, requireText('id', id)),
      {
        docType: 'lender',
        id,
        name: requireText('name', name),
        type: requireOneOf('type', type, LENDER_TYPES),
        licenseNo: requireText('licenseNo', licenseNo),
        status: 'ACTIVE',
      },
      `lender ${id}`,
    );
  }

  private async putInspector(ctx: WrtContext, id: string, name: string, accreditationNo: string, conflictWarehouseIds: string[]) {
    return createAsset<Inspector>(
      ctx,
      keys.inspector(ctx, requireText('id', id)),
      {
        docType: 'inspector',
        id,
        name: requireText('name', name),
        accreditationNo: requireText('accreditationNo', accreditationNo),
        status: 'ACTIVE',
        conflictWarehouseIds,
      },
      `inspector ${id}`,
    );
  }

  /** Creates or replaces the price for commodity~grade (prices change over time). */
  private async putPrice(ctx: WrtContext, commodity: string, grade: string, priceTzsPerKg: string, setBy: string) {
    const key = assetKey(ctx, 'referencePrice', requireText('commodity', commodity), requireText('grade', grade));
    const price = parseAmount('priceTzsPerKg', priceTzsPerKg);
    if (price === 0) {
      throw new WrtError('INVALID_ARGUMENT', 'priceTzsPerKg must be positive');
    }
    const existing = await readAsset<ReferencePrice>(ctx, key);
    if (existing) {
      return updateAsset<ReferencePrice>(ctx, key, { ...existing, priceTzsPerKg: price, setBy, effectiveAt: txIso(ctx) });
    }
    return createAsset<ReferencePrice>(
      ctx,
      key,
      { docType: 'referencePrice', commodity, grade, priceTzsPerKg: price, setBy, effectiveAt: txIso(ctx) },
      `reference price ${commodity} ${grade}`,
    );
  }
}
