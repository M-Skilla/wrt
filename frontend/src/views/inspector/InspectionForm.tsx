/** Screen 19: inspection form with a live tolerance preview. The real check runs in chaincode. */
import type { CropReading, PolicyParams } from '@wrt/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Callout, Chip, EmptyState, Loading, Mono, PageHeader, Section, TagChip } from '../../components/ui';
import { api } from '../../lib/api';
import { useInspectorQueue } from '../../lib/derive';
import { bpPct, commodity, kg, parsePercentToBp, parseWhole, signedBp } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useDeposits, useDispute, useInspectors, usePolicy, usePrices, useReceipt } from '../../lib/queries';
import { useTx } from '../../lib/tx';
import { EvidenceInput } from '../../modals/Modals';

type Mode = 'ATTEST' | 'QUALITY' | 'REINSPECT';

interface Subject {
  mode: Mode;
  id: string;
  title: string;
  warehouseId: string;
  commodity: string;
  /** What the reading is compared with; hidden for re-inspections. */
  baseline: CropReading | null;
  baselineLabel: string;
  seal?: string;
  submit: (observed: CropReading, evidence: string[], sealOk: boolean) => Promise<unknown>;
}

function check(base: CropReading | null, obs: { grade: string; netKg: number | null; moistureBp: number | null }, policy: PolicyParams | undefined, sealOk: boolean, needSeal: boolean) {
  if (!base || !policy || obs.netKg === null || obs.moistureBp === null) return null;
  const weightGap = Math.trunc(((obs.netKg - base.netKg) * 10_000) / base.netKg);
  const weightOk = Math.abs(obs.netKg - base.netKg) * 10_000 <= policy.weightToleranceBp * base.netKg;
  const moistGap = obs.moistureBp - base.moistureBp;
  const moistOk = Math.abs(moistGap) <= policy.moistureToleranceBp;
  const gradeOk = !policy.gradeMustMatch || obs.grade === base.grade;
  return { weightGap, weightOk, moistGap, moistOk, gradeOk, ok: weightOk && moistOk && gradeOk && (!needSeal || sealOk) };
}

