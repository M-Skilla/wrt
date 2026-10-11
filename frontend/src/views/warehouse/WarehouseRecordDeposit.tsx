/** Screen 08: record deposit. Evidence is hashed client-side and shown before submit. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, LinkButton, Mono, PageHeader, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { bpPct, commodity, parsePercentToBp, parseWhole } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useFarmerPII, useFarmers, useInspectors, usePolicy, usePrices } from '../../lib/queries';
import { useTx } from '../../lib/tx';
import { EvidenceInput, Field, Grid2, RegisterFarmerModal } from '../../modals/Modals';
import type { Deposit } from '@wrt/shared';

function FarmerOption({ id }: { id: string }) {
  const pii = useFarmerPII(id);
  return (
    <option value={id}>
      {id}
      {pii.data ? ` · ${pii.data.fullName} · ${pii.data.villageOrWard}` : ''}
    </option>
  );
}

export function WarehouseRecordDeposit() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const farmers = useFarmers(id);
  const prices = usePrices();
  const policy = usePolicy();
  const inspectors = useInspectors();
  const tx = useTx();
  const navigate = useNavigate();
  const commodities = useMemo(() => [...new Set((prices.data ?? []).map((p) => p.commodity))].sort(), [prices.data]);
  const [form, setForm] = useState({ farmerId: '', commodity: '', grade: 'G1', netKg: '', moisture: '', seal: '', ticket: '' });
  const [evidence, setEvidence] = useState<string[]>([]);
  const [registerOpen, setRegisterOpen] = useState(false);
  const grades = (prices.data ?? []).filter((p) => p.commodity === (form.commodity || commodities[0])).map((p) => p.grade).sort();
  const netKg = parseWhole(form.netKg);
  const moistureBp = parsePercentToBp(form.moisture);
  const farmerId = form.farmerId || farmers.data?.find((f) => f.status === 'ACTIVE')?.id || '';
  const commodityCode = form.commodity || commodities[0] || '';
  const ok = farmerId && commodityCode && netKg && moistureBp !== null && form.seal;
  const eligible = (inspectors.data ?? []).filter((i) => i.status === 'ACTIVE' && !i.conflictWarehouseIds.includes(id ?? ''));

  async function submit() {
    const d = await tx.run(
      () =>
        api.post<Deposit>('/deposits', {
          farmerId,
          commodity: commodityCode,
          declared: { grade: form.grade, netKg, moistureBp },
          declaredEvidence: evidence,
          sampleSealNo: form.seal,
        }),
      (dep) => `${dep.id} recorded; inspector ${dep.assignedInspectorId} drawn from the tx hash.`,
    );
    if (d) navigate('/warehouse/deposits');
  }

  return (
    <>
      <PageHeader eyebrow="Step 1 of minting" title="Record deposit" sub="Declare what arrived. An independent inspector checks it before any receipt exists. If their reading differs beyond tolerance, a dispute opens automatically." />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <form className="card flex flex-col" onSubmit={(e) => e.preventDefault()}>
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <h2 className="section-title flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-ink font-mono text-[12px] text-white">1</span>Farmer and commodity
            </h2>
            <Grid2>
              <Field label="Farmer" hint={<>Not listed? <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] text-link underline" onClick={() => setRegisterOpen(true)}>Register farmer</button></>}>
                <select className="input" value={farmerId} onChange={(e) => setForm({ ...form, farmerId: e.target.value })}>
                  {(farmers.data ?? []).filter((f) => f.status === 'ACTIVE').map((f) => (
                    <FarmerOption key={f.id} id={f.id} />
                  ))}
                </select>
              </Field>
              <Field label="Commodity">
                <select className="input" value={commodityCode} onChange={(e) => setForm({ ...form, commodity: e.target.value })}>
                  {commodities.map((c) => (
                    <option key={c} value={c}>
                      {commodity(c)}
                    </option>
                  ))}
                </select>
              </Field>
            </Grid2>
          </div>
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <h2 className="section-title flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-ink font-mono text-[12px] text-white">2</span>Declared measurements
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Grade">
                <select className="input" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
                  {(grades.length ? grades : ['G1', 'G2', 'G3']).map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </Field>
              <Field label="Net weight (kg)" hint={form.netKg && netKg === null ? 'Whole kilograms only' : 'From weighbridge, after tare'}>
                <input className="input font-mono" inputMode="numeric" value={form.netKg} onChange={(e) => setForm({ ...form, netKg: e.target.value })} />
              </Field>
              <Field label="Moisture (%)" hint={moistureBp !== null ? `Stored as ${moistureBp} bp` : form.moisture ? 'Up to 2 decimals, e.g. 13.4' : 'e.g. 13.4'}>
                <input className="input font-mono" inputMode="decimal" value={form.moisture} onChange={(e) => setForm({ ...form, moisture: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <h2 className="section-title flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-ink font-mono text-[12px] text-white">3</span>Sample and evidence
            </h2>
            <Grid2>
              <Field label="Sample seal number" hint="Tamper seal on the retained sample bag. The inspector must verify it.">
                <input className="input font-mono" value={form.seal} onChange={(e) => setForm({ ...form, seal: e.target.value })} placeholder="TZ-SL-0101447" />
              </Field>
              <Field label="Weighbridge ticket no.">
                <input className="input font-mono" value={form.ticket} onChange={(e) => setForm({ ...form, ticket: e.target.value })} />
              </Field>
            </Grid2>
            <EvidenceInput label="Weighbridge ticket and sample photos" value={evidence} onChange={setEvidence} />
            <span className="hint">Files stay off-chain. Only their sha256 hashes are written to the ledger, so any later swap is detectable.</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="hint">
              Submitting signs <Mono>ReceiptContract:RecordDeposit</Mono> as {id}.
            </span>
            <div className="flex gap-2">
              <LinkButton to="/warehouse" variant="secondary">
                Cancel
              </LinkButton>
              <Button variant="accent" size="form" onClick={submit} disabledReason={!ok && 'Fill in farmer, weight, moisture and seal'} disabled={tx.pending}>
                {tx.pending ? 'Recording…' : 'Record deposit'}
              </Button>
            </div>
          </div>
        </form>
        <aside className="flex flex-col gap-5">
          <Section title="Tolerance the inspector will apply">
            {policy.data && (
              <div className="grid grid-cols-2 gap-y-2 font-mono text-[13px]">
                <span className="text-muted">Grade</span>
                <span>{policy.data.gradeMustMatch ? 'exact match' : 'any'}</span>
                <span className="text-muted">Net weight</span>
                <span>±{bpPct(policy.data.weightToleranceBp, 2)}</span>
                <span className="text-muted">Moisture</span>
                <span>±{bpPct(policy.data.moistureToleranceBp, 1, ' pp')}</span>
                <span className="text-muted">Seal</span>
                <span>must verify</span>
              </div>
            )}
            <p className="hint mb-0 mt-3">Set by the regulator in policy params.</p>
          </Section>
          <Section title="What happens next">
            <ol className="m-0 flex flex-col gap-2 pl-5 text-[13px] leading-relaxed">
              <li>Chaincode draws an inspector from the tx hash. You can't choose. Conflicted inspectors are excluded.</li>
              <li>Inspector weighs, grades and checks the seal independently.</li>
              <li>Within tolerance: receipt minted with the inspector's values.</li>
              <li>
                Outside tolerance: no receipt, <Mono>MINT_MISMATCH</Mono> dispute opens for the regulator.
              </li>
            </ol>
          </Section>
          <Section title="Eligible inspectors">
            {(inspectors.data ?? []).map((i) => {
              const reason = i.status !== 'ACTIVE' ? i.status.toLowerCase() : i.conflictWarehouseIds.includes(id ?? '') ? 'declared conflict' : null;
              return (
                <div key={i.id} className="flex justify-between border-b border-line-soft py-2 text-[13px] last:border-b-0">
                  <span className={`font-mono ${reason ? 'text-muted line-through' : ''}`}>{i.id}</span>
                  <span className="text-muted">{reason ?? 'eligible'}</span>
                </div>
              );
            })}
            <p className="hint mb-0 mt-2">Pool of {eligible.length}: one is drawn by sha256(txId) mod {eligible.length}.</p>
          </Section>
        </aside>
      </div>
      <RegisterFarmerModal open={registerOpen} onClose={() => setRegisterOpen(false)} />
    </>
  );
}
