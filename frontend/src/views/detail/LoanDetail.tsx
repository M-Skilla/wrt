/** Screen 03: loan detail. Liquidate is disabled unless DEFAULTED; the maturity tile counts down; pausedSecs shows as "+N d". */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConditionChecklist, EscrowLedger, LtvGauge } from '../../components/ledger';
import { Async, Breadcrumb, Button, Callout, Chip, Mono, PageHeader, Section, StatTile, StatusChip, TagChip, Tiles } from '../../components/ui';
import { api } from '../../lib/api';
import { bpPct, commodity, date, dateTime, duration, feedTime, kg, secondsUntil, tzs } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useFarmerPII, useLoan, useLoanHistory, usePolicy } from '../../lib/queries';
import { useTx } from '../../lib/tx';
import type { LoanView } from '../../lib/types';
import { AcceptOfferModal, FundEscrowModal, LiquidateModal, RaiseDisputeModal, RepayModal, RequestQualityCheckModal } from '../../modals/Modals';

function health(v: LoanView): [ 'green' | 'yellow' | 'red' | 'neutral', string] {
  const l = v.ltvBp;
  if (l === null) return ['neutral', 'No price'];
  if (l >= v.policy.liquidationLtvBp) return ['red', 'Default threshold'];
  if (l >= v.policy.marginCallLtvBp) return ['yellow', 'Margin call'];
  if (l > v.policy.maxLtvBp) return ['yellow', 'Above max LTV'];
  return ['green', 'Healthy'];
}

