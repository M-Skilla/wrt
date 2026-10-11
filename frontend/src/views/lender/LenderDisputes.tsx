/** Screen 17: disputes raised by this lender. */
import { Link } from 'react-router-dom';
import { EmptyRow, PageHeader, StatusChip, TableCard } from '../../components/ui';
import { date, shortReceipt } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useDisputes, useLoans } from '../../lib/queries';

const STEPS = [
  ['01 · you', 'Raise with evidence', 'Receipt freezes, loan clock pauses.'],
  ['02 · regulator', 'Assign re-inspection', 'Chaincode draws a different inspector.'],
  ['03 · inspector', 'Re-inspect', 'New readings sit beside the original.'],
  ['04 · regulator', 'Rule', 'Confirmed, corrected or fraudulent. Effects apply on-chain.'],
];

export function LenderDisputes() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const disputes = useDisputes();
  const loans = useLoans({ lenderId: id }, !!id);
  const mine = (disputes.data ?? []).filter((d) => d.raisedBy.entityId === id).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
  const loanFor = (receiptId: string) => loans.data?.find((l) => l.receiptId === receiptId && l.status !== 'CANCELLED')?.id;
  return (
    <>
      <PageHeader eyebrow="Lender" title="Disputes raised" sub="Raise a dispute from a receipt or loan page. Disputes against the receipts you hold liens on appear here." />
      <section className="card grid overflow-hidden" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }} aria-label="How a dispute runs">
        {STEPS.map(([k, t, d]) => (
          <div key={k} className="flex flex-col gap-1 border-b border-r border-line p-4 text-[13px]">
            <span className="font-mono text-[11px] text-muted">{k}</span>
            <b>{t}</b>
            <span className="text-muted">{d}</span>
          </div>
        ))}
      </section>
      <TableCard>
        <thead>
          <tr>
            <th>Dispute</th>
            <th>Type</th>
            <th>Receipt</th>
            <th>Loan</th>
            <th>Raised</th>
            <th>Re-inspector</th>
            <th>Status</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {mine.length === 0 && <EmptyRow cols={8}>{disputes.isLoading ? 'Loading…' : 'You have not raised any disputes.'}</EmptyRow>}
          {mine.map((d) => (
            <tr key={d.id}>
              <td className="font-mono">
                <Link to={`/disputes/${d.id}`}>{d.id}</Link>
              </td>
              <td className="font-mono">{d.type}</td>
              <td className="font-mono">{shortReceipt(d.subject.id)}</td>
              <td className="font-mono">{loanFor(d.subject.id) ?? '—'}</td>
              <td className="font-mono">{date(d.raisedAt)}</td>
              <td className="font-mono">{d.reinspection?.inspectorId ?? '—'}</td>
              <td>
                <StatusChip domain="dispute" status={d.status} />
              </td>
              <td className={d.resolution ? 'font-mono' : 'text-muted'}>{d.resolution ? `${d.resolution.outcome} · liability ${d.resolution.liability}` : d.status === 'REINSPECTED' ? 'awaiting ruling' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </>
  );
}
