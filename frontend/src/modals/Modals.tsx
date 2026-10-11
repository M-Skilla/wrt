/** Action dialogs (handoff ModalsA / ModalsB). Each shows the chaincode function it signs. */
import type { Dispute, Escrow, Loan, PolicyParams, WarehouseReceipt } from '@wrt/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { CheckRow } from '../components/ledger';
import { Button, Callout, KV, Mono, Signs } from '../components/ui';
import { api } from '../lib/api';
import { bpPct, bpToInput, commodity, date, duration, kg, parsePercentToBp, parseWhole, tzs } from '../lib/format';
import { useIdentity } from '../lib/identity';
import { useFarmers, useInspectors, usePolicy, useWarehouses } from '../lib/queries';
import { useTx } from '../lib/tx';

interface ModalProps {
  open: boolean;
  onClose: () => void;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

// ------------------------------------------------------------------ Evidence

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** File picker: hashes the file in the browser (shown before submit), stores it off-chain, returns the hash. */
export function EvidenceInput({ label, value, onChange }: { label: string; value: string[]; onChange: (hashes: string[]) => void }) {
  const [files, setFiles] = useState<{ name: string; hash: string; size: number; stored: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  async function add(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    const next = [...files];
    for (const file of Array.from(list)) {
      const hash = await sha256Hex(file);
      let stored = false;
      try {
        const res = await api.upload(file);
        stored = res.sha256 === hash;
      } catch {
        stored = false;
      }
      next.push({ name: file.name, hash, size: file.size, stored });
    }
    setFiles(next);
    onChange([...new Set([...value, ...next.map((f) => f.hash)])]);
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer flex-col gap-1 rounded-card border border-dashed border-input-line bg-surface-2 p-3 text-[13px]">
        <b>{label}</b>
        <span className="hint">{busy ? 'hashing…' : 'Choose files. Only their sha256 hashes go on-chain.'}</span>
        <input type="file" multiple className="text-[12px]" onChange={(e) => void add(e.target.files)} />
      </label>
      {files.map((f) => (
        <div key={f.hash} className="flex flex-wrap justify-between gap-2 font-mono text-[12px] text-muted">
          <span>
            {f.name} · {(f.size / 1024).toFixed(0)} KB
          </span>
          <span>
            sha256 {f.hash.slice(0, 6)}…{f.hash.slice(-4)} {f.stored ? '· stored' : '· not stored'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Register farmer (Warehouse)

export function RegisterFarmerModal({ open, onClose }: ModalProps) {
  const { me } = useIdentity();
  const farmers = useFarmers();
  const tx = useTx();
  const [f, setF] = useState({ fullName: '', phone: '', villageOrWard: '', nidaNo: '' });
  const nextId = useMemo(() => {
    const max = Math.max(0, ...(farmers.data ?? []).map((x) => Number(x.id.replace(/\D/g, '')) || 0));
    return `FRM-${String(max + 1).padStart(3, '0')}`;
  }, [farmers.data]);
  const ok = f.fullName && f.phone && f.villageOrWard && f.nidaNo;
  async function submit() {
    const r = await tx.run(() => api.post('/farmers', { farmerId: nextId, pii: f }), () => `${nextId} registered; PII stored privately.`);
    if (r) {
      setF({ fullName: '', phone: '', villageOrWard: '', nidaNo: '' });
      onClose();
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Register farmer"
      subtitle="Identity goes to the private collection, not public state."
      error={tx.error}
      hint={<span className="hint font-mono">→ {nextId}</span>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={submit} disabled={!ok || tx.pending}>
            {tx.pending ? 'Registering…' : 'Register'}
          </Button>
        </>
      }
    >
      <Field label="Full name">
        <input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
      </Field>
      <Grid2>
        <Field label="Phone">
          <input className="input font-mono" value={f.phone} placeholder="+255 7…" onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Village / ward">
          <input className="input" value={f.villageOrWard} onChange={(e) => setF({ ...f, villageOrWard: e.target.value })} />
        </Field>
      </Grid2>
      <Field label="NIDA number">
        <input className="input font-mono" value={f.nidaNo} onChange={(e) => setF({ ...f, nidaNo: e.target.value })} />
      </Field>
      <p className="hint m-0">
        Sent as transient data to <Mono>farmerPII</Mono>, endorsed by Warehouse, Lender and Regulator only. On-chain: <Mono>{nextId}</Mono> + <Mono>sha256</Mono>. Registered
        by <Mono>{me?.chaincodeView.entityId}</Mono>.
      </p>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Register warehouse / lender / inspector (Regulator)

export function RegisterWarehouseModal({ open, onClose }: ModalProps) {
  const warehouses = useWarehouses();
  const tx = useTx();
  const nextId = `WH-${String(Math.max(0, ...(warehouses.data ?? []).map((w) => Number(w.id.replace(/\D/g, '')) || 0)) + 1).padStart(3, '0')}`;
  const [f, setF] = useState({ name: '', region: 'Dodoma', capacityKg: '', licenseNo: '', bondRef: '' });
  const cap = parseWhole(f.capacityKg);
  async function submit() {
    const r = await tx.run(() => api.post('/warehouses', { id: nextId, name: f.name, region: f.region, capacityKg: cap, licenseNo: f.licenseNo, bondRef: f.bondRef }), () => `${nextId} onboarded.`);
    if (r) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Register warehouse"
      subtitle="Onboards a hosted member. No node required."
      error={tx.error}
      hint={<span className="hint font-mono">→ {nextId}</span>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!f.name || cap === null || !f.licenseNo || !f.bondRef || tx.pending}>
            Register
          </Button>
        </>
      }
    >
      <Field label="Warehouse name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Grid2>
        <Field label="Region">
          <select className="input" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>
            {['Dodoma', 'Morogoro', 'Singida', 'Iringa', 'Mbeya', 'Mtwara'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Capacity (kg)">
          <input className="input font-mono" value={f.capacityKg} onChange={(e) => setF({ ...f, capacityKg: e.target.value })} />
        </Field>
      </Grid2>
      <Grid2>
        <Field label="WRRB licence no.">
          <input className="input font-mono" value={f.licenseNo} onChange={(e) => setF({ ...f, licenseNo: e.target.value })} />
        </Field>
        <Field label="Bond / insurance ref">
          <input className="input font-mono" value={f.bondRef} onChange={(e) => setF({ ...f, bondRef: e.target.value })} />
        </Field>
      </Grid2>
      <p className="hint m-0">Operators get a client certificate from the Warehouse CA with wrt.role=warehouse_operator and wrt.entityId={nextId} (network/identities.conf).</p>
    </Dialog>
  );
}

export function RegisterLenderModal({ open, onClose, preset }: ModalProps & { preset?: { id: string; name: string; type: string; licenseNo: string } }) {
  const tx = useTx();
  const [f, setF] = useState(preset ?? { id: '', name: '', type: 'MFI', licenseNo: '' });
  async function submit() {
    const r = await tx.run(() => api.post('/lenders', f), () => `${f.id} onboarded.`);
    if (r) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Register lender"
      subtitle="RegistryContract:RegisterLender"
      error={tx.error}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!f.id || !f.name || !f.licenseNo || tx.pending}>
            Register
          </Button>
        </>
      }
    >
      <Grid2>
        <Field label="Lender ID" hint="Must match the wrt.entityId on the officer's certificate">
          <input className="input font-mono" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} placeholder="LND-MFI-01" />
        </Field>
        <Field label="Type">
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="BANK">Bank (full node operator)</option>
            <option value="MFI">MFI (hosted)</option>
            <option value="SACCO">SACCO (hosted)</option>
          </select>
        </Field>
      </Grid2>
      <Field label="Name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Licence no.">
        <input className="input font-mono" value={f.licenseNo} onChange={(e) => setF({ ...f, licenseNo: e.target.value })} />
      </Field>
    </Dialog>
  );
}

export function AccreditInspectorModal({ open, onClose }: ModalProps) {
  const tx = useTx();
  const inspectors = useInspectors();
  const warehouses = useWarehouses();
  const nextId = `INS-${String(Math.max(0, ...(inspectors.data ?? []).map((w) => Number(w.id.replace(/\D/g, '')) || 0)) + 1).padStart(2, '0')}`;
  const [f, setF] = useState({ name: '', accreditationNo: '', conflicts: [] as string[] });
  async function submit() {
    const r = await tx.run(() => api.post('/inspectors', { id: nextId, name: f.name, accreditationNo: f.accreditationNo, conflictWarehouseIds: f.conflicts }), () => `${nextId} accredited.`);
    if (r) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Accredit inspector"
      subtitle="RegistryContract:AccreditInspector"
      error={tx.error}
      hint={<span className="hint font-mono">→ {nextId}</span>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!f.name || !f.accreditationNo || tx.pending}>
            Accredit
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Accreditation no.">
        <input className="input font-mono" value={f.accreditationNo} onChange={(e) => setF({ ...f, accreditationNo: e.target.value })} />
      </Field>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="field mb-1">Declared conflicts (never drawn for these warehouses)</legend>
        {(warehouses.data ?? []).map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={f.conflicts.includes(w.id)}
              onChange={(e) => setF({ ...f, conflicts: e.target.checked ? [...f.conflicts, w.id] : f.conflicts.filter((c) => c !== w.id) })}
            />
            <Mono>{w.id}</Mono> {w.name}
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Make offer (Lender)

export function MakeOfferModal({ open, onClose, receipt, collateralTzs }: ModalProps & { receipt: WarehouseReceipt; collateralTzs: number }) {
  const policy = usePolicy();
  const tx = useTx();
  const navigate = useNavigate();
  const maxLtv = policy.data?.maxLtvBp ?? 6000;
  const maxPrincipal = Math.floor((collateralTzs * maxLtv) / 10_000);
  const [principal, setPrincipal] = useState(String(Math.floor(maxPrincipal / 100_000) * 100_000));
  const [interest, setInterest] = useState('8.5');
  const [term, setTerm] = useState('7776000');
  const demo = policy.data?.demoMode;
  const p = parseWhole(principal);
  const i = parsePercentToBp(interest);
  const ltv = p !== null && collateralTzs > 0 ? Math.floor((p * 10_000) / collateralTzs) : null;
  const over = p !== null && p * 10_000 > maxLtv * collateralTzs;
  const totalDue = p !== null && i !== null ? p + Math.floor((p * i) / 10_000) : null;
  const terms: [string, string][] = [
    ['7776000', '90 days'],
    ['10368000', '120 days'],
    ['15552000', '180 days'],
    ...(demo ? ([['120', '2 min (demo)'], ['600', '10 min (demo)']] as [string, string][]) : []),
  ];
  async function submit() {
    const r = await tx.run(() => api.post<Loan>('/loans', { receiptId: receipt.id, principalTzs: p, interestBp: i, termSecs: Number(term) }), (l) => `${l.id} offered.`);
    if (r) {
      onClose();
      navigate(`/loans/${r.id}`);
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Make loan offer"
      subtitle={`${receipt.id} · ${commodity(receipt.commodity)} ${receipt.grade} · ${kg(receipt.netKg)}`}
      error={tx.error}
      hint={<Signs fn="LoanContract:OfferLoan" />}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={submit} disabledReason={over ? `Above the ${bpPct(maxLtv, 0)} maximum LTV` : p === null || i === null ? 'Enter a whole TZS amount and an interest rate' : false} disabled={tx.pending}>
            Send offer
          </Button>
        </>
      }
    >
      <Field label="Principal (TZS)" hint={<>Max at {bpPct(maxLtv, 0)} LTV: <Mono>{tzs(maxPrincipal)}</Mono></>}>
        <input className="input font-mono" inputMode="numeric" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
      </Field>
      <Grid2>
        <Field label="Flat interest (%)">
          <input className="input font-mono" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} />
        </Field>
        <Field label="Term">
          <select className="input" value={term} onChange={(e) => setTerm(e.target.value)}>
            {terms.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </Grid2>
      <div className={`flex items-center justify-between rounded-card border px-4 py-3 ${over ? 'border-tint-red-line bg-tint-red' : 'border-line bg-surface-2'}`}>
        <span className="text-[13px] font-semibold">LTV at offer</span>
        <b className="font-mono text-[20px]">{bpPct(ltv)}</b>
      </div>
      {over && <Callout tone="error" title="LTV_EXCEEDED">Principal is above {bpPct(maxLtv, 0)} of the collateral value; the chaincode would reject it.</Callout>}
      <KV
        rows={[
          ['Farmer repays', <Mono key="a">{tzs(totalDue)}</Mono>],
          ['Collateral value', <Mono key="b">{tzs(collateralTzs)}</Mono>],
        ]}
      />
    </Dialog>
  );
}

// ------------------------------------------------------------------ Accept offer (Farmer)

export function AcceptOfferModal({ open, onClose, loan, receipt, lenderName }: ModalProps & { loan: Loan; receipt?: WarehouseReceipt | undefined; lenderName: string }) {
  const tx = useTx();
  const [ack, setAck] = useState(false);
  async function accept() {
    if (await tx.run(() => api.post(`/loans/${loan.id}/accept`), () => 'Receipt locked as collateral. Waiting for the lender to fund the escrow.')) onClose();
  }
  async function decline() {
    if (await tx.run(() => api.post(`/loans/${loan.id}/cancel`), () => 'Offer declined.')) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Accept this loan?"
      subtitle={`${loan.id} · ${lenderName}`}
      error={tx.error}
      hint={<Signs fn="LoanContract:AcceptLoan" />}
      actions={
        <>
          <Button variant="secondary" onClick={decline} disabled={tx.pending}>
            Decline
          </Button>
          <Button variant="accent" onClick={accept} disabledReason={!ack && 'Tick the box to confirm you understand'} disabled={tx.pending}>
            Accept and lock receipt
          </Button>
        </>
      }
    >
      <div className="flex items-baseline justify-between rounded-card bg-ink px-4 py-3 text-white">
        <span>You receive</span>
        <b className="font-mono text-[22px]">{tzs(loan.principalTzs)}</b>
      </div>
      <KV
        rows={[
          ['You repay', <Mono key="a">{tzs(loan.totalDueTzs)}</Mono>],
          ['Due', `${duration(loan.termSecs)} after payout`],
          ['Collateral', receipt ? `${commodity(receipt.commodity)} ${receipt.grade} · ${kg(receipt.netKg)}` : loan.receiptId],
        ]}
      />
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        I understand my receipt is locked until I repay in full, and my crop may be sold if I default.
      </label>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Fund escrow (Lender)

export function FundEscrowModal({ open, onClose, loan, receipt, policy }: ModalProps & { loan: Loan; receipt: WarehouseReceipt; policy: Pick<PolicyParams, 'demoMode' | 'durations' | 'demoDurations'> }) {
  const tx = useTx();
  const [amount, setAmount] = useState(String(loan.principalTzs));
  const [ref, setRef] = useState(`BANK-SIM-${Math.floor(10000 + Math.random() * 89999)}`);
  const a = parseWhole(amount);
  const maxAge = (policy.demoMode ? policy.demoDurations : policy.durations).attestationMaxAgeSecs;
  const age = Math.round((Date.now() - new Date(receipt.lastQualityCheckAt).getTime()) / 1000);
  async function submit() {
    const r = await tx.run(
      () => api.post<{ released: boolean }>(`/loans/${loan.id}/fund`, { amountTzs: a, paymentRef: ref }),
      (x) => (x.released ? 'All conditions passed: funds released to the farmer in the same transaction.' : 'Funds held in escrow; some conditions failed.'),
    );
    if (r) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Fund escrow"
      subtitle={`${loan.id} · principal ${tzs(loan.principalTzs)}`}
      error={tx.error}
      hint={<span className="hint">Simulated rail</span>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={a === null || a === 0 || !ref || tx.pending}>
            Fund escrow
          </Button>
        </>
      }
    >
      <Grid2>
        <Field label="Amount (TZS)">
          <input className="input font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Payment ref">
          <input className="input font-mono" value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
      </Grid2>
      <div>
        <div className="eyebrow mb-1">Release checks on submit</div>
        <CheckRow state={a !== null && a >= loan.principalTzs ? 'pass' : 'warn'}>Escrow ≥ principal</CheckRow>
        <CheckRow state={receipt.status === 'PLEDGED' && receipt.legal.status === 'WRRB_REGISTERED' ? 'pass' : 'fail'}>Lien on this loan · WRRB registered</CheckRow>
        <CheckRow state={receipt.status !== 'UNDER_DISPUTE' ? 'pass' : 'fail'}>No open dispute</CheckRow>
        <CheckRow state={age <= maxAge ? 'pass' : 'fail'} evidence={`${duration(age)} old · limit ${duration(maxAge)}`}>
          Attestation fresh
        </CheckRow>
      </div>
      <span className="hint">All pass → funds go to the farmer in the same transaction. The chaincode re-checks every condition.</span>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Repay (Farmer)

export function RepayModal({ open, onClose, loan }: ModalProps & { loan: Loan }) {
  const tx = useTx();
  const outstanding = loan.totalDueTzs - loan.repaidTzs;
  const [amount, setAmount] = useState(String(Math.min(1_000_000, outstanding)));
  const [ref, setRef] = useState(`MPESA-SIM-${Math.floor(4_000_000 + Math.random() * 999_999)}`);
  const a = parseWhole(amount);
  const left = a === null ? null : outstanding - a;
  async function submit() {
    const r = await tx.run(
      () => api.post<{ loan: Loan }>(`/loans/${loan.id}/repay`, { amountTzs: a, paymentRef: ref }),
      (x) => (x.loan.status === 'REPAID' ? 'Loan repaid. Your receipt is unlocked.' : `Payment held in escrow. ${tzs(x.loan.totalDueTzs - x.loan.repaidTzs)} left.`),
    );
    if (r) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Repay"
      subtitle={`${loan.id} · outstanding ${tzs(outstanding)}`}
      error={tx.error}
      hint={<span className="hint">Held in escrow</span>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={submit} disabledReason={a === null || a <= 0 ? 'Enter a whole TZS amount' : a > outstanding ? 'More than you owe' : false} disabled={tx.pending}>
            Repay
          </Button>
        </>
      }
    >
      <Field label="Amount (TZS)">
        <input className="input font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {[500_000, 1_000_000].filter((v) => v < outstanding).map((v) => (
          <Button key={v} variant="secondary" size="sm" onClick={() => setAmount(String(v))}>
            {tzs(v)}
          </Button>
        ))}
        <Button variant="secondary" size="sm" onClick={() => setAmount(String(outstanding))}>
          Pay all · {tzs(outstanding)}
        </Button>
      </div>
      <Field label="Mobile money ref">
        <input className="input font-mono" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <KV
        rows={[
          ['Left after this', <Mono key="a">{tzs(left)}</Mono>],
          ['Receipt', left === 0 ? 'unlocks automatically' : 'stays locked'],
        ]}
      />
    </Dialog>
  );
}

// ------------------------------------------------------------------ Request quality check (Lender / Regulator)

export function RequestQualityCheckModal({ open, onClose, receipt, policy }: ModalProps & { receipt: WarehouseReceipt; policy: PolicyParams }) {
  const tx = useTx();
  const interval = (policy.demoMode ? policy.demoDurations : policy.durations).qualityCheckIntervalSecs;
  const age = Math.round((Date.now() - new Date(receipt.lastQualityCheckAt).getTime()) / 1000);
  async function submit() {
    const r = await tx.run(() => api.post<WarehouseReceipt>(`/receipts/${receipt.id}/quality-check`), (x) => `Inspector ${x.pendingQualityCheck?.assignedInspectorId} drawn.`);
    if (r) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Request quality check"
      subtitle={`${receipt.id} · ${commodity(receipt.commodity)} ${receipt.grade}${receipt.lien ? ` · pledged ${receipt.lien.loanId}` : ''}`}
      error={tx.error}
      hint={<Signs fn="ReceiptContract:RequestQualityCheck" />}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={tx.pending}>
            Request
          </Button>
        </>
      }
    >
      <KV
        rows={[
          ['Last check', <Mono key="a">{date(receipt.lastQualityCheckAt)} · {duration(age)} ago</Mono>],
          ['Policy interval', <Mono key="b">{duration(interval)}</Mono>],
        ]}
      />
      <span className="hint">An inspector is drawn by tx hash. You cannot pick one.</span>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Raise dispute (any party)

export function RaiseDisputeModal({ open, onClose, receipt, policy }: ModalProps & { receipt: WarehouseReceipt; policy: PolicyParams }) {
  const tx = useTx();
  const navigate = useNavigate();
  const [type, setType] = useState('MINT_ACCURACY');
  const [claim, setClaim] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const window = (policy.demoMode ? policy.demoDurations : policy.durations).challengeWindowSecs;
  const closed = Date.now() > new Date(receipt.issuedAt).getTime() + window * 1000;
  const needsEvidence = type === 'MINT_ACCURACY' && closed && evidence.length === 0;
  async function submit() {
    const r = await tx.run(() => api.post<Dispute>('/disputes', { receiptId: receipt.id, type, claim, evidence }), (d) => `${d.id} opened. Receipt frozen.`);
    if (r) {
      onClose();
      navigate(`/disputes/${r.id}`);
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Raise dispute"
      subtitle={`${receipt.id} · ${commodity(receipt.commodity)} ${receipt.grade}${receipt.lien ? ` · ${receipt.lien.loanId}` : ''}`}
      error={tx.error}
      hint={<Signs fn="DisputeContract:RaiseDispute" />}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={submit} disabledReason={!claim ? 'Describe the claim' : needsEvidence ? 'Evidence is required after the challenge window' : false} disabled={tx.pending}>
            Raise and freeze
          </Button>
        </>
      }
    >
      <Field label="Type">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="MINT_ACCURACY">MINT_ACCURACY · grade or weight wrong at minting</option>
          <option value="QUALITY_DEGRADATION">QUALITY_DEGRADATION · crop worsened in storage</option>
          <option value="OTHER">OTHER</option>
        </select>
      </Field>
      <Field label="Claim">
        <textarea className="input" value={claim} onChange={(e) => setClaim(e.target.value)} />
      </Field>
      <EvidenceInput label="Evidence" value={evidence} onChange={setEvidence} />
      <Callout tone="warning">
        {closed && type === 'MINT_ACCURACY' ? 'Challenge window closed. Evidence is required. ' : ''}Submitting freezes the receipt and pauses the loan clock until the regulator rules.
      </Callout>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Assign re-inspection (Regulator)

export function AssignReinspectionModal({ open, onClose, dispute, excluded, warehouseId }: ModalProps & { dispute: Dispute; excluded: string[]; warehouseId: string }) {
  const tx = useTx();
  const inspectors = useInspectors();
  const pool = (inspectors.data ?? []).map((i) => {
    const reason = i.status !== 'ACTIVE' ? i.status.toLowerCase() : excluded.includes(i.id) ? 'original reading' : i.conflictWarehouseIds.includes(warehouseId) ? `conflict with ${warehouseId}` : null;
    return { ...i, reason };
  });
  const eligible = pool.filter((p) => !p.reason).length;
  async function submit() {
    const r = await tx.run(() => api.post<{ draw: { inspectorId: string } }>(`/disputes/${dispute.id}/assign`), (x) => `${x.draw.inspectorId} drawn.`);
    if (r) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Assign re-inspection"
      subtitle={`${dispute.id} · ${dispute.subject.id} · ${dispute.type}`}
      error={tx.error}
      hint={<Signs fn="DisputeContract:AssignReinspection" />}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabledReason={eligible === 0 && 'No eligible inspector'} disabled={tx.pending}>
            Draw and assign
          </Button>
        </>
      }
    >
      <div className="eyebrow">Draw pool</div>
      <div className="flex flex-col">
        {pool.map((p) => (
          <div key={p.id} className="flex justify-between border-b border-line-soft py-2 text-[13px] last:border-b-0">
            <span className={`font-mono ${p.reason ? 'text-muted line-through' : ''}`}>
              {p.id} · {p.name}
            </span>
            <span className="hint">{p.reason ?? 'eligible'}</span>
          </div>
        ))}
      </div>
      <span className="hint">
        The chaincode picks <Mono>sha256(txId) mod {eligible}</Mono>. You confirm the draw; you do not choose the person.
      </span>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Record WRRB number (Regulator)

export function RecordWrrbModal({ open, onClose, receipt, attestedBy }: ModalProps & { receipt: WarehouseReceipt; attestedBy?: string | undefined }) {
  const tx = useTx();
  const [no, setNo] = useState(`WRRB/${receipt.warehouseId === 'WH-002' ? 'MOR' : 'DOD'}/2026/`);
  async function submit() {
    if (await tx.run(() => api.post(`/receipts/${receipt.id}/wrrb`, { wrrbReceiptNo: no }), () => `${receipt.id} is WRRB_REGISTERED and can be pledged.`)) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record WRRB number"
      subtitle={`${receipt.id} · ${commodity(receipt.commodity)} ${receipt.grade} · ${kg(receipt.netKg)}`}
      error={tx.error}
      hint={<Signs fn="ReceiptContract:RecordWrrbRegistration" />}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={no.length < 6 || tx.pending}>
            Register
          </Button>
        </>
      }
    >
      <Field label="WRRB receipt no.">
        <input className="input font-mono" value={no} onChange={(e) => setNo(e.target.value)} />
      </Field>
      <KV
        rows={[
          ['Warehouse', <Mono key="w">{receipt.warehouseId}</Mono>],
          ['Attested by', <Mono key="a">{attestedBy ?? '—'}</Mono>],
          ['Becomes', <Mono key="b">WRRB_REGISTERED</Mono>],
        ]}
      />
      <span className="hint">After this the receipt can be pledged. The number must match the WRRB register.</span>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Execute liquidation (Lender)

export function LiquidateModal({ open, onClose, loan, escrow }: ModalProps & { loan: Loan; escrow: Escrow | null }) {
  const tx = useTx();
  const [proceeds, setProceeds] = useState('');
  const [buyer, setBuyer] = useState('');
  const p = parseWhole(proceeds);
  const owed = loan.totalDueTzs - loan.repaidTzs;
  const toLender = p === null ? 0 : Math.min(p, owed);
  const surplus = p === null ? 0 : p - toLender;
  const held = escrow?.balanceTzs ?? 0;
  async function submit() {
    if (await tx.run(() => api.post(`/loans/${loan.id}/liquidate`, { saleProceedsTzs: p, buyerRef: buyer }), () => 'Loan and receipt LIQUIDATED.')) onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Execute liquidation"
      subtitle={`${loan.id} · DEFAULTED · ${loan.receiptId}`}
      error={tx.error}
      hint={<span className="hint">Irreversible. Receipt and loan both become LIQUIDATED.</span>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={p === null || !buyer || tx.pending}>
            Liquidate
          </Button>
        </>
      }
    >
      <Grid2>
        <Field label="Sale proceeds (TZS)">
          <input className="input font-mono" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
        </Field>
        <Field label="Buyer ref">
          <input className="input font-mono" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
        </Field>
      </Grid2>
      <div className="eyebrow">Escrow waterfall</div>
      {p !== null && p > 0 && (
        <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`${tzs(toLender)} to lender, ${tzs(surplus)} surplus to farmer`}>
          <div className="bg-steel" style={{ width: `${(toLender / p) * 100}%` }} />
          <div className="bg-cyan" style={{ width: `${(surplus / p) * 100}%` }} />
        </div>
      )}
      <KV
        rows={[
          ['1 · Lender (owed)', <Mono key="a">{tzs(toLender)}</Mono>],
          ['2 · Farmer surplus', <Mono key="b">{tzs(surplus)}</Mono>],
          ['Held repayments', <Mono key="c">{tzs(held)} → lender</Mono>],
          ['Shortfall', <Mono key="d">{tzs(Math.max(0, owed - toLender))}</Mono>],
        ]}
      />
    </Dialog>
  );
}

export { bpToInput };
