import type { FastifyInstance } from 'fastify';
import type { Deposit, Dispute, Loan, WarehouseReceipt } from '@wrt/shared';
import { evaluate, submit } from '../fabric/ledger.js';
import { body, filterFrom, s, who } from './common.js';
import { historyOf, maybe } from './derived.js';

type Id = { Params: { id: string } };

export async function disputeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/disputes', async (req) =>
    evaluate<Dispute[]>(who(req), 'QueryContract:List', ['dispute', filterFrom(req.query as object, ['status', 'type', 'subject.id', 'reinspection.inspectorId'])]),
  );

  /** Dispute detail (handoff screen 04): the dispute plus its subject and any pledged loan. */
  app.get<Id>('/disputes/:id', async (req) => {
    const id = who(req);
    const dispute = await evaluate<Dispute>(id, 'QueryContract:GetDispute', [req.params.id]);
    if (dispute.subject.kind === 'DEPOSIT') {
      const deposit = await evaluate<Deposit>(id, 'QueryContract:GetDeposit', [dispute.subject.id]);
      const receipt = deposit.receiptId ? await maybe(evaluate<WarehouseReceipt>(id, 'QueryContract:GetReceipt', [deposit.receiptId])) : null;
      return { dispute, deposit, receipt, loan: null };
    }
    const receipt = await evaluate<WarehouseReceipt>(id, 'QueryContract:GetReceipt', [dispute.subject.id]);
    const deposit = await maybe(evaluate<Deposit>(id, 'QueryContract:GetDeposit', [receipt.depositId]));
    const loans = await evaluate<Loan[]>(id, 'QueryContract:List', ['loan', JSON.stringify({ receiptId: receipt.id })]);
    const loan = loans.find((l) => l.pause?.disputeId === dispute.id) ?? (receipt.lien ? loans.find((l) => l.id === receipt.lien!.loanId) : undefined);
    return { dispute, deposit, receipt, loan: loan ?? null };
  });
  app.get<Id>('/disputes/:id/history', async (req) => historyOf(who(req), 'dispute', req.params.id));

  app.post<{ Body: { receiptId: string; type: string; claim: string; evidence: string[] } }>(
    '/disputes',
    {
      schema: body(['receiptId', 'type', 'claim'], {
        receiptId: s.str,
        type: { enum: ['MINT_ACCURACY', 'QUALITY_DEGRADATION', 'OTHER'] },
        claim: s.str,
        evidence: s.hashes,
      }),
    },
    async (req) => submit(who(req), 'DisputeContract:RaiseDispute', [req.body.receiptId, req.body.type, req.body.claim, JSON.stringify(req.body.evidence)]),
  );

  app.post<Id>('/disputes/:id/assign', async (req) => submit(who(req), 'DisputeContract:AssignReinspection', [req.params.id]));
  app.post<Id & { Body: { observed: object; evidence: string[] } }>(
    '/disputes/:id/reinspection',
    { schema: body(['observed'], { observed: s.reading, evidence: s.hashes }) },
    async (req) => submit(who(req), 'DisputeContract:SubmitReinspection', [req.params.id, JSON.stringify(req.body.observed), JSON.stringify(req.body.evidence)]),
  );
  app.post<Id & { Body: { outcome: string; liability: string; findings: string; compensationTzs: number } }>(
    '/disputes/:id/resolve',
    {
      schema: body(['outcome', 'liability', 'findings'], {
        outcome: { enum: ['CONFIRMED', 'CORRECTED', 'FRAUDULENT', 'NATURAL_DEGRADATION', 'STORAGE_NEGLIGENCE'] },
        liability: { enum: ['NONE', 'WAREHOUSE', 'FARMER', 'INSPECTOR'] },
        findings: s.str,
        compensationTzs: { ...s.int, default: 0 },
      }),
    },
    async (req) =>
      submit(who(req), 'DisputeContract:ResolveDispute', [req.params.id, req.body.outcome, req.body.liability, req.body.findings, String(req.body.compensationTzs)]),
  );
}
