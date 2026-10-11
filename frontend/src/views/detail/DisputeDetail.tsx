/** Screen 04: dispute detail. The ruling form shows only for regulator_officer at REINSPECTED; others see it read-only. */
import type { CropReading, DisputeOutcome, Liability } from '@wrt/shared';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Dialog } from '../../components/Dialog';
import { LedgerHistory } from '../../components/ledger';
import { Async, Breadcrumb, Button, Callout, Chip, KV, LinkButton, Mono, PageHeader, Section, Signs, StatTile, StatusChip, TagChip, Tiles } from '../../components/ui';
import { api } from '../../lib/api';
import { bpPct, commodity, date, dateTime, duration, kg, parseWhole, shortHash, signedBp, tzs } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useDispute, useDisputeHistory, useInspectors, useLoan, usePolicy, usePrices } from '../../lib/queries';
import { useTx } from '../../lib/tx';
import type { DisputeView } from '../../lib/types';
import { AssignReinspectionModal, Field } from '../../modals/Modals';

const OUTCOMES: { id: DisputeOutcome; title: string; text: string; deposit: boolean }[] = [
  { id: 'CONFIRMED', title: 'Confirmed', text: 'Original attestation stands.', deposit: true },
  { id: 'CORRECTED', title: 'Corrected', text: 'Amend to re-inspected values. No fraud found.', deposit: true },
  { id: 'FRAUDULENT', title: 'Fraudulent', text: 'Cancel receipt (or reject deposit), suspend warehouse.', deposit: true },
  { id: 'NATURAL_DEGRADATION', title: 'Natural degradation', text: 'Amend values; loss is the farmer’s collateral risk.', deposit: false },
  { id: 'STORAGE_NEGLIGENCE', title: 'Storage negligence', text: 'Amend values; warehouse liable, compensation into escrow.', deposit: false },
];
const REQUIRED: Partial<Record<DisputeOutcome, Liability>> = { FRAUDULENT: 'WAREHOUSE', NATURAL_DEGRADATION: 'FARMER', STORAGE_NEGLIGENCE: 'WAREHOUSE' };

