/** Screen 02: receipt detail, the centrepiece. Actions depend on role and status. */
import type { WarehouseReceipt } from '@wrt/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LedgerHistory, LifecycleStrip, LtvGauge } from '../../components/ledger';
import { Async, Breadcrumb, Button, Callout, KV, LinkButton, Mono, PageHeader, Section, StatTile, StatusChip, TagChip, Tiles } from '../../components/ui';
import { api } from '../../lib/api';
import { bpPct, commodity, date, dateTime, kg, shortHash, signedBp, tzs } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useFarmerPII, useReceipt, useReceiptHistory, useWarehouses } from '../../lib/queries';
import { useTx } from '../../lib/tx';
import type { ReceiptView } from '../../lib/types';
import { MakeOfferModal, RaiseDisputeModal, RecordWrrbModal, RequestQualityCheckModal } from '../../modals/Modals';

const BACK: Record<string, { label: string; to: string }> = {
  warehouse_operator: { label: 'Receipts in custody', to: '/warehouse/receipts' },
  farmer: { label: 'My receipts', to: '/farmer' },
  lender_officer: { label: 'My loans', to: '/lender/loans' },
  inspector: { label: 'Queue', to: '/inspector' },
  regulator_officer: { label: 'Explorer', to: '/regulator/explorer' },
};

function lifecycle(v: ReceiptView) {
  const r = v.receipt;
  const terminal = ['REDEEMED', 'LIQUIDATED', 'CANCELLED'].includes(r.status);
  const currentLabel =
    r.status === 'PLEDGED' ? `Pledged · lien ${r.lien?.loanId ?? ''}` : r.status === 'UNDER_DISPUTE' ? `Under dispute · ${r.activeDisputeId ?? ''}` : r.status === 'ISSUED' ? 'Issued · free' : r.status;
  const branches = ['UNDER_DISPUTE', 'DEFAULTED', 'LIQUIDATED', 'CANCELLED'];
  const entered = branches.filter((b) => b === r.status || v.disputes.some(() => b === 'UNDER_DISPUTE'));
  return {
    steps: [
      { label: '1 · Deposit', title: 'Attested', meta: date(v.deposit?.attestation?.attestedAt ?? r.issuedAt) },
      { label: '2 · Mint', title: 'Issued', meta: date(r.issuedAt) },
      {
        label: '3 · Legal',
        title: r.legal.status === 'WRRB_REGISTERED' ? 'WRRB registered' : 'Pending WRRB',
        meta: r.legal.registeredAt ? date(r.legal.registeredAt) : 'awaiting regulator',
        future: r.legal.status !== 'WRRB_REGISTERED',
      },
      { label: '4 · Current', title: terminal ? '—' : currentLabel, meta: r.lien ? `since ${date(r.lien.placedAt)}` : `v${r.version}`, current: !terminal, future: terminal },
      {
        label: '5 · Exit',
        title: terminal ? r.status.charAt(0) + r.status.slice(1).toLowerCase() : r.lien ? 'Lien released → redeemed' : 'Withdrawal → redeemed',
        meta: terminal ? date(r.updatedAt) : r.lien ? 'on full repayment' : r.withdrawalRequestedAt ? 'withdrawal requested' : 'when the farmer collects',
        current: terminal,
        future: !terminal,
      },
    ],
    branches: { title: 'Under dispute · Defaulted · Liquidated', meta: entered.length ? `entered: ${entered.join(', ').toLowerCase()}` : 'not entered' },
  };
}

