/** Screen 14: lender portfolio. "TIER 2" banner only for hosted lenders (MFI / SACCO). */
import { Link } from 'react-router-dom';
import { LtvGauge } from '../../components/ledger';
import { Callout, Chip, EmptyRow, LinkButton, PageHeader, Section, StatTile, StatusChip, TableCard, Tiles } from '../../components/ui';
import { bpPct, commodity, date, duration, kg, secondsUntil, tzs, tzsShort } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useLoanViews, usePolicy } from '../../lib/queries';
import type { LoanView } from '../../lib/types';

function maturity(v: LoanView): string | null {
  return v.loan.maturityAt ? new Date(new Date(v.loan.maturityAt).getTime() + v.loan.pausedSecs * 1000).toISOString() : null;
}

export function LenderPortfolio() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const lender = me?.entity as { name?: string; type?: string; licenseNo?: string } | null;
  const views = useLoanViews({ lenderId: id }, !!id);
  const policy = usePolicy();
  const all = views.data ?? [];
  const open = all.filter((v) => ['ACTIVE', 'MARGIN_CALL', 'DEFAULTED'].includes(v.loan.status));
  const offered = all.filter((v) => v.loan.status === 'OFFERED' || v.loan.status === 'ACCEPTED');
  const outstanding = open.reduce((s, v) => s + v.outstandingTzs, 0);
  const collateral = open.reduce((s, v) => s + (v.collateralTzs ?? 0), 0);
  const kgPledged = open.reduce((s, v) => s + v.receipt.netKg, 0);
  const held = all.filter((v) => v.loan.status === 'ACTIVE' || v.loan.status === 'MARGIN_CALL').reduce((s, v) => s + (v.escrow?.balanceTzs ?? 0), 0);
  const portfolioLtv = collateral ? Math.floor((outstanding * 10_000) / collateral) : null;
  const pol = policy.data;
  const alerts = [
    ...all.filter((v) => v.loan.pause).map((v) => ({ to: `/disputes/${v.loan.pause!.disputeId}`, title: `${v.loan.pause!.disputeId} ruling pending`, text: `${v.loan.id} frozen since ${date(v.loan.pause!.pausedAt)}. A corrected ruling may trigger a margin call.`, when: v.loan.pause!.pausedAt })),
    ...all.filter((v) => v.loan.status === 'MARGIN_CALL').map((v) => ({ to: `/loans/${v.loan.id}`, title: `${v.loan.id} in margin call`, text: `Paydown ${tzs(v.loan.marginCall?.requiredPaydownTzs)} due ${date(v.loan.marginCall?.deadlineAt)}.`, when: v.loan.marginCall?.raisedAt ?? '' })),
    ...all.filter((v) => v.loan.status === 'DEFAULTED').map((v) => ({ to: `/loans/${v.loan.id}`, title: `${v.loan.id} defaulted`, text: 'Record the crop sale to run the escrow waterfall.', when: v.loan.updatedAt })),
    ...all.filter((v) => v.receipt.pendingQualityCheck && v.receipt.lien?.loanId === v.loan.id).map((v) => ({ to: `/receipts/${v.receipt.id}`, title: `Quality check pending · ${v.receipt.id.slice(-6)}`, text: `Assigned to ${v.receipt.pendingQualityCheck!.assignedInspectorId}.`, when: v.receipt.pendingQualityCheck!.requestedAt })),
  ];
  return (
    <>
      <PageHeader
        eyebrow={`${lender?.name ?? id} · ${lender?.type ?? ''} licence ${lender?.licenseNo ?? ''}`}
        title="Portfolio"
        actions={<LinkButton to="/lender/collateral" variant="accent">Find collateral</LinkButton>}
      />
      {me?.hostingTier === 2 && (
        <Callout tone="ink" tag="TIER 2">
          You transact through LenderMSP's peer with a hosted certificate. No node to run, same tamper-evident ledger.
        </Callout>
      )}
      <Tiles>
        <StatTile label="Outstanding" value={tzs(outstanding)} sub={`TZS · ${open.length} open loans`} variant="inverse" />
        <StatTile label="Collateral pledged" value={tzs(collateral)} sub={`TZS · ${kgPledged.toLocaleString('en-US')} kg`} />
        <StatTile label="Portfolio LTV" value={bpPct(portfolioLtv)} sub="weighted by collateral" />
        <StatTile label="Repayments in escrow" value={tzs(held)} sub="released on full repayment" />
        <StatTile label="Offers pending" value={offered.length} sub={offered[0] ? `${offered[0].loan.id} · ${tzsShort(offered[0].loan.principalTzs)}` : 'none'} to="/lender/loans" />
      </Tiles>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Section title="LTV by open loan">
          {pol && (
            <div className="flex flex-col gap-4">
              {open.length === 0 && <p className="m-0 text-[13px] text-muted">No open loans.</p>}
              {open.map((v) => (
                <div key={v.loan.id} className="grid items-center gap-3" style={{ gridTemplateColumns: '80px 1fr 64px' }}>
                  <Link to={`/loans/${v.loan.id}`} className="font-mono text-[13px]">
                    {v.loan.id}
                  </Link>
                  <LtvGauge ltvBp={v.ltvBp} policy={pol} compact />
                  <span className="text-right font-mono text-[13px]">{bpPct(v.ltvBp)}</span>
                </div>
              ))}
              <div className="font-mono text-[11px] text-muted">
                {bpPct(pol.maxLtvBp, 0, '')} max · {bpPct(pol.marginCallLtvBp, 0, '')} margin · {bpPct(pol.liquidationLtvBp, 0, '')} default
              </div>
            </div>
          )}
        </Section>
        <Section title="Alerts" pad={false}>
          {alerts.length === 0 && <p className="m-0 p-4 text-[13px] text-muted">No alerts.</p>}
          {alerts.map((a, i) => (
            <Link key={i} to={a.to} className="flex justify-between gap-3 border-b border-line-soft px-4 py-3 text-[13px] text-ink no-underline last:border-b-0 hover:bg-surface-2">
              <span>
                <b>{a.title}</b>
                <br />
                <span className="text-muted">{a.text}</span>
              </span>
              <span className="font-mono text-[12px] text-muted">{date(a.when)}</span>
            </Link>
          ))}
        </Section>
      </div>
      <TableCard title="Maturity schedule" aside={<Link to="/lender/loans">All loans →</Link>}>
        <thead>
          <tr>
            <th>Loan</th>
            <th>Farmer</th>
            <th>Collateral</th>
            <th className="r">Outstanding</th>
            <th>Maturity</th>
            <th className="r">Left</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {open.length === 0 && <EmptyRow cols={7}>No open loans.</EmptyRow>}
          {open
            .slice()
            .sort((a, b) => (maturity(a) ?? '').localeCompare(maturity(b) ?? ''))
            .map((v) => {
              const left = secondsUntil(maturity(v));
              return (
                <tr key={v.loan.id}>
                  <td className="font-mono">
                    <Link to={`/loans/${v.loan.id}`}>{v.loan.id}</Link>
                  </td>
                  <td className="font-mono">{v.loan.farmerId}</td>
                  <td>
                    {commodity(v.receipt.commodity)} {v.receipt.grade} · {kg(v.receipt.netKg)}
                  </td>
                  <td className="r font-mono">{tzs(v.outstandingTzs)}</td>
                  <td className="font-mono">
                    {date(maturity(v))}
                    {v.loan.pausedSecs > 0 && ` +${duration(v.loan.pausedSecs)}`}
                  </td>
                  <td className="r font-mono">{left === null ? '—' : left >= 0 ? duration(left) : `−${duration(-left)}`}</td>
                  <td>{v.loan.pause ? <Chip tone="yellow">Paused · dispute</Chip> : <StatusChip domain="loan" status={v.loan.status} />}</td>
                </tr>
              );
            })}
        </tbody>
      </TableCard>
    </>
  );
}
