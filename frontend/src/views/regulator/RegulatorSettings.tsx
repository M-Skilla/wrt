/** Screen 25: reference prices and policy parameters. Demo-mode toggle. */
import type { PolicyDurations, PolicyParams } from '@wrt/shared';
import { useEffect, useState } from 'react';
import { Button, Callout, FilterTabs, Mono, PageHeader, Section, TableCard } from '../../components/ui';
import { api } from '../../lib/api';
import { bpPct, commodity, date, duration, parseWhole } from '../../lib/format';
import { usePolicy, usePrices } from '../../lib/queries';
import { useTx } from '../../lib/tx';

const GRADES = ['G1', 'G2', 'G3'];
const DURATIONS: [keyof PolicyDurations, string][] = [
  ['marginCallGraceSecs', 'Margin call grace'],
  ['maturityGraceSecs', 'Maturity grace'],
  ['challengeWindowSecs', 'Challenge window'],
  ['qualityCheckIntervalSecs', 'Quality check interval'],
  ['attestationMaxAgeSecs', 'Attestation max age'],
  ['receiptTermSecs', 'Receipt storage term'],
];

function Prices() {
  const prices = usePrices();
  const tx = useTx();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const commodities = [...new Set((prices.data ?? []).map((p) => p.commodity))].sort();
  const get = (c: string, g: string) => prices.data?.find((p) => p.commodity === c && p.grade === g);
  const changed = Object.entries(edits).filter(([k, v]) => {
    const [c, g] = k.split('~');
    return parseWhole(v) !== null && parseWhole(v) !== get(c!, g!)?.priceTzsPerKg;
  });
  async function publish() {
    for (const [k, v] of changed) {
      const [c, g] = k.split('~');
      await tx.run(() => api.put('/prices', { commodity: c, grade: g, priceTzsPerKg: parseWhole(v) }), () => `${commodity(c!)} ${g} = ${v} TZS/kg`);
    }
    setEdits({});
  }
  return (
    <>
      <TableCard title="Reference prices · TZS per kg" aside="Illustrative demo values. Collateral value = net kg × price.">
        <thead>
          <tr>
            <th>Commodity</th>
            {GRADES.map((g) => (
              <th key={g} className="r">
                {g}
              </th>
            ))}
            <th>Last set</th>
          </tr>
        </thead>
        <tbody>
          {commodities.map((c) => (
            <tr key={c}>
              <td>{commodity(c)}</td>
              {GRADES.map((g) => {
                const p = get(c, g);
                const key = `${c}~${g}`;
                return (
                  <td key={g} className="r">
                    <input
                      aria-label={`${commodity(c)} ${g}`}
                      className="input ml-auto min-h-[36px] max-w-[110px] text-right font-mono"
                      value={edits[key] ?? String(p?.priceTzsPerKg ?? '')}
                      onChange={(e) => setEdits({ ...edits, [key]: e.target.value })}
                    />
                  </td>
                );
              })}
              <td className="font-mono">
                {date(get(c, 'G1')?.effectiveAt)} · {get(c, 'G1')?.setBy}
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setEdits({})} disabled={!changed.length}>
          Discard
        </Button>
        <Button onClick={() => void publish()} disabledReason={!changed.length && 'No price changes'} disabled={tx.pending}>
          Publish {changed.length || ''} change{changed.length === 1 ? '' : 's'}
        </Button>
      </div>
      <p className="m-0 text-[13px] text-muted">
        Each price signs <Mono>SetReferencePrice</Mono>. Open loans are revalued at the next keeper pass, which may raise margin calls.
      </p>
    </>
  );
}

function Policy() {
  const policy = usePolicy();
  const tx = useTx();
  const [draft, setDraft] = useState<PolicyParams | null>(null);
  useEffect(() => {
    if (policy.data && !draft) setDraft(policy.data);
  }, [policy.data, draft]);
  if (!draft || !policy.data) return null;
  const p = draft;
  const dirty = JSON.stringify(p) !== JSON.stringify(policy.data);
  const bpField = (key: 'maxLtvBp' | 'marginCallLtvBp' | 'liquidationLtvBp' | 'weightToleranceBp' | 'moistureToleranceBp', label: string, fmt: (bp: number) => string) => (
    <div className="grid items-center gap-2 border-b border-line-soft py-2 text-[13px] last:border-b-0" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) 120px' }}>
      <span>
        <b>{label}</b> <span className="block font-mono text-[11px] text-muted">{key}</span>
      </span>
      <span className="font-mono">{fmt(p[key])}</span>
      <input aria-label={key} className="input min-h-[36px] text-right font-mono" value={String(p[key])} onChange={(e) => setDraft({ ...p, [key]: parseWhole(e.target.value) ?? p[key] })} />
    </div>
  );
  const ordered = p.maxLtvBp < p.marginCallLtvBp && p.marginCallLtvBp < p.liquidationLtvBp;
  async function publish() {
    const body = {
      maxLtvBp: p.maxLtvBp,
      marginCallLtvBp: p.marginCallLtvBp,
      liquidationLtvBp: p.liquidationLtvBp,
      weightToleranceBp: p.weightToleranceBp,
      moistureToleranceBp: p.moistureToleranceBp,
      gradeMustMatch: p.gradeMustMatch,
      durations: p.durations,
      demoDurations: p.demoDurations,
      demoMode: p.demoMode,
    };
    const r = await tx.run(() => api.put<PolicyParams>('/policy', body), () => 'Policy parameters published.');
    if (r) setDraft(r);
  }
  return (
    <>
      <Section
        title="PolicyParams"
        aside={
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <input type="checkbox" checked={p.demoMode} onChange={(e) => setDraft({ ...p, demoMode: e.target.checked })} />
            Demo mode · short durations
          </label>
        }
      >
        {bpField('maxLtvBp', 'Max LTV at offer', (bp) => bpPct(bp, 2))}
        {bpField('marginCallLtvBp', 'Margin call LTV', (bp) => bpPct(bp, 2))}
        {bpField('liquidationLtvBp', 'Default LTV', (bp) => bpPct(bp, 2))}
        {bpField('weightToleranceBp', 'Weight tolerance', (bp) => `±${bpPct(bp, 2)}`)}
        {bpField('moistureToleranceBp', 'Moisture tolerance', (bp) => `±${bpPct(bp, 1, ' pp')}`)}
        <div className="grid items-center gap-2 border-b border-line-soft py-2 text-[13px]" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) 120px' }}>
          <span>
            <b>Grade must match</b> <span className="block font-mono text-[11px] text-muted">gradeMustMatch</span>
          </span>
          <span className="font-mono">{String(p.gradeMustMatch)}</span>
          <input aria-label="gradeMustMatch" type="checkbox" className="justify-self-end" checked={p.gradeMustMatch} onChange={(e) => setDraft({ ...p, gradeMustMatch: e.target.checked })} />
        </div>
        <div className="mt-4 grid gap-2 text-[13px]" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)' }}>
          <span className="eyebrow">Duration (seconds)</span>
          <span className={`eyebrow ${p.demoMode ? '' : 'text-ink'}`}>Production{!p.demoMode && ' (active)'}</span>
          <span className={`eyebrow ${p.demoMode ? 'text-ink' : ''}`}>Demo{p.demoMode && ' (active)'}</span>
          {DURATIONS.map(([k, label]) => (
            <div key={k} className="contents">
              <span>
                <b>{label}</b> <span className="block font-mono text-[11px] text-muted">{k}</span>
              </span>
              {(['durations', 'demoDurations'] as const).map((set) => (
                <label key={set} className="flex items-center gap-2">
                  <input
                    aria-label={`${set}.${k}`}
                    className="input min-h-[36px] font-mono"
                    value={String(p[set][k])}
                    onChange={(e) => setDraft({ ...p, [set]: { ...p[set], [k]: parseWhole(e.target.value) ?? p[set][k] } })}
                  />
                  <span className="w-[56px] font-mono text-[11px] text-muted">{duration(p[set][k])}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </Section>
      {!ordered && <Callout tone="error" title="INVALID_ARGUMENT">Thresholds must satisfy maxLtvBp &lt; marginCallLtvBp &lt; liquidationLtvBp.</Callout>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setDraft(policy.data!)} disabled={!dirty}>
          Discard
        </Button>
        <Button onClick={() => void publish()} disabledReason={!dirty ? 'No changes' : !ordered && 'Fix the LTV thresholds first'} disabled={tx.pending}>
          Publish changes
        </Button>
      </div>
      <p className="m-0 text-[13px] text-muted">
        Signs <Mono>SetPolicyParams</Mono>. Only the regulator can change these; changing the endorsement policy itself needs a majority of org admins (docs/GOVERNANCE.md).
      </p>
    </>
  );
}

export function RegulatorSettings() {
  const [tab, setTab] = useState<'prices' | 'policy'>('prices');
  return (
    <>
      <PageHeader eyebrow="Regulator-only parameters" title="Prices & policy" />
      <FilterTabs
        label="Settings"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'prices', label: 'Reference prices' },
          { id: 'policy', label: 'Policy parameters' },
        ]}
      />
      {tab === 'prices' ? <Prices /> : <Policy />}
    </>
  );
}