function Form({ s, policy }: { s: Subject; policy: PolicyParams | undefined }) {
  const prices = usePrices();
  const tx = useTx();
  const navigate = useNavigate();
  const grades = (prices.data ?? []).filter((p) => p.commodity === s.commodity).map((p) => p.grade).sort();
  const [grade, setGrade] = useState(s.baseline?.grade ?? grades[0] ?? 'G1');
  const [kgIn, setKg] = useState(s.baseline ? String(s.baseline.netKg) : '');
  const [mo, setMo] = useState(s.baseline ? bpPct(s.baseline.moistureBp, 2, '').replace(/\.?0+$/, '') : '');
  const [sealOk, setSealOk] = useState(false);
  const [evidence, setEvidence] = useState<string[]>([]);
  const netKg = parseWhole(kgIn);
  const moistureBp = parsePercentToBp(mo);
  const needSeal = s.mode === 'ATTEST';
  const c = check(s.baseline, { grade, netKg, moistureBp }, policy, sealOk, needSeal);
  const valid = netKg !== null && netKg > 0 && moistureBp !== null;

  async function submit() {
    const r = await tx.run(
      () => s.submit({ grade, netKg: netKg!, moistureBp: moistureBp! }, evidence, sealOk) as Promise<never>,
      (x: { outcome?: string; receipt?: { id: string }; dispute?: { id: string } }) =>
        x?.outcome === 'MINTED' ? `Receipt ${x.receipt?.id} minted.` : x?.outcome === 'MISMATCH_DISPUTED' ? `No receipt: ${x.dispute?.id} opened.` : 'Reading recorded.',
    );
    if (r) navigate('/inspector/history');
  }

  const chip = (ok: boolean | undefined, text: string) => (ok === undefined ? <Chip>{text}</Chip> : <Chip tone={ok ? 'green' : 'red'}>{text}</Chip>);
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <Section title={s.baseline ? `${s.baselineLabel} vs your reading` : 'Your reading'} aside={<TagChip>source HUMAN_INSPECTOR</TagChip>} pad={false}>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Field</th>
                  {s.baseline && <th className="r">{s.baselineLabel}</th>}
                  <th>Your reading</th>
                  {s.baseline && <th>Check</th>}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Grade</td>
                  {s.baseline && <td className="r font-mono">{s.baseline.grade}</td>}
                  <td>
                    <label className="sr-only" htmlFor="obs-grade">Observed grade</label>
                    <select id="obs-grade" className="input max-w-[140px]" value={grade} onChange={(e) => setGrade(e.target.value)}>
                      {(grades.length ? grades : ['G1', 'G2', 'G3']).map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </td>
                  {s.baseline && <td>{c ? chip(c.gradeOk, c.gradeOk ? 'match' : 'mismatch') : '—'}</td>}
                </tr>
                <tr>
                  <td>Net weight (kg)</td>
                  {s.baseline && <td className="r font-mono">{s.baseline.netKg.toLocaleString('en-US')}</td>}
                  <td>
                    <label className="sr-only" htmlFor="obs-kg">Observed net weight in kg</label>
                    <input id="obs-kg" className="input max-w-[160px] font-mono" inputMode="numeric" value={kgIn} onChange={(e) => setKg(e.target.value)} />
                  </td>
                  {s.baseline && (
                    <td className="whitespace-nowrap">
                      {c ? chip(c.weightOk, c.weightGap === 0 ? 'match' : signedBp(c.weightGap)) : '—'}{' '}
                      <span className="font-mono text-[11px] text-muted">limit ±{bpPct(policy?.weightToleranceBp, 2)}</span>
                    </td>
                  )}
                </tr>
                <tr>
                  <td>Moisture (%)</td>
                  {s.baseline && <td className="r font-mono">{bpPct(s.baseline.moistureBp, 1, '')}</td>}
                  <td>
                    <label className="sr-only" htmlFor="obs-mo">Observed moisture percent</label>
                    <input id="obs-mo" className="input max-w-[160px] font-mono" inputMode="decimal" value={mo} onChange={(e) => setMo(e.target.value)} />
                  </td>
                  {s.baseline && (
                    <td className="whitespace-nowrap">
                      {c ? chip(c.moistOk, c.moistGap === 0 ? 'match' : signedBp(c.moistGap, 1, ' pp')) : '—'}{' '}
                      <span className="font-mono text-[11px] text-muted">limit ±{bpPct(policy?.moistureToleranceBp, 1, ' pp')}</span>
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
          {needSeal && (
            <label className="flex items-center gap-2 border-t border-line px-4 py-3 text-[13px]">
              <input type="checkbox" checked={sealOk} onChange={(e) => setSealOk(e.target.checked)} />
              Sample seal <b className="font-mono">{s.seal}</b> is intact and matches
            </label>
          )}
          {!valid && (kgIn || mo) && <p className="m-0 px-4 pb-3 text-[12px] text-danger">Weight must be whole kilograms; moisture a percentage with up to 2 decimals.</p>}
        </Section>
        <Section title="Evidence">
          <EvidenceInput label="Scale printout, moisture meter photo" value={evidence} onChange={setEvidence} />
          <div className="mt-3 flex items-start gap-2 rounded-card border border-dashed border-line p-3 text-[12px] text-muted">
            <span className="font-mono font-semibold text-ink">IOT_DEVICE</span>
            Reserved source for signed scale and moisture-sensor readings. Not active in this PoC.
          </div>
        </Section>
      </div>
      <aside className="flex flex-col gap-5">
        {s.mode === 'ATTEST' && c?.ok && (
          <section className="flex flex-col gap-3 rounded-card bg-ink p-4 text-white">
            <Chip tone="green">Within tolerance</Chip>
            <b className="text-[16px]">A receipt will be minted with your readings.</b>
            <div className="grid grid-cols-2 gap-y-1 font-mono text-[13px] text-muted-dark-2">
              <span>grade</span>
              <span className="text-white">{grade}</span>
              <span>net kg</span>
              <span className="text-white">{netKg?.toLocaleString('en-US')}</span>
              <span>moisture</span>
              <span className="text-white">{bpPct(moistureBp)}</span>
              <span>status</span>
              <span className="text-white">ISSUED · PENDING_WRRB</span>
            </div>
            <Button variant="accent" size="form" onClick={submit} disabled={tx.pending || !valid}>
              Submit attestation
            </Button>
          </section>
        )}
        {s.mode === 'ATTEST' && c && !c.ok && (
          <section className="flex flex-col gap-3 rounded-card border border-tint-red-line bg-tint-red p-4">
            <Chip tone="red">Outside tolerance</Chip>
            <b className="text-[16px]">No receipt. A MINT_MISMATCH dispute opens automatically.</b>
            <p className="m-0 text-[13px]">The regulator assigns a second inspector. Submit only what you measured; the warehouse cannot see your reading before you sign.</p>
            <Button size="form" onClick={submit} disabled={tx.pending || !valid}>
              Submit attestation
            </Button>
          </section>
        )}
        {s.mode !== 'ATTEST' && (
          <section className="flex flex-col gap-3 rounded-card bg-ink p-4 text-white">
            <b className="text-[16px]">{s.mode === 'QUALITY' ? 'The receipt is amended to your readings.' : 'Your reading goes to the regulator beside the original.'}</b>
            <p className="m-0 text-[13px] text-muted-dark-2">
              {s.mode === 'QUALITY'
                ? 'Every change is logged in the amendments. If the receipt is pledged, LTV is recomputed and a margin call or default may follow.'
                : 'You cannot see the original reading until you submit. The regulator rules after seeing both.'}
            </p>
            <Button variant="accent" size="form" onClick={submit} disabled={tx.pending || !valid}>
              {s.mode === 'QUALITY' ? 'Submit quality check' : 'Submit re-inspection'}
            </Button>
          </section>
        )}
        <WhyYou s={s} />
      </aside>
    </div>
  );
}

function WhyYou({ s }: { s: Subject }) {
  const inspectors = useInspectors();
  const pool = (inspectors.data ?? []).filter((i) => i.status === 'ACTIVE' && !i.conflictWarehouseIds.includes(s.warehouseId)).map((i) => i.id);
  return (
    <Section title="Why you">
      <p className="m-0 text-[13px] leading-relaxed text-muted">
        Drawn by <Mono>sha256(txId) mod {pool.length}</Mono> from {pool.join(', ')}
        {s.mode === 'REINSPECT' ? ', excluding the inspector whose reading is disputed' : ''}. Inspectors with a declared conflict with {s.warehouseId} are never drawn.
      </p>
    </Section>
  );
}

function useSubject(subjectId: string | undefined): { subject: Subject | null; loading: boolean; error: unknown } {
  const kind: Mode | null = subjectId?.startsWith('DEP-') ? 'ATTEST' : subjectId?.startsWith('WRT-') ? 'QUALITY' : subjectId?.startsWith('DSP-') ? 'REINSPECT' : null;
  const deposits = useDeposits({}, kind === 'ATTEST');
  const receipt = useReceipt(kind === 'QUALITY' ? subjectId : undefined);
  const dispute = useDispute(kind === 'REINSPECT' ? subjectId : undefined);
  if (!kind || !subjectId) return { subject: null, loading: false, error: null };
  if (kind === 'ATTEST') {
    const d = deposits.data?.find((x) => x.id === subjectId);
    return {
      loading: deposits.isLoading,
      error: deposits.error,
      subject: d
        ? {
            mode: 'ATTEST',
            id: d.id,
            title: d.id,
            warehouseId: d.warehouseId,
            commodity: d.commodity,
            baseline: d.declared,
            baselineLabel: `Declared · ${d.warehouseId}`,
            seal: d.sampleSealNo,
            submit: (observed, evidence, sealOk) => api.post(`/deposits/${d.id}/attestation`, { observed, evidence, sampleSealNoVerified: sealOk }),
          }
        : null,
    };
  }
  if (kind === 'QUALITY') {
    const r = receipt.data?.receipt;
    return {
      loading: receipt.isLoading,
      error: receipt.error,
      subject: r
        ? {
            mode: 'QUALITY',
            id: r.id,
            title: r.id,
            warehouseId: r.warehouseId,
            commodity: r.commodity,
            baseline: { grade: r.grade, netKg: r.netKg, moistureBp: r.moistureBp },
            baselineLabel: 'On the receipt',
            submit: (observed, evidence) => api.post(`/receipts/${r.id}/quality-check/result`, { observed, evidence }),
          }
        : null,
    };
  }
  const v = dispute.data;
  return {
    loading: dispute.isLoading,
    error: dispute.error,
    subject: v
      ? {
          mode: 'REINSPECT',
          id: v.dispute.id,
          title: `${v.dispute.id} · ${v.dispute.subject.id}`,
          warehouseId: v.receipt?.warehouseId ?? v.deposit?.warehouseId ?? '',
          commodity: v.receipt?.commodity ?? v.deposit?.commodity ?? '',
          baseline: null,
          baselineLabel: '',
          submit: (observed, evidence) => api.post(`/disputes/${v.dispute.id}/reinspection`, { observed, evidence }),
        }
      : null,
  };
}

export function InspectionForm() {
  const { subjectId } = useParams();
  const { me } = useIdentity();
  const queue = useInspectorQueue(me?.chaincodeView.entityId ?? undefined);
  const policy = usePolicy();
  const navigate = useNavigate();
  const { subject, loading, error } = useSubject(subjectId);
  const firstOf = (m: Mode) =>
    m === 'ATTEST' ? queue.data?.attest[0]?.id : m === 'QUALITY' ? queue.data?.quality[0]?.id : queue.data?.reinspect[0]?.id;

  useEffect(() => {
    if (!subjectId && queue.data) {
      const first = firstOf('ATTEST') ?? firstOf('QUALITY') ?? firstOf('REINSPECT');
      if (first) navigate(`/inspector/inspect/${first}`, { replace: true });
    }
  });

  const mode: Mode | null = subject?.mode ?? null;
  const tabs: [Mode, string][] = [
    ['ATTEST', 'Attestation'],
    ['QUALITY', 'Quality check'],
    ['REINSPECT', 'Re-inspection'],
  ];
  return (
    <>
      <nav className="font-mono text-[12px] text-muted">
        <Link to="/inspector">Queue</Link> / {subjectId ?? 'form'}
      </nav>
      <PageHeader eyebrow={subject ? `${subject.warehouseId} · ${commodity(subject.commodity)}` : 'Inspector'} title={subject?.title ?? 'Inspection form'} mono={!!subject} />
      <div className="tabs" role="tablist" aria-label="Inspection type">
        {tabs.map(([m, label]) => {
          const target = m === mode ? subjectId : firstOf(m);
          return (
            <button key={m} type="button" role="tab" aria-selected={m === mode} className="tab" disabled={!target} title={target ? undefined : 'Nothing of this type is assigned to you'} onClick={() => target && navigate(`/inspector/inspect/${target}`)}>
              {label}
            </button>
          );
        })}
      </div>
      {!subjectId && queue.data && <EmptyState title="Nothing to inspect">Your queue is empty.</EmptyState>}
      {loading && <Loading />}
      {Boolean(error) && <Callout tone="error">{String((error as Error).message)}</Callout>}
      {subjectId && !loading && !subject && !error && <EmptyState title="Not in your queue">This subject is not assigned to you, or it has already been inspected.</EmptyState>}
      {subject && (
        <>
          {subject.mode === 'REINSPECT' && <Callout tone="info">Original reading hidden until you submit. Record what you measure.</Callout>}
          {subject.baseline && subject.mode === 'ATTEST' && (
            <p className="m-0 text-[13px] text-muted">
              Declared {kg(subject.baseline.netKg)}. Try a weight outside ±{bpPct(policy.data?.weightToleranceBp, 2)} to see the mismatch path.
            </p>
          )}
          <Form key={subject.id} s={subject} policy={policy.data} />
        </>
      )}
    </>
  );
}
