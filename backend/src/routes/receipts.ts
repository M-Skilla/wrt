import type { FastifyInstance } from 'fastify';
import type { Deposit, Loan, PolicyParams, WarehouseReceipt } from '@wrt/shared';
import { evaluate, submit } from '../fabric/ledger.js';
import { body, filterFrom, s, who } from './common.js';
import { disputesFor, historyOf, loanView, maybe, priceOf } from './derived.js';

type Id = { Params: { id: string } };

export async function receiptRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- deposits
  app.get('/deposits', async (req) =>
    evaluate<Deposit[]>(who(req), 'QueryContract:List', ['deposit', filterFrom(req.query as object, ['status', 'warehouseId', 'farmerId', 'assignedInspectorId'])]),
  );
  app.get<Id>('/deposits/:id', async (req) => {
    const id = who(req);
    const deposit = await evaluate<Deposit>(id, 'QueryContract:GetDeposit', [req.params.id]);
    return { deposit, disputes: await disputesFor(id, deposit.id) };
  });

  app.post<{ Body: { farmerId: string; commodity: string; declared: object; declaredEvidence: string[]; sampleSealNo: string } }>(
    '/deposits',
    { schema: body(['farmerId', 'commodity', 'declared', 'sampleSealNo'], { farmerId: s.str, commodity: s.str, declared: s.reading, declaredEvidence: s.hashes, sampleSealNo: s.str }) },
    async (req) => {
      const b = req.body;
      return submit(who(req), 'ReceiptContract:RecordDeposit', [b.farmerId, b.commodity, JSON.stringify(b.declared), JSON.stringify(b.declaredEvidence), b.sampleSealNo]);
    },
  );

  app.post<Id & { Body: { observed: object; evidence: string[]; sampleSealNoVerified: boolean } }>(
    '/deposits/:id/attestation',
    { schema: body(['observed', 'sampleSealNoVerified'], { observed: s.reading, evidence: s.hashes, sampleSealNoVerified: { type: 'boolean' } }) },
    async (req) =>
      submit(who(req), 'ReceiptContract:SubmitAttestation', [
        req.params.id,
        JSON.stringify(req.body.observed),
        JSON.stringify(req.body.evidence),
        String(req.body.sampleSealNoVerified),
      ]),
  );

  // ---------------------------------------------------------------- receipts
  app.get('/receipts', async (req) =>
    evaluate<WarehouseReceipt[]>(who(req), 'QueryContract:List', [
      'receipt',
      filterFrom(req.query as object, ['status', 'warehouseId', 'holderFarmerId', 'legal.status', 'lien.lenderId', 'pendingQualityCheck.assignedInspectorId']),
    ]),
  );

  /** Receipt detail page (handoff screen 02): receipt, deposit, valuation, loan, disputes. */
  app.get<Id>('/receipts/:id', async (req) => {
    const id = who(req);
    const receipt = await evaluate<WarehouseReceipt>(id, 'QueryContract:GetReceipt', [req.params.id]);
    const [deposit, price, policy, disputes, loans] = await Promise.all([
      maybe(evaluate<Deposit>(id, 'QueryContract:GetDeposit', [receipt.depositId])),
      priceOf(id, receipt.commodity, receipt.grade),
      evaluate<PolicyParams>(id, 'QueryContract:GetPolicyParams'),
      disputesFor(id, receipt.id),
      evaluate<Loan[]>(id, 'QueryContract:List', ['loan', JSON.stringify({ receiptId: receipt.id })]),
    ]);
    const active = receipt.lien ? loans.find((l) => l.id === receipt.lien!.loanId) : undefined;
    return {
      receipt,
      deposit,
      price,
      collateralTzs: price ? receipt.netKg * price.priceTzsPerKg : null,
      policy,
      disputes,
      loans,
      activeLoan: active ? await loanView(id, active, policy) : null,
    };
  });

  app.get<Id>('/receipts/:id/history', async (req) => historyOf(who(req), 'receipt', req.params.id));

  app.post<Id & { Body: { wrrbReceiptNo: string } }>('/receipts/:id/wrrb', { schema: body(['wrrbReceiptNo'], { wrrbReceiptNo: s.str }) }, async (req) =>
    submit(who(req), 'ReceiptContract:RecordWrrbRegistration', [req.params.id, req.body.wrrbReceiptNo]),
  );
  app.post<Id>('/receipts/:id/quality-check', async (req) => submit(who(req), 'ReceiptContract:RequestQualityCheck', [req.params.id]));
  app.post<Id & { Body: { observed: object; evidence: string[] } }>(
    '/receipts/:id/quality-check/result',
    { schema: body(['observed'], { observed: s.reading, evidence: s.hashes }) },
    async (req) => submit(who(req), 'ReceiptContract:SubmitQualityCheck', [req.params.id, JSON.stringify(req.body.observed), JSON.stringify(req.body.evidence)]),
  );
  app.post<Id>('/receipts/:id/withdrawal', async (req) => submit(who(req), 'ReceiptContract:RequestWithdrawal', [req.params.id]));
  app.post<Id & { Body: { gatePassNo: string } }>('/receipts/:id/release', { schema: body(['gatePassNo'], { gatePassNo: s.str }) }, async (req) =>
    submit(who(req), 'ReceiptContract:ConfirmRelease', [req.params.id, req.body.gatePassNo]),
  );
}
