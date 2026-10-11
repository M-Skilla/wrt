/** Screen 13: farmer loans. Offer card with Accept / Decline; repayment progress bar. */
import type { Loan } from '@wrt/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyRow, EmptyState, PageHeader, StatusChip, TableCard } from '../../components/ui';
import { bpPct, commodity, date, duration, kg, secondsUntil, tzs } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useLenders, useLoanViews } from '../../lib/queries';
import type { LoanView } from '../../lib/types';
import { AcceptOfferModal, RepayModal } from '../../modals/Modals';

function Offer({ v }: { v: LoanView }) {
  const [open, setOpen] = useState(false);
  const l = v.loan;
  const lenders = useLenders();
  const lender = lenders.data?.find((x) => x.id === l.lenderId)?.name ?? l.lenderId;
  return (
    <section className="card flex flex-col gap-4 border-ink p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="eyebrow">New offer · {l.id}</span>
          <b className="mt-1 block text-[18px]">
            {lender} wants to lend you {tzs(l.principalTzs)} TZS
          </b>
        </div>
        <span className="font-mono text-[12px] text-muted">offered {date(l.offeredAt)}</span>
      </div>
      <div className="grid gap-3 rounded-card bg-surface-2 p-3 text-[13px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <div><span className="eyebrow block">You receive</span><span className="font-mono text-[16px] font-semibold">{tzs(l.principalTzs)}</span></div>
        <div><span className="eyebrow block">You repay</span><span className="font-mono text-[16px] font-semibold">{tzs(l.totalDueTzs)}</span></div>
        <div><span className="eyebrow block">Interest</span><span className="font-mono">{bpPct(l.interestBp, 2)} flat</span></div>
        <div><span className="eyebrow block">Term</span><span className="font-mono">{duration(l.termSecs)}</span></div>
        <div>
          <span className="eyebrow block">Collateral</span>
          {commodity(v.receipt.commodity)} {v.receipt.grade} · {kg(v.receipt.netKg)}
          <span className="block font-mono text-muted">{v.receipt.id}</span>
        </div>
      </div>
      <div className="grid gap-3 text-[13px] leading-relaxed md:grid-cols-3">
        <p className="m-0"><b>When you accept</b><br />Your receipt is locked as collateral. The lender's money goes into escrow and is released to you automatically when all checks pass.</p>
        <p className="m-0"><b>When you repay in full</b><br />The lock lifts by itself. You can collect your crop or use the receipt again.</p>
        <p className="m-0"><b>If quality drops</b><br />The lender may ask you to repay part early. You can dispute an inspection you think is wrong.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="accent" size="form" onClick={() => setOpen(true)}>
          Accept offer
        </Button>
        <Button variant="secondary" size="form" onClick={() => setOpen(true)}>
          Decline
        </Button>
      </div>
      {open && <AcceptOfferModal open onClose={() => setOpen(false)} loan={l} receipt={v.receipt} lenderName={lender} />}
    </section>
  );
}

function Active({ v }: { v: LoanView }) {
  const [open, setOpen] = useState(false);
  const l = v.loan;
  const lenders = useLenders();
  const paidPct = l.totalDueTzs ? Math.min(100, (l.repaidTzs / l.totalDueTzs) * 100) : 0;
  const maturity = l.maturityAt ? new Date(new Date(l.maturityAt).getTime() + l.pausedSecs * 1000).toISOString() : null;
  const left = secondsUntil(maturity);
  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip domain="loan" status={l.status} />
          <Link to={`/loans/${l.id}`} className="font-mono">
            {l.id}
          </Link>
          <span className="text-[13px] text-muted">
            {lenders.data?.find((x) => x.id === l.lenderId)?.name ?? l.lenderId} · {commodity(v.receipt.commodity)} {v.receipt.grade} {kg(v.receipt.netKg)}
            {maturity && ` · due ${date(maturity)}`}
          </span>
        </span>
        {(l.status === 'ACTIVE' || l.status === 'MARGIN_CALL') && <Button onClick={() => setOpen(true)}>Repay</Button>}
      </div>
      {l.status === 'ACCEPTED' && <p className="m-0 text-[13px] text-muted">Your receipt is locked. Waiting for the lender to put the money into escrow; it is paid to you automatically once every check passes.</p>}
      {l.status === 'MARGIN_CALL' && l.marginCall && (
        <p className="m-0 rounded-card bg-tint-yellow p-3 text-[13px]">
          <b>The value of your crop fell.</b> Repay <span className="font-mono">{tzs(l.marginCall.requiredPaydownTzs)}</span> TZS before {date(l.marginCall.deadlineAt)} to keep your loan in good standing.
        </p>
      )}
      <div className="h-2.5 overflow-hidden rounded-full bg-line-soft" role="img" aria-label={`${Math.round(paidPct)}% repaid`}>
        <div className="h-full bg-cyan" style={{ width: `${paidPct}%` }} />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-[13px]">
        <span>
          <span className="font-mono">{tzs(l.repaidTzs)}</span> <span className="text-muted">of {tzs(l.totalDueTzs)} repaid</span>
        </span>
        <span className="text-muted">
          Left to pay <b className="font-mono text-ink">{tzs(l.totalDueTzs - l.repaidTzs)}</b>
          {left !== null && ` · ${left >= 0 ? `${duration(left)} to go` : `${duration(-left)} overdue`}`} · Receipt unlocks at 100%
        </span>
      </div>
      {open && <RepayModal open onClose={() => setOpen(false)} loan={l} />}
    </section>
  );
}

export function FarmerLoans() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const views = useLoanViews({ farmerId: id }, !!id);
  const all = views.data ?? [];
  const offers = all.filter((v) => v.loan.status === 'OFFERED');
  const current = all.filter((v) => ['ACCEPTED', 'ACTIVE', 'MARGIN_CALL', 'DEFAULTED'].includes(v.loan.status));
  const past = all.filter((v) => ['REPAID', 'LIQUIDATED', 'CANCELLED'].includes(v.loan.status));
  return (
    <>
      <PageHeader eyebrow="Farmer" title="Loans" />
      {all.length === 0 && !views.isLoading && <EmptyState title="No loans yet">Lenders can make you an offer once your receipt is registered with the regulator.</EmptyState>}
      {offers.map((v) => (
        <Offer key={v.loan.id} v={v} />
      ))}
      {current.map((v) => (
        <Active key={v.loan.id} v={v} />
      ))}
      <TableCard title="Past loans">
        <thead>
          <tr>
            <th>Loan</th>
            <th>Lender</th>
            <th>Collateral</th>
            <th className="r">Borrowed</th>
            <th className="r">Repaid</th>
            <th>Closed</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {past.length === 0 && <EmptyRow cols={7}>No closed loans.</EmptyRow>}
          {past.map(({ loan, receipt }: { loan: Loan; receipt: LoanView['receipt'] }) => (
            <tr key={loan.id}>
              <td className="font-mono">
                <Link to={`/loans/${loan.id}`}>{loan.id}</Link>
              </td>
              <td className="font-mono">{loan.lenderId}</td>
              <td>
                {commodity(receipt.commodity)} {receipt.grade} · {kg(receipt.netKg)}
              </td>
              <td className="r font-mono">{tzs(loan.principalTzs)}</td>
              <td className="r font-mono">{tzs(loan.repaidTzs)}</td>
              <td className="font-mono">{date(loan.updatedAt)}</td>
              <td>
                <StatusChip domain="loan" status={loan.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </>
  );
}
