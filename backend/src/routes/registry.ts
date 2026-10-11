import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Farmer, FarmerPII, Inspector, Lender, PolicyParams, ReferencePrice, Warehouse } from '@wrt/shared';
import { evaluate, submit } from '../fabric/ledger.js';
import { body, filterFrom, s, who } from './common.js';

const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/seed-data.json');

export async function registryRoutes(app: FastifyInstance): Promise<void> {
  // ---- reads (evaluate on the caller's own peer)
  app.get('/warehouses', async (req) => evaluate<Warehouse[]>(who(req), 'QueryContract:List', ['warehouse', filterFrom(req.query as object, ['status', 'region'])]));
  app.get('/lenders', async (req) => evaluate<Lender[]>(who(req), 'QueryContract:List', ['lender', filterFrom(req.query as object, ['status', 'type'])]));
  app.get('/inspectors', async (req) => evaluate<Inspector[]>(who(req), 'QueryContract:List', ['inspector', filterFrom(req.query as object, ['status'])]));
  app.get('/farmers', async (req) =>
    evaluate<Farmer[]>(who(req), 'QueryContract:List', ['farmer', filterFrom(req.query as object, ['status', 'registeredByWarehouseId'])]),
  );
  app.get<{ Params: { kind: string; id: string } }>('/registry/:kind/:id', async (req) => evaluate(who(req), 'QueryContract:Get', [req.params.kind, req.params.id]));
  app.get<{ Params: { id: string } }>('/farmers/:id/pii', async (req) => evaluate<FarmerPII>(who(req), 'QueryContract:GetFarmerPII', [req.params.id]));
  app.get('/prices', async (req) => evaluate<ReferencePrice[]>(who(req), 'QueryContract:List', ['referencePrice', filterFrom(req.query as object, ['commodity', 'grade'])]));
  app.get('/policy', async (req) => evaluate<PolicyParams>(who(req), 'QueryContract:GetPolicyParams'));

  // ---- writes (submit: 3-of-4 endorsement, ordered, committed)
  app.post('/init', async (req) => {
    const seed = (req.body as object | undefined) && Object.keys(req.body as object).length ? req.body : JSON.parse(readFileSync(SEED_FILE, 'utf8'));
    return submit(who(req), 'RegistryContract:InitLedger', [JSON.stringify(seed)]);
  });

  app.post(
    '/warehouses',
    { schema: body(['id', 'name', 'region', 'licenseNo', 'capacityKg', 'bondRef'], { id: s.str, name: s.str, region: s.str, licenseNo: s.str, capacityKg: s.int, bondRef: s.str }) },
    async (req) => {
      const b = req.body as Warehouse;
      return submit(who(req), 'RegistryContract:RegisterWarehouse', [b.id, b.name, b.region, b.licenseNo, String(b.capacityKg), b.bondRef]);
    },
  );

  app.post(
    '/lenders',
    { schema: body(['id', 'name', 'type', 'licenseNo'], { id: s.str, name: s.str, type: { enum: ['BANK', 'MFI', 'SACCO'] }, licenseNo: s.str }) },
    async (req) => {
      const b = req.body as Lender;
      return submit(who(req), 'RegistryContract:RegisterLender', [b.id, b.name, b.type, b.licenseNo]);
    },
  );

  app.post(
    '/inspectors',
    {
      schema: body(['id', 'name', 'accreditationNo'], {
        id: s.str,
        name: s.str,
        accreditationNo: s.str,
        conflictWarehouseIds: { type: 'array', items: { type: 'string' }, default: [] },
      }),
    },
    async (req) => {
      const b = req.body as Inspector;
      return submit(who(req), 'RegistryContract:AccreditInspector', [b.id, b.name, b.accreditationNo, JSON.stringify(b.conflictWarehouseIds)]);
    },
  );

  app.post<{ Params: { kind: string; id: string }; Body: { status: string } }>(
    '/registry/:kind/:id/status',
    { schema: body(['status'], { status: { enum: ['ACTIVE', 'SUSPENDED', 'REVOKED'] } }) },
    async (req) => submit(who(req), 'RegistryContract:SetEntityStatus', [req.params.kind, req.params.id, req.body.status]),
  );

  /** PII goes as transient data and is endorsed only by farmerPII members (Inspector excluded). */
  app.post<{ Body: { farmerId: string; pii: Omit<FarmerPII, 'farmerId'> } }>(
    '/farmers',
    {
      schema: body(['farmerId', 'pii'], {
        farmerId: s.str,
        pii: {
          type: 'object',
          required: ['fullName', 'phone', 'nidaNo', 'villageOrWard'],
          additionalProperties: false,
          properties: { fullName: s.str, phone: s.str, nidaNo: s.str, villageOrWard: s.str },
        },
      }),
    },
    async (req) =>
      submit(who(req), 'RegistryContract:RegisterFarmer', [req.body.farmerId], {
        transient: { pii: JSON.stringify(req.body.pii) },
        endorsingOrgs: ['WarehouseMSP', 'LenderMSP', 'RegulatorMSP'],
      }),
  );

  app.put<{ Body: { commodity: string; grade: string; priceTzsPerKg: number } }>(
    '/prices',
    { schema: body(['commodity', 'grade', 'priceTzsPerKg'], { commodity: s.str, grade: s.str, priceTzsPerKg: s.posInt }) },
    async (req) => submit(who(req), 'RegistryContract:SetReferencePrice', [req.body.commodity, req.body.grade, String(req.body.priceTzsPerKg)]),
  );

  app.put('/policy', async (req) => submit(who(req), 'RegistryContract:SetPolicyParams', [JSON.stringify(req.body)]));
}
