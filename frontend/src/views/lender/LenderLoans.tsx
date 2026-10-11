/** Screen 16: my loans, grouped: Needs action / Active / Offered / Closed. */
import { Link } from 'react-router-dom';
import { Chip, EmptyRow, PageHeader, StatusChip, TableCard } from '../../components/ui';
import { bpPct, date, duration, shortDate, shortReceipt, tzs } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useLoanViews } from '../../lib/queries';
import type { LoanView } from '../../lib/types';

function statusCell(v: LoanView) {
  const l = v.loan;
  if (l.pause) return <Chip tone="yellow">Paused · {l.pause.disputeId}</Chip>;
  if (l.status === 'OFFERED') return <Chip>Awaiting farmer</Chip>;
  if (l.status === 'ACCEPTED') return <Chip>Accepted · fund escrow</Chip>;
  if (l.status === 'LIQUIDATED') {
    const surplus = v.escrow?.entries.find((e) => e.type === 'SURPLUS_TO_FARMER')?.amountTzs;
    return <StatusChip domain="loan" status="LIQUIDATED" label={surplus ? `Liquidated · surplus ${tzs(surplus)}` : 'Liquidated'} />;
  }
  return <StatusChip domain="loan" status={l.status} />;
}

export function LenderLoans() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const views = useLoanViews({ lenderId: id }, !!id);
  const all = (views.data ?? []).slice().sort((a, b) => b.loan.id.localeCompare(a.loan.id));
  const needs = all.filter((v) => v.loan.pause || ['MARGIN_CALL', 'DEFAULTED', 'ACCEPTED'].includes(v.loan.status));
  const active = all.filter((v) => !needs.includes(v) && v.loan.status === 'ACTIVE');
  const offered = all.filter((v) => v.loan.status === 'OFFERED');
  const closed = all.filter((v) => ['REPAID', 'LIQUIDATED', 'CANCELLED'].includes(v.loan.status));
  const groups: [string, LoanView[]][] = [
    ['Needs action', needs],
    ['Active', active],
    ['Offered', offered],
    ['Closed', closed],
  ];
  return (
    <>
      <PageHeader eyebrow="Lender" title="My loans" />
      <TableCard>
        <thead>
          <tr>
            <th>Loan</th>
            <th>Farmer</th>
            <th>Receipt</th>
            <th className="r">Principal</th>
            <th className="r">Total due</th>
            <th className="r">Repaid</th>
            <th>LTV</th>
            <th>Maturity</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {all.length === 0 && <EmptyRow cols={9}>{views.isLoading ? 'Loading…' : 'No loans yet. Find eligible collateral to make an offer.'}</EmptyRow>}
          {groups.flatMap(([label, list]) =>
            list.length === 0
              ? []
              : [
                  <tr key={label} className="group">
                    <td colSpan={9}>
                      {label} · {list.length}
                    </td>
                  </tr>,
                  ...list.map((v) => {
                    const l = v.loan;
                    const closedLoan = ['REPAID', 'LIQUIDATED', 'CANCELLED'].includes(l.status);
                    return (
                      <tr key={l.id}>
                        <td className="font-mono">
                          <Link to={`/loans/${l.id}`}>{l.id}</Link>
                        </td>
                        <td className="font-mono">{l.farmerId}</td>
                        <td className="font-mono">
                          <Link to={`/receipts/${l.receiptId}`}>{shortReceipt(l.receiptId)}</Link>
                        </td>
                        <td className="r font-mono">{tzs(l.principalTzs)}</td>
                        <td className="r font-mono">{tzs(l.totalDueTzs)}</td>
                        <td className="r font-mono">{l.status === 'OFFERED' ? '—' : tzs(l.repaidTzs)}</td>
                        <td className="font-mono">{closedLoan ? '—' : bpPct(v.ltvBp)}</td>
                        <td className="font-mono">{l.maturityAt ? shortDate(l.maturityAt) : closedLoan ? date(l.updatedAt) : `${duration(l.termSecs)} from disb.`}</td>
                        <td>{statusCell(v)}</td>
                      </tr>
                    );
                  }),
                ],
          )}
        </tbody>
      </TableCard>
    </>
  );
}