function Body({ v }: { v: DisputeView }) {
  const { me } = useIdentity();
  const role = me?.chaincodeView.role;
  const entity = me?.chaincodeView.entityId;
  const d = v.dispute;
  const isDeposit = d.subject.kind === 'DEPOSIT';
  const prices = usePrices();
  const policy = usePolicy();
  const inspectors = useInspectors();
  const history = useDisputeHistory(d.id);
  const loanView = useLoan(v.loan?.id);
  const tx = useTx();
  const [assignOpen, setAssignOpen] = useState(false);
  const [outcome, setOutcome] = useState<DisputeOutcome>('CONFIRMED');
  const [liability, setLiability] = useState<Liability>('NONE');
  const [findings, setFindings] = useState('');
  const [comp, setComp] = useState('0');
  const [confirm, setConfirm] = useState(false);

  // The reading under dispute: the minting attestation, or the latest quality check for degradation claims.
  const original: { reading: CropReading; by: string; at: string } | null = useMemo(() => {
    if (isDeposit && v.deposit?.attestation) return { reading: v.deposit.attestation.observed, by: v.deposit.attestation.inspectorId, at: v.deposit.attestation.attestedAt };
    if (v.receipt) {
      const lastQc = v.receipt.qualityHistory[v.receipt.qualityHistory.length - 1];
      if (d.type === 'QUALITY_DEGRADATION' && lastQc) return { reading: lastQc.observed, by: `${lastQc.inspectorId} QC`, at: lastQc.at };
      return { reading: { grade: v.receipt.grade, netKg: v.receipt.netKg, moistureBp: v.receipt.moistureBp }, by: v.deposit?.attestation?.inspectorId ?? 'attested', at: v.receipt.issuedAt };
    }
    return null;
  }, [d.type, isDeposit, v.deposit, v.receipt]);
  const re = d.reinspection?.observed;
  const commodityCode = v.receipt?.commodity ?? v.deposit?.commodity ?? '';
  const priceOf = (grade: string) => prices.data?.find((p) => p.commodity === commodityCode && p.grade === grade)?.priceTzsPerKg ?? null;
  const valueOf = (r: CropReading | undefined) => (r && priceOf(r.grade) !== null ? r.netKg * priceOf(r.grade)! : null);
  const owed = v.loan ? v.loan.totalDueTzs - v.loan.repaidTzs : null;
  const ltv = (value: number | null) => (owed !== null && value ? Math.floor((owed * 10_000) / value) : null);
  const frozenSecs = d.status !== 'RESOLVED' ? Math.round((Date.now() - new Date(d.raisedAt).getTime()) / 1000) : null;
  const excluded = isDeposit ? [v.deposit?.assignedInspectorId ?? ''] : [v.deposit?.attestation?.inspectorId ?? '', ...(v.receipt?.qualityHistory.slice(-1).map((q) => q.inspectorId) ?? [])];
  const canRule = role === 'regulator_officer' && d.status === 'REINSPECTED';
  const allowed = OUTCOMES.filter((o) => !isDeposit || o.deposit);
  const required = REQUIRED[outcome];
  const compensation = parseWhole(comp);

  function pick(o: DisputeOutcome) {
    setOutcome(o);
    if (REQUIRED[o]) setLiability(REQUIRED[o]!);
  }

  async function sign() {
    const r = await tx.run(() => api.post(`/disputes/${d.id}/resolve`, { outcome, liability, findings, compensationTzs: compensation ?? 0 }), () => `${d.id} resolved: ${outcome}.`);
    if (r) setConfirm(false);
  }

  const reinspector = d.reinspection?.inspectorId;
  const effects = (o: DisputeOutcome): [string, string, string] => {
    const newVals = re ? `${re.grade} · ${kg(re.netKg)} · ${bpPct(re.moistureBp)}` : 're-inspected values';
    if (isDeposit) {
      return {
        CONFIRMED: ['Minted with declared values', '—', 'No change'],
        CORRECTED: [`Minted with ${newVals}`, '—', 'No penalty'],
        FRAUDULENT: ['Deposit REJECTED, no receipt', '—', 'Suspended · penalty +1'],
        NATURAL_DEGRADATION: ['n/a', '', ''],
        STORAGE_NEGLIGENCE: ['n/a', '', ''],
      }[o] as [string, string, string];
    }
    const pausedFor = frozenSecs ? `Clock resumes, +${duration(frozenSecs)}` : 'Clock resumes';
    return {
      CONFIRMED: ['Unfrozen, values stand', v.loan ? pausedFor : '—', 'No change'],
      CORRECTED: [`Amended to ${newVals}`, v.loan ? 'LTV recomputed; margin call or default if over threshold' : '—', 'No penalty'],
      FRAUDULENT: ['Cancelled', v.loan ? 'Defaulted (or cancelled + refund if undisbursed) · bond claim' : '—', 'Suspended · penalty +1 · bond claim'],
      NATURAL_DEGRADATION: [`Amended to ${newVals}`, v.loan ? 'Normal margin rules apply (farmer bears loss)' : '—', 'No change'],
      STORAGE_NEGLIGENCE: [`Amended to ${newVals}`, v.loan ? 'Compensation credited to the loan; LTV recomputed' : '—', 'Liable · compensation against bond'],
    }[o] as [string, string, string];
  };

  return (
    <>
      <Breadcrumb items={[role === 'regulator_officer' ? { label: 'Arbitration', to: '/regulator/disputes' } : role === 'lender_officer' ? { label: 'Disputes raised', to: '/lender/disputes' } : { label: 'Home', to: '/' }, { label: d.id }]} />
      <PageHeader
        chips={
          <>
            <StatusChip domain="dispute" status={d.status} label={d.status === 'REINSPECTED' ? 'Reinspected · awaiting ruling' : d.resolution ? `Resolved · ${d.resolution.outcome}` : undefined} />
            <TagChip>{d.type}</TagChip>
          </>
        }
        title={d.id}
        mono
        sub={
          <>
            Raised by {d.raisedBy.entityId} ({d.raisedBy.role}) against{' '}
            {isDeposit ? <Mono>{d.subject.id}</Mono> : <Link className="font-mono" to={`/receipts/${d.subject.id}`}>{d.subject.id}</Link>} · {commodity(commodityCode)}, {v.receipt?.warehouseId ?? v.deposit?.warehouseId}
          </>
        }
        actions={
          <>
            {role === 'regulator_officer' && d.status === 'OPEN' && <Button variant="accent" onClick={() => setAssignOpen(true)}>Assign re-inspection</Button>}
            {role === 'inspector' && d.status === 'REINSPECTION_ASSIGNED' && reinspector === entity && <LinkButton to={`/inspector/inspect/${d.id}`} variant="accent">Re-inspect</LinkButton>}
            {v.loan && role !== 'inspector' && <LinkButton to={`/loans/${v.loan.id}`} variant="secondary">Open loan {v.loan.id}</LinkButton>}
          </>
        }
      />
      <Tiles>
        <StatTile label={isDeposit ? 'Deposit' : 'Receipt'} value={isDeposit ? (v.deposit?.status === 'MISMATCH_DISPUTED' ? 'No receipt' : v.deposit?.status ?? '—') : frozenSecs !== null ? 'Frozen' : v.receipt?.status ?? '—'} sub={frozenSecs !== null ? `for ${duration(frozenSecs)}` : d.resolution ? `ruled ${date(d.resolution.resolvedAt)}` : undefined} variant={frozenSecs !== null ? 'attention' : undefined} />
        <StatTile label={v.loan ? `Loan ${v.loan.id}` : 'Loan'} value={v.loan ? (v.loan.pause ? 'Clock paused' : v.loan.status) : 'None'} sub={v.loan ? `pausedSecs ${v.loan.pausedSecs}` : 'no lien'} />
        <StatTile label="Prior status" value={<span className="text-[20px]">{v.receipt?.statusBeforeDispute ?? (isDeposit ? 'PENDING_ATTESTATION' : '—')}</span>} sub="restored on ruling" />
        <StatTile label="Re-inspector" value={reinspector ?? '—'} sub={d.reinspection ? `assigned ${date(d.reinspection.assignedAt)}` : 'not drawn yet'} />
      </Tiles>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Claim">
            <blockquote className="m-0 border-l-[3px] border-yellow pl-3 text-[14px] leading-relaxed">{d.claim}</blockquote>
            <p className="m-0 mt-3 text-[12px] text-muted">
              Raised <Mono>{dateTime(d.raisedAt)}</Mono> · Evidence{' '}
              {d.evidence.length === 0
                ? 'none'
                : d.evidence.map((h, i) => (
                    <span key={h}>
                      {i > 0 && ', '}
                      <a className="font-mono" href={`/api/uploads/${h}`} target="_blank" rel="noreferrer">
                        sha256 {shortHash(h, 4, 4)}
                      </a>
                    </span>
                  ))}
            </p>
          </Section>
          <Section title={isDeposit ? 'Declared vs inspections' : 'Original vs re-inspection'} aside={`re-inspector drawn excluding ${excluded.filter(Boolean).join(', ') || '—'} and conflicted inspectors`} pad={false}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Field</th>
                    {isDeposit && <th className="r !whitespace-normal">Declared · {v.deposit?.warehouseId}</th>}
                    <th className="r !whitespace-normal">Original{original ? ` · ${original.by} · ${date(original.at)}` : ''}</th>
                    <th className="r !whitespace-normal">Re-inspection{d.reinspection?.submittedAt ? ` · ${reinspector} · ${date(d.reinspection.submittedAt)}` : ''}</th>
                    <th className="r">Change</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Grade</td>
                    {isDeposit && <td className="r font-mono">{v.deposit?.declared.grade}</td>}
                    <td className="r font-mono">{original?.reading.grade ?? '—'}</td>
                    <td className="r font-mono">{re?.grade ?? 'pending'}</td>
                    <td className="r">{re && original ? re.grade === original.reading.grade ? <span className="font-mono">same</span> : <Chip tone="yellow">{re.grade > original.reading.grade ? 'downgrade' : 'upgrade'}</Chip> : '—'}</td>
                  </tr>
                  <tr>
                    <td>Net weight</td>
                    {isDeposit && <td className="r font-mono">{kg(v.deposit?.declared.netKg)}</td>}
                    <td className="r font-mono">{kg(original?.reading.netKg)}</td>
                    <td className="r font-mono">{re ? kg(re.netKg) : 'pending'}</td>
                    <td className="r font-mono">{re && original ? signedBp(Math.trunc(((re.netKg - original.reading.netKg) * 10_000) / original.reading.netKg)) : '—'}</td>
                  </tr>
                  <tr>
                    <td>Moisture</td>
                    {isDeposit && <td className="r font-mono">{bpPct(v.deposit?.declared.moistureBp)}</td>}
                    <td className="r font-mono">{bpPct(original?.reading.moistureBp)}</td>
                    <td className="r font-mono">{re ? bpPct(re.moistureBp) : 'pending'}</td>
                    <td className="r font-mono">{re && original ? signedBp(re.moistureBp - original.reading.moistureBp, 1, ' pp') : '—'}</td>
                  </tr>
                  <tr>
                    <td>Collateral value</td>
                    {isDeposit && <td className="r font-mono">{tzs(valueOf(v.deposit?.declared))}</td>}
                    <td className="r font-mono">{tzs(valueOf(original?.reading))}</td>
                    <td className="r font-mono">{re ? tzs(valueOf(re)) : '—'}</td>
                    <td className="r font-mono">{re && valueOf(re) !== null && valueOf(original?.reading) !== null ? tzs(valueOf(re)! - valueOf(original!.reading)!) : '—'}</td>
                  </tr>
                  {v.loan && policy.data && (
                    <tr>
                      <td>LTV on {v.loan.id}</td>
                      <td className="r font-mono">{bpPct(ltv(valueOf(original?.reading)))}</td>
                      <td className="r font-mono">{re ? bpPct(ltv(valueOf(re))) : '—'}</td>
                      <td className="r">
                        {re && (ltv(valueOf(re)) ?? 0) >= policy.data.marginCallLtvBp ? <Chip tone="yellow">above {bpPct(policy.data.marginCallLtvBp, 0, '')} margin</Chip> : '—'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="What each ruling does on-chain" pad={false}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>{isDeposit ? 'Deposit' : 'Receipt'}</th>
                    {!isDeposit && <th>Loan {v.loan?.id ?? ''}</th>}
                    <th>Warehouse {v.receipt?.warehouseId ?? v.deposit?.warehouseId}</th>
                  </tr>
                </thead>
                <tbody>
                  {allowed.map((o) => {
                    const [a, b, c] = effects(o.id);
                    return (
                      <tr key={o.id}>
                        <td className="font-mono">{o.id}</td>
                        <td>{a}</td>
                        {!isDeposit && <td>{b}</td>}
                        <td>{c}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {d.resolution ? (
            <Section title="Ruling" aside={<StatusChip domain="dispute" status="RESOLVED" label={d.resolution.outcome} />}>
              <KV
                rows={[
                  ['Outcome', <Mono key="o">{d.resolution.outcome}</Mono>],
                  ['Liability', <Mono key="l">{d.resolution.liability}</Mono>],
                  ['Compensation', <Mono key="c">{tzs(d.resolution.compensationTzs)} TZS</Mono>],
                  ['Ruled by', `${d.resolution.resolvedBy} · ${dateTime(d.resolution.resolvedAt)}`],
                ]}
              />
              <p className="mb-0 mt-3 text-[13px] leading-relaxed">{d.resolution.findings}</p>
            </Section>
          ) : canRule ? (
            <section className="card flex flex-col gap-4 p-4">
              <h2 className="section-title">Ruling</h2>
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="eyebrow mb-2">Outcome</legend>
                {allowed.map((o) => (
                  <label key={o.id} className={`flex cursor-pointer gap-3 rounded-card border p-3 text-[13px] ${outcome === o.id ? 'border-ink bg-surface-2' : 'border-line'}`}>
                    <input type="radio" name="outcome" checked={outcome === o.id} onChange={() => pick(o.id)} />
                    <span>
                      <b>{o.title}</b>
                      <span className="block text-muted">{o.text}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <Field label="Liability" hint={required ? `${outcome} requires ${required}` : undefined}>
                <select className="input" value={liability} onChange={(e) => setLiability(e.target.value as Liability)} disabled={!!required}>
                  {(['NONE', 'WAREHOUSE', 'FARMER', 'INSPECTOR'] as const).map((l) => (
                    <option key={l} value={l}>
                      {l.charAt(0) + l.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Findings">
                <textarea className="input" value={findings} onChange={(e) => setFindings(e.target.value)} />
              </Field>
              <Field label="Compensation (TZS)" hint={outcome === 'STORAGE_NEGLIGENCE' ? 'Credited to the loan through escrow' : outcome === 'FRAUDULENT' ? 'Bond claim paid to the lender' : undefined}>
                <input className="input font-mono" value={comp} onChange={(e) => setComp(e.target.value)} />
              </Field>
              <Button onClick={() => setConfirm(true)} disabledReason={!findings ? 'Write the findings first' : compensation === null ? 'Compensation must be a whole TZS amount' : false}>
                Resolve dispute
              </Button>
              <Signs fn="ResolveDispute" as="REG-01. Needs endorsement from 3 of 4 orgs" />
            </section>
          ) : (
            <Callout tone="info" title={d.status === 'OPEN' ? 'Waiting for re-inspection.' : d.status === 'REINSPECTION_ASSIGNED' ? `With ${reinspector}.` : 'Awaiting ruling.'}>
              {d.status === 'OPEN'
                ? 'The regulator triggers a deterministic draw of a different inspector.'
                : d.status === 'REINSPECTION_ASSIGNED'
                  ? 'The re-inspector submits readings without seeing the original.'
                  : 'Only the regulator can rule. This page is read-only for you.'}
            </Callout>
          )}
          <Section title="Timeline">
            <Async q={history} what="reading dispute history">
              {(rows) => <LedgerHistory rows={rows} />}
            </Async>
          </Section>
        </div>
      </div>

      {assignOpen && (
        <AssignReinspectionModal open onClose={() => setAssignOpen(false)} dispute={d} excluded={excluded} warehouseId={v.receipt?.warehouseId ?? v.deposit?.warehouseId ?? ''} />
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirm ruling"
        subtitle={`${d.id} · ${outcome}`}
        error={tx.error}
        hint={<Signs fn="DisputeContract:ResolveDispute" />}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Back
            </Button>
            <Button onClick={() => void sign()} disabled={tx.pending}>
              {tx.pending ? 'Signing…' : 'Sign ruling'}
            </Button>
          </>
        }
      >
        <div className="eyebrow">This will write</div>
        <KV
          rows={[
            [isDeposit ? 'Deposit' : 'Receipt', effects(outcome)[0]],
            ...(!isDeposit && v.loan ? ([[`Loan ${v.loan.id}`, effects(outcome)[1]]] as [string, string][]) : []),
            ['Warehouse', effects(outcome)[2]],
            ['Liability', liability],
            ['Compensation', `${tzs(compensation ?? 0)} TZS`],
          ]}
        />
        <p className="hint m-0">All parties will see the findings text on the ledger.</p>
        {loanView.data && <p className="hint m-0">Current LTV on {loanView.data.loan.id}: {bpPct(loanView.data.ltvBp)}</p>}
      </Dialog>
      {inspectors.data === undefined && null}
    </>
  );
}

export function DisputeDetail() {
  const { id } = useParams();
  const q = useDispute(id);
  return <Async q={q} what={`reading dispute~${id}`}>{(v) => <Body v={v} />}</Async>;
}