function AttestationTable({ v }: { v: ReceiptView }) {
  const d = v.deposit;
  const a = d?.attestation;
  if (!d || !a) return <p className="m-0 text-[13px] text-muted">No attestation recorded.</p>;
  const p = v.policy;
  const weightGap = d.declared.netKg ? Math.trunc(((a.observed.netKg - d.declared.netKg) * 10_000) / d.declared.netKg) : 0;
  const moistGap = a.observed.moistureBp - d.declared.moistureBp;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Field</th>
              <th className="r">Declared · {d.warehouseId}</th>
              <th className="r">Observed · {a.inspectorId}</th>
              <th className="r">Gap</th>
              <th className="r">Limit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Grade</td>
              <td className="r font-mono">{d.declared.grade}</td>
              <td className="r font-mono">{a.observed.grade}</td>
              <td className="r font-mono">{d.declared.grade === a.observed.grade ? 'match' : 'differs'}</td>
              <td className="r font-mono">{p.gradeMustMatch ? 'exact' : 'any'}</td>
            </tr>
            <tr>
              <td>Net weight</td>
              <td className="r font-mono">{kg(d.declared.netKg)}</td>
              <td className="r font-mono">{kg(a.observed.netKg)}</td>
              <td className="r font-mono">{signedBp(weightGap)}</td>
              <td className="r font-mono">±{bpPct(p.weightToleranceBp, 2)}</td>
            </tr>
            <tr>
              <td>Moisture</td>
              <td className="r font-mono">{bpPct(d.declared.moistureBp)}</td>
              <td className="r font-mono">{bpPct(a.observed.moistureBp)}</td>
              <td className="r font-mono">{signedBp(moistGap, 1, ' pp')}</td>
              <td className="r font-mono">±{bpPct(p.moistureToleranceBp, 1, ' pp')}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="m-0 mt-3 text-[12px] text-muted">
        Sample seal <Mono>{d.sampleSealNo}</Mono> {a.sampleSealNoVerified ? 'verified' : 'NOT verified'} · inspector assigned by tx-hash draw · evidence{' '}
        {[...d.declaredEvidence, ...a.evidence].map((h, i) => (
          <span key={h}>
            {i > 0 && ', '}
            <a className="font-mono" href={`/api/uploads/${h}`} target="_blank" rel="noreferrer">
              sha256 {shortHash(h, 4, 4)}
            </a>
          </span>
        ))}
        {d.declaredEvidence.length + a.evidence.length === 0 && 'none'}
      </p>
    </>
  );
}