function Body({ v }: { v: LoanView }) {
  const { me } = useIdentity();
  const role = me?.chaincodeView.role;
  const entity = me?.chaincodeView.entityId;
  const { loan, receipt } = v;
  const pii = useFarmerPII(loan.farmerId, role !== 'inspector');
  const history = useLoanHistory(loan.id);
  const policy = usePolicy();
  const tx = useTx();
  const [modal, setModal] = useState<'fund' | 'repay' | 'accept' | 'liquidate' | 'qc' | 'dispute' | null>(null);

  const isLender = role === 'lender_officer' && loan.lenderId === entity;
  const isFarmer = role === 'farmer' && loan.farmerId === entity;
  const open = loan.status === 'ACTIVE' || loan.status === 'MARGIN_CALL';
  const graceSecs = (v.policy.demoMode ? v.policy.demoDurations : v.policy.durations).maturityGraceSecs;
  const maturityIso = loan.maturityAt ? new Date(new Date(loan.maturityAt).getTime() + loan.pausedSecs * 1000).toISOString() : null;
  const untilMaturity = secondsUntil(maturityIso);
  const paidPct = loan.totalDueTzs ? Math.floor((loan.repaidTzs * 10_000) / loan.totalDueTzs) : 0;
  const [tone, label] = health(v);
  const farmerName = pii.data?.fullName ?? loan.farmerId;

  const actions = (
    <>
      {isLender && open && (
        <Button variant="secondary" onClick={() => setModal('qc')} disabledReason={!!receipt.pendingQualityCheck && 'A quality check is already pending'}>
          Request quality check
        </Button>
      )}
      {(isLender || isFarmer) && (receipt.status === 'PLEDGED' || receipt.status === 'ISSUED') && (
        <Button variant="secondary" onClick={() => setModal('dispute')}>
          Raise dispute
        </Button>
      )}
      {isLender && loan.status === 'ACCEPTED' && (
        <Button variant="accent" onClick={() => setModal('fund')}>
          Fund escrow
        </Button>
      )}
      {isLender && (loan.status === 'OFFERED' || loan.status === 'ACCEPTED') && (
        <Button variant="secondary" onClick={() => void tx.run(() => api.post(`/loans/${loan.id}/cancel`), () => `${loan.id} cancelled.`)}>
          {loan.status === 'OFFERED' ? 'Withdraw offer' : 'Cancel and refund'}
        </Button>
      )}
      {isFarmer && loan.status === 'OFFERED' && (
        <Button variant="accent" onClick={() => setModal('accept')}>
          Review offer
        </Button>
      )}
      {isFarmer && open && (
        <Button variant="accent" onClick={() => setModal('repay')}>
          Repay
        </Button>
      )}
      {(open || loan.status === 'ACCEPTED') && !isFarmer && (
        <Button
          variant="secondary"
          onClick={() =>
            void tx.run(
              () => api.post<{ changed?: boolean; released?: boolean }>(`/loans/${loan.id}/${loan.status === 'ACCEPTED' ? 'evaluate-disbursement' : 'evaluate'}`),
              (r) => (r.changed || r.released ? 'State changed.' : 'No change.'),
            )
          }
          title="Permissionless keeper check: anyone can run it, the rules are in chaincode"
        >
          Run keeper check
        </Button>
      )}
      {isLender && (
        <Button variant="danger" onClick={() => setModal('liquidate')} disabledReason={loan.status !== 'DEFAULTED' && 'Available only when the loan is DEFAULTED'}>
          Execute liquidation
        </Button>
      )}
    </>
  );

  return (
    <>
      <Breadcrumb
        items={[
          role === 'farmer' ? { label: 'Loans', to: '/farmer/loans' } : role === 'lender_officer' ? { label: 'My loans', to: '/lender/loans' } : { label: 'Arbitration', to: '/regulator/disputes' },
          { label: loan.id },
        ]}
      />
      <PageHeader
        chips={
          <>
            <StatusChip domain="loan" status={loan.status} />
            {loan.pause && <Chip tone="yellow">Paused · {loan.pause.disputeId}</Chip>}
            <TagChip>
              flat {bpPct(loan.interestBp, 2)} · {duration(loan.termSecs)}
            </TagChip>
          </>
        }
        title={loan.id}
        mono
        sub={
          <>
            {farmerName} · secured by{' '}
            <Link className="font-mono" to={`/receipts/${receipt.id}`}>
              {receipt.id}
            </Link>{' '}
            ({commodity(receipt.commodity)} {receipt.grade}, {kg(receipt.netKg)}) · lender <Mono>{loan.lenderId}</Mono>
          </>
        }
        actions={actions}
      />
      {loan.status === 'MARGIN_CALL' && loan.marginCall && (
        <Callout tone="warning" title="Margin call.">
          Pay down <Mono>{tzs(loan.marginCall.requiredPaydownTzs)} TZS</Mono> by <Mono>{dateTime(loan.marginCall.deadlineAt)}</Mono> ({duration(Math.max(0, secondsUntil(loan.marginCall.deadlineAt) ?? 0))} left) to bring LTV
          under {bpPct(v.policy.marginCallLtvBp, 0)}. {loan.marginCall.reason}.
        </Callout>
      )}
      {loan.pause && (
        <Callout tone="warning" title="Clock paused.">
          <Link className="font-mono" to={`/disputes/${loan.pause.disputeId}`}>
            {loan.pause.disputeId}
          </Link>{' '}
          froze the receipt on {dateTime(loan.pause.pausedAt)}. Frozen time is added to maturity when the regulator rules.
        </Callout>
      )}
      {loan.status === 'DEFAULTED' && (
        <Callout tone="error" title="Defaulted.">
          The lender can now sell the crop and record the proceeds. The escrow pays the lender first; any surplus goes to the farmer.
        </Callout>
      )}
      <Tiles>
        <StatTile label="Principal" value={tzs(loan.principalTzs)} sub={loan.disbursedAt ? `TZS disbursed ${date(loan.disbursedAt)}` : 'TZS · not disbursed yet'} />
        <StatTile label="Total due" value={tzs(loan.totalDueTzs)} sub={`principal + ${tzs(loan.totalDueTzs - loan.principalTzs)} interest`} />
        <StatTile label="Repaid" value={tzs(loan.repaidTzs)} sub={`${bpPct(paidPct)} · held in escrow`} />
        <StatTile
          label="Maturity"
          variant={untilMaturity !== null && untilMaturity < 0 ? 'attention' : undefined}
          value={untilMaturity === null ? '—' : untilMaturity >= 0 ? duration(untilMaturity) : `${duration(-untilMaturity)} over`}
          sub={
            maturityIso
              ? `${date(maturityIso)}${loan.pausedSecs ? ` · +${duration(loan.pausedSecs)} paused` : ''} · +${duration(graceSecs)} grace`
              : `${duration(loan.termSecs)} from disbursement`
          }
        />
      </Tiles>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Loan-to-value" aside={<Mono>outstanding {tzs(loan.status === 'OFFERED' || loan.status === 'ACCEPTED' ? loan.principalTzs : v.outstandingTzs)} ÷ collateral {tzs(v.collateralTzs)}</Mono>}>
          <div className="mb-3 flex items-center gap-3">
            <span className="font-mono text-[28px] font-semibold">{bpPct(v.ltvBp)}</span>
            <Chip tone={tone}>{label}</Chip>
          </div>
          <LtvGauge ltvBp={v.ltvBp} policy={v.policy} />
        </Section>
        <Section
          title="Disbursement conditions"
          aside={
            loan.disbursementConditions.length ? (
              <Chip tone={loan.disbursementConditions.every((c) => c.passed) ? 'green' : 'red'}>
                {loan.disbursementConditions.filter((c) => c.passed).length} of {loan.disbursementConditions.length} passed
              </Chip>
            ) : undefined
          }
        >
          <p className="m-0 mb-2 text-[13px] text-muted">
            {loan.disbursedAt ? (
              <>
                Evaluated by chaincode at <Mono>FundEscrow</Mono>, {dateTime(loan.disbursedAt)}. All passed, so funds were released to the farmer in the same transaction.
              </>
            ) : (
              'Last evaluation by chaincode. Funds stay in escrow until every condition holds; anyone may re-run EvaluateDisbursement.'
            )}
          </p>
          <ConditionChecklist conditions={loan.disbursementConditions} />
        </Section>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Section title="Timeline">
          <Async q={history} what="reading loan history">
            {(rows) => (
              <ol className="m-0 flex list-none flex-col p-0">
                {[...rows].reverse().map((h) => (
                  <li key={h.txId} className="flex gap-3 border-b border-line-soft py-2 text-[13px] last:border-b-0">
                    <span className="w-[96px] flex-none font-mono text-[12px] text-muted">{feedTime(h.timestamp)}</span>
                    <span>
                      <Mono>{(h.fn ?? '').split(':').pop()}</Mono> · {(h.value as { status?: string } | null)?.status}
                      {h.creator && <span className="text-muted"> · {h.creator.entityId ?? h.creator.mspId}</span>}
                    </span>
                  </li>
                ))}
                {maturityIso && open && (
                  <li className="flex gap-3 py-2 text-[13px] text-muted">
                    <span className="w-[96px] flex-none font-mono text-[12px]">{date(maturityIso)}</span>
                    <span>Maturity · then {duration(graceSecs)} grace before default</span>
                  </li>
                )}
              </ol>
            )}
          </Async>
        </Section>
        <Section title="Escrow ledger" pad={false}>
          <EscrowLedger escrow={v.escrow} releaseAt={loan.totalDueTzs} />
        </Section>
      </div>

      {modal === 'fund' && <FundEscrowModal open onClose={() => setModal(null)} loan={loan} receipt={receipt} policy={v.policy} />}
      {modal === 'repay' && <RepayModal open onClose={() => setModal(null)} loan={loan} />}
      {modal === 'accept' && <AcceptOfferModal open onClose={() => setModal(null)} loan={loan} receipt={receipt} lenderName={loan.lenderId} />}
      {modal === 'liquidate' && <LiquidateModal open onClose={() => setModal(null)} loan={loan} escrow={v.escrow} />}
      {modal === 'qc' && policy.data && <RequestQualityCheckModal open onClose={() => setModal(null)} receipt={receipt} policy={policy.data} />}
      {modal === 'dispute' && policy.data && <RaiseDisputeModal open onClose={() => setModal(null)} receipt={receipt} policy={policy.data} />}
    </>
  );
}

export function LoanDetail() {
  const { id } = useParams();
  const q = useLoan(id);
  return <Async q={q} what={`reading loan~${id}`}>{(v) => <Body v={v} />}</Async>;
}
