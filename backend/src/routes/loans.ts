import type { FastifyInstance } from 'fastify';
import type { Loan, PolicyParams } from '@wrt/shared';
import { evaluate, submit } from '../fabric/ledger.js';
import { body, filterFrom, s, who } from './common.js';
import { historyOf, loanView } from './derived.js';

type Id = { Params: { id: string } };
type Money = { Body: { amountTzs: number; paymentRef: string } };

export async function loanRoutes(app: FastifyInstance): Promise<void> {
  /** Loans list; ?view=1 adds receipt, escrow and LTV to each (portfolio screens). */
  app.get('/loans', async (req) => {
    const id = who(req);
    const loans = await evaluate<Loan[]>(id, 'QueryContract:List', ['loan', filterFrom(req.query as object, ['status', 'lenderId', 'farmerId', 'receiptId'])]);
    if ((req.query as { view?: string }).view !== '1') return loans;
    const policy = await evaluate<PolicyParams>(id, 'QueryContract:GetPolicyParams');
    return Promise.all(loans.map((l) => loanView(id, l, policy)));
  });

  /** Loan detail page (handoff screen 03). */
  app.get<Id>('/loans/:id', async (req) => {
    const id = who(req);
    return loanView(id, await evaluate<Loan>(id, 'QueryContract:GetLoan', [req.params.id]));
  });
  app.get<Id>('/loans/:id/history', async (req) => historyOf(who(req), 'loan', req.params.id));

  app.post<{ Body: { receiptId: string; principalTzs: number; interestBp: number; termSecs: number } }>(
    '/loans',
    { schema: body(['receiptId', 'principalTzs', 'interestBp', 'termSecs'], { receiptId: s.str, principalTzs: s.posInt, interestBp: s.bp, termSecs: s.posInt }) },
    async (req) => {
      const b = req.body;
      return submit(who(req), 'LoanContract:OfferLoan', [b.receiptId, String(b.principalTzs), String(b.interestBp), String(b.termSecs)]);
    },
  );

  app.post<Id>('/loans/:id/accept', async (req) => submit(who(req), 'LoanContract:AcceptLoan', [req.params.id]));
  app.post<Id>('/loans/:id/cancel', async (req) => submit(who(req), 'LoanContract:CancelOffer', [req.params.id]));
  const money = body(['amountTzs', 'paymentRef'], { amountTzs: s.posInt, paymentRef: s.str });
  app.post<Id & Money>('/loans/:id/fund', { schema: money }, async (req) =>
    submit(who(req), 'LoanContract:FundEscrow', [req.params.id, String(req.body.amountTzs), req.body.paymentRef]),
  );
  app.post<Id & Money>('/loans/:id/repay', { schema: money }, async (req) =>
    submit(who(req), 'LoanContract:Repay', [req.params.id, String(req.body.amountTzs), req.body.paymentRef]),
  );
  app.post<Id>('/loans/:id/evaluate', async (req) => submit(who(req), 'LoanContract:EvaluateLoan', [req.params.id]));
  app.post<Id>('/loans/:id/evaluate-disbursement', async (req) => submit(who(req), 'LoanContract:EvaluateDisbursement', [req.params.id]));
  app.post<Id & { Body: { saleProceedsTzs: number; buyerRef: string } }>(
    '/loans/:id/liquidate',
    { schema: body(['saleProceedsTzs', 'buyerRef'], { saleProceedsTzs: s.int, buyerRef: s.str }) },
    async (req) => submit(who(req), 'LoanContract:ExecuteLiquidation', [req.params.id, String(req.body.saleProceedsTzs), req.body.buyerRef]),
  );
}