function Amendments({ r }: { r: WarehouseReceipt }) {
  const fmt = (field: string, v: string | number) => (field === 'moistureBp' ? bpPct(Number(v)) : field === 'netKg' ? kg(Number(v)) : String(v));
  const label: Record<string, string> = { grade: 'Grade', netKg: 'Net weight', moistureBp: 'Moisture' };
  return (
    <Section title="Amendments" pad={false}>
      <p className="m-0 px-4 pb-2 pt-3 text-[13px] text-muted">Every change to grade, weight or moisture after minting is logged here. Nothing is edited silently.</p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Field</th>
              <th className="r">From</th>
              <th className="r">To</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {r.amendments.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
                  No amendments.
                </td>
              </tr>
            )}
            {[...r.amendments].reverse().map((a, i) => (
              <tr key={i}>
                <td className="font-mono">{date(a.at)}</td>
                <td>{label[a.field]}</td>
                <td className="r font-mono">{fmt(a.field, a.from)}</td>
                <td className="r font-mono">{fmt(a.field, a.to)}</td>
                <td className="font-mono">{a.source === 'DISPUTE' ? <Link to={`/disputes/${a.disputeId}`}>{a.disputeId}</Link> : 'quality check'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Body({ v }: { v: ReceiptView }) {
  const { me } = useIdentity();
  const role = me?.chaincodeView.role;
  const entity = me?.chaincodeView.entityId;
  const r = v.receipt;
  const pii = useFarmerPII(r.holderFarmerId, role !== 'inspector');
  const warehouses = useWarehouses();
  const history = useReceiptHistory(r.id);
  const tx = useTx();
  const [modal, setModal] = useState<'qc' | 'dispute' | 'wrrb' | 'offer' | null>(null);
  const wh = warehouses.data?.find((w) => w.id === r.warehouseId);
  const holder = pii.data?.fullName ?? r.holderFarmerId;
  const live = r.status === 'ISSUED' || r.status === 'PLEDGED';
  const loan = v.activeLoan;

  const isLienLender = role === 'lender_officer' && r.lien?.lenderId === entity;
  const isHolder = role === 'farmer' && r.holderFarmerId === entity;
  const isOperator = role === 'warehouse_operator' && r.warehouseId === entity;
  const canOffer = role === 'lender_officer' && r.status === 'ISSUED' && r.legal.status === 'WRRB_REGISTERED' && !r.withdrawalRequestedAt;

  const actions = (
    <>
      {(isLienLender || role === 'regulator_officer') && live && (
        <Button variant="secondary" onClick={() => setModal('qc')} disabledReason={!!r.pendingQualityCheck && `Check already assigned to ${r.pendingQualityCheck.assignedInspectorId}`}>
          {role === 'regulator_officer' ? 'Spot audit' : 'Request quality check'}
        </Button>
      )}
      {(isLienLender || isHolder || isOperator || role === 'regulator_officer' || role === 'inspector') && (
        <Button variant="secondary" onClick={() => setModal('dispute')} disabledReason={!live && `Disputes need ISSUED or PLEDGED; this receipt is ${r.status}`}>
          Raise dispute
        </Button>
      )}
      {role === 'regulator_officer' && r.legal.status === 'PENDING_WRRB' && <Button onClick={() => setModal('wrrb')}>Record WRRB number</Button>}
      {isHolder && r.status === 'ISSUED' && !r.lien && (
        <Button
          disabledReason={!!r.withdrawalRequestedAt && 'Withdrawal already requested'}
          onClick={() => void tx.run(() => api.post(`/receipts/${r.id}/withdrawal`), () => 'Withdrawal requested. The warehouse confirms the physical release.')}
        >
          Request withdrawal
        </Button>
      )}
      {canOffer && v.collateralTzs !== null && (
        <Button variant="accent" onClick={() => setModal('offer')}>
          Make offer
        </Button>
      )}
      {loan && (role !== 'inspector') && <LinkButton to={`/loans/${loan.loan.id}`}>Open loan {loan.loan.id}</LinkButton>}
    </>
  );

  const lc = lifecycle(v);
  return (
    <>
      <Breadcrumb items={[BACK[role ?? ''] ?? { label: 'Home', to: '/' }, ...(loan ? [{ label: loan.loan.id, to: `/loans/${loan.loan.id}` }] : []), { label: 'receipt' }]} />
      <PageHeader
        chips={
          <>
            <StatusChip domain="receipt" status={r.status} />
            <StatusChip domain="legal" status={r.legal.status} />
          </>
        }
        title={r.id}
        mono
        sub={
          <>
            {commodity(r.commodity)} · Grade {r.grade} · held at {wh?.name ?? r.warehouseId} for {role === 'inspector' ? 'a registered farmer' : holder}
          </>
        }
        actions={actions}
      />
      {r.status === 'UNDER_DISPUTE' && (
        <Callout tone="warning" title="Receipt frozen.">
          <Link to={`/disputes/${r.activeDisputeId}`} className="font-mono">
            {r.activeDisputeId}
          </Link>{' '}
          is open. Actions on this receipt are paused until the regulator rules.
        </Callout>
      )}
      {r.pendingQualityCheck && (
        <Callout tone="info" title="Quality check pending.">
          Assigned to <Mono>{r.pendingQualityCheck.assignedInspectorId}</Mono> ({r.pendingQualityCheck.reason.toLowerCase().replace('_', ' ')}) since {dateTime(r.pendingQualityCheck.requestedAt)}.
        </Callout>
      )}
      <LifecycleStrip steps={lc.steps} branches={lc.branches} />
      <Tiles>
        <StatTile label="Net weight" value={<>{r.netKg.toLocaleString('en-US')}<span className="text-[14px] text-muted"> kg</span></>} sub="inspector-attested" />
        <StatTile label="Moisture" value={<>{bpPct(r.moistureBp, 1, '')}<span className="text-[14px] text-muted"> %</span></>} sub={r.qualityHistory.length ? `quality check ${date(r.lastQualityCheckAt)}` : 'at attestation'} />
        <StatTile label="Collateral value" value={tzs(v.collateralTzs)} sub={v.price ? `TZS · ${v.price.priceTzsPerKg}/kg illustrative reference` : 'no reference price'} />
        {loan ? (
          <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
            <span className="eyebrow">Loan-to-value</span>
            <span className="font-mono text-[26px] font-semibold leading-tight">{bpPct(loan.ltvBp)}</span>
            <LtvGauge ltvBp={loan.ltvBp} policy={v.policy} compact />
            <span className="font-mono text-[12px] text-muted">
              margin {bpPct(v.policy.marginCallLtvBp, 0, '')} · default {bpPct(v.policy.liquidationLtvBp, 0, '')}
            </span>
          </div>
        ) : (
          <StatTile label="Expires" value={date(r.expiresAt)} sub={`${Math.max(0, Math.round((new Date(r.expiresAt).getTime() - Date.now()) / 86_400_000))} days left`} />
        )}
      </Tiles>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Receipt record">
            <KV
              rows={[
                ['Holder', role === 'inspector' ? <Mono key="h">hidden from inspectors</Mono> : <span key="h">{holder} <Mono className="text-muted">{r.holderFarmerId}</Mono></span>],
                ['Warehouse', <span key="w">{wh?.name} <Mono className="text-muted">{r.warehouseId}</Mono></span>],
                ['Deposit', <Mono key="d">{r.depositId}</Mono>],
                ['Commodity', `${commodity(r.commodity)} · ${r.grade}`],
                ['Issued', <Mono key="i">{dateTime(r.issuedAt)}</Mono>],
                ['Expires', <Mono key="e">{date(r.expiresAt)}</Mono>],
                ['WRRB receipt no.', <Mono key="n">{r.legal.wrrbReceiptNo ?? 'pending'}</Mono>],
                ['Registered by', r.legal.registeredBy ? `${r.legal.registeredBy} · ${date(r.legal.registeredAt)}` : '—'],
                ...(r.release ? ([['Released', <Mono key="r">{r.release.gatePassNo} · {date(r.release.releasedAt)}</Mono>]] as [string, JSX.Element][]) : []),
              ]}
            />
          </Section>
          <Section title="Minting attestation" aside={<TagChip>{v.deposit?.attestation?.source ?? 'HUMAN_INSPECTOR'}</TagChip>}>
            <AttestationTable v={v} />
          </Section>
          <Amendments r={r} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Lien" aside={r.lien ? <StatusChip domain="receipt" status="PLEDGED" label="Active" /> : undefined}>
            {r.lien && loan ? (
              <KV
                rows={[
                  ['Loan', <Link key="l" className="font-mono" to={`/loans/${r.lien.loanId}`}>{r.lien.loanId}</Link>],
                  ['Lender', <Mono key="x">{r.lien.lenderId}</Mono>],
                  ['Placed', <Mono key="p">{dateTime(r.lien.placedAt)}</Mono>],
                  ['Outstanding', <Mono key="o">{tzs(loan.outstandingTzs)} TZS</Mono>],
                  ['Release rule', `Lifts automatically when repaid ≥ ${tzs(loan.loan.totalDueTzs)}`],
                ]}
              />
            ) : (
              <p className="m-0 text-[13px] text-muted">No lien. {r.status === 'ISSUED' && r.legal.status === 'WRRB_REGISTERED' ? 'Eligible as collateral.' : r.legal.status !== 'WRRB_REGISTERED' ? 'Cannot be pledged until WRRB-registered.' : ''}</p>
            )}
          </Section>
          <Section title="Ledger history" aside={<Link className="font-mono" to={`/regulator/explorer?q=receipt~${r.id}`}>receipt~{r.id}</Link>}>
            <Async q={history} what="reading key history">
              {(rows) => <LedgerHistory rows={rows} />}
            </Async>
          </Section>
          <Section title="Disputes">
            {v.disputes.length === 0 ? (
              <p className="m-0 text-[13px] text-muted">No disputes on this receipt. Raising one freezes the receipt and pauses the loan clock until the regulator rules.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {v.disputes.map((d) => (
                  <Link key={d.id} to={`/disputes/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line-soft p-3 text-ink no-underline hover:border-ink">
                    <span>
                      <b className="font-mono">{d.id}</b> · <span className="font-mono text-[12px]">{d.type}</span>
                      <span className="block text-[12px] text-muted">raised {date(d.raisedAt)} by {d.raisedBy.entityId}</span>
                    </span>
                    <StatusChip domain="dispute" status={d.status} label={d.resolution ? d.resolution.outcome : undefined} />
                  </Link>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {modal === 'qc' && <RequestQualityCheckModal open onClose={() => setModal(null)} receipt={r} policy={v.policy} />}
      {modal === 'dispute' && <RaiseDisputeModal open onClose={() => setModal(null)} receipt={r} policy={v.policy} />}
      {modal === 'wrrb' && <RecordWrrbModal open onClose={() => setModal(null)} receipt={r} attestedBy={v.deposit?.attestation?.inspectorId} />}
      {modal === 'offer' && v.collateralTzs !== null && <MakeOfferModal open onClose={() => setModal(null)} receipt={r} collateralTzs={v.collateralTzs} />}
    </>
  );
}

export function ReceiptDetail() {
  const { id } = useParams();
  const q = useReceipt(id);
  return <Async q={q} what={`reading receipt~${id}`}>{(v) => <Body v={v} />}</Async>;
}
