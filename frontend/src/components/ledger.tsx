/** Ledger-specific components (handoff §3): LtvGauge, ConditionChecklist, LifecycleStrip, LedgerHistory, EndorsementBadges, EscrowLedger, ActivityFeed. */
import type { ConditionResult, Escrow } from '@wrt/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { bpPct, dateTime, feedTime, orgShort, shortHash, signedTzs, tzs } from '../lib/format';
import { ESCROW_OUTFLOWS } from '../lib/status';
import type { HistoryRow, StreamEvent } from '../lib/types';
import { Chip, StatusChip, cx } from './ui';

// ------------------------------------------------------------------ LtvGauge

/** Bar with markers at maxLtvBp (steel), marginCallLtvBp (ink) and liquidationLtvBp (red), read from PolicyParams. */
export function LtvGauge({
  ltvBp,
  policy,
  projectedBp,
  compact,
}: {
  ltvBp: number | null;
  policy: { maxLtvBp: number; marginCallLtvBp: number; liquidationLtvBp: number };
  projectedBp?: number | null;
  compact?: boolean;
}) {
  const scale = 10_000;
  const pos = (bp: number) => `${Math.min(100, (bp / scale) * 100)}%`;
  const fill = ltvBp === null ? 0 : ltvBp;
  const tone = ltvBp === null ? 'bg-neutral-dot' : ltvBp >= policy.liquidationLtvBp ? 'bg-danger' : ltvBp >= policy.marginCallLtvBp ? 'bg-yellow' : 'bg-cyan';
  const markers: [number, string, string][] = [
    [policy.maxLtvBp, 'bg-steel', 'max'],
    [policy.marginCallLtvBp, 'bg-ink', 'margin'],
    [policy.liquidationLtvBp, 'bg-danger', 'default'],
  ];
  return (
    <div className="flex flex-col gap-1.5" role="img" aria-label={`LTV ${bpPct(ltvBp)}; max ${bpPct(policy.maxLtvBp, 0)}, margin call ${bpPct(policy.marginCallLtvBp, 0)}, default ${bpPct(policy.liquidationLtvBp, 0)}`}>
      <div className={cx('relative w-full rounded-full bg-line-soft', compact ? 'h-2' : 'h-3')}>
        {projectedBp !== undefined && projectedBp !== null && projectedBp > fill && (
          <div
            className="absolute inset-y-0 rounded-full"
            style={{ left: pos(fill), width: `calc(${pos(projectedBp)} - ${pos(fill)})`, background: 'repeating-linear-gradient(135deg,#FBD116 0 4px,#FEF6CC 4px 8px)' }}
          />
        )}
        <div className={cx('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: pos(fill) }} />
        {markers.map(([bp, color]) => (
          <div key={bp} className={cx('absolute -top-1 w-[2px]', color, compact ? 'h-4' : 'h-5')} style={{ left: pos(bp) }} />
        ))}
      </div>
      {!compact && (
        <>
          <div className="relative h-4 font-mono text-[11px] text-muted">
            {markers.map(([bp]) => (
              <span key={bp} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pos(bp) }}>
                {bpPct(bp, 0, '')}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
            {markers.map(([bp, color, label]) => (
              <span key={bp} className="flex items-center gap-1.5">
                <span className={cx('inline-block h-2.5 w-[2px]', color)} />
                {label} {bpPct(bp, 0)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ConditionChecklist

const CONDITION_LABEL: Record<string, string> = {
  ESCROW_COVERS_PRINCIPAL: 'Escrow balance ≥ principal',
  LIEN_ON_THIS_LOAN: 'Receipt pledged, lien on this loan',
  WRRB_REGISTERED_NOT_EXPIRED: 'WRRB registered and not expired',
  ATTESTATION_FRESH: 'Attestation or quality check is fresh',
  WAREHOUSE_ACTIVE: 'Warehouse active',
  NO_OPEN_DISPUTE: 'No open dispute on receipt',
};

export function CheckRow({ state, children, evidence }: { state: 'pass' | 'warn' | 'fail'; children: ReactNode; evidence?: ReactNode }) {
  const icon = {
    pass: <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-tint-green font-bold text-success">✓</span>,
    warn: <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-tint-yellow font-bold text-ink">!</span>,
    fail: <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-tint-red font-bold text-danger">✕</span>,
  }[state];
  return (
    <div className="flex items-center gap-3 border-b border-line-soft py-2 text-[13px] last:border-b-0">
      {icon}
      <span className="sr-only">{state === 'pass' ? 'passed' : state === 'warn' ? 'warning' : 'failed'}:</span>
      <span className="flex-1">{children}</span>
      {evidence && <span className="font-mono text-[12px] text-muted">{evidence}</span>}
    </div>
  );
}

export function ConditionChecklist({ conditions }: { conditions: ConditionResult[] }) {
  if (conditions.length === 0) return <p className="m-0 text-[13px] text-muted">Not evaluated yet. Conditions are checked when the lender funds the escrow.</p>;
  return (
    <div>
      {conditions.map((c) => (
        <CheckRow key={c.condition} state={c.passed ? 'pass' : 'fail'} evidence={c.evidence.replace(/\d{5,}/g, (n) => Number(n).toLocaleString('en-US'))}>
          {CONDITION_LABEL[c.condition] ?? c.condition}
        </CheckRow>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ LifecycleStrip

export function LifecycleStrip({ steps, branches }: { steps: { label: string; title: string; meta?: string; current?: boolean; future?: boolean }[]; branches?: { title: string; meta: string } }) {
  return (
    <div className="card flex flex-wrap overflow-hidden" aria-label="Lifecycle">
      {steps.map((s, i) => (
        <div
          key={i}
          aria-current={s.current ? 'step' : undefined}
          className={cx(
            'flex min-w-[120px] flex-1 flex-col gap-1.5 border-r border-line px-[14px] py-3 text-[12px]',
            s.current && 'bg-ink text-white',
            s.future && 'text-muted',
          )}
        >
          <span className={cx('eyebrow', s.current && 'text-yellow')}>{s.label}</span>
          <b className="text-[13px]">{s.title}</b>
          {s.meta && <span className={cx('font-mono', s.current ? 'text-muted-dark-2' : 'text-muted')}>{s.meta}</span>}
        </div>
      ))}
      {branches && (
        <div className="flex min-w-[120px] flex-1 flex-col gap-1.5 bg-surface-2 px-[14px] py-3 text-[12px] text-muted">
          <span className="eyebrow">Branches</span>
          <b className="text-[13px]">{branches.title}</b>
          <span className="font-mono">{branches.meta}</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ EndorsementBadges

const ORGS = ['WarehouseMSP', 'LenderMSP', 'InspectorMSP', 'RegulatorMSP'];

/** Four 28×22 mono badges: filled ink if that org endorsed, outlined grey if not. */
export function EndorsementBadges({ endorsers }: { endorsers: string[] }) {
  return (
    <span className="inline-flex gap-1" aria-label={`Endorsed by ${endorsers.join(', ') || 'nobody'}`}>
      {ORGS.map((o) => {
        const on = endorsers.includes(o);
        return (
          <span
            key={o}
            className={cx(
              'grid h-[22px] w-[28px] place-items-center rounded-chip border font-mono text-[11px] font-semibold',
              on ? 'border-ink bg-ink text-white' : 'border-line text-neutral-dot',
            )}
          >
            {orgShort[o]}
          </span>
        );
      })}
    </span>
  );
}

// ------------------------------------------------------------------ LedgerHistory

function describeChange(prev: Record<string, unknown> | null, next: Record<string, unknown> | null): string {
  if (!next) return 'deleted';
  if (!prev) return 'created';
  const out: string[] = [];
  for (const k of ['status', 'grade', 'netKg', 'moistureBp', 'repaidTzs', 'balanceTzs']) {
    if (prev[k] !== next[k] && next[k] !== undefined) out.push(`${k} ${String(prev[k] ?? '—')} → ${String(next[k])}`);
  }
  const pl = (prev.legal as { status?: string } | undefined)?.status;
  const nl = (next.legal as { status?: string } | undefined)?.status;
  if (pl !== nl && nl) out.push(`legal → ${nl}`);
  if (!prev.lien && next.lien) out.push(`lien ${(next.lien as { loanId: string }).loanId}`);
  if (prev.lien && !next.lien) out.push('lien lifted');
  const pq = prev.pendingQualityCheck as { assignedInspectorId?: string } | undefined;
  const nq = next.pendingQualityCheck as { assignedInspectorId?: string; reason?: string } | undefined;
  if (!pq && nq) out.push(`quality check requested → ${nq.assignedInspectorId} (${String(nq.reason ?? '').toLowerCase().replace('_', ' ')})`);
  if (!prev.withdrawalRequestedAt && next.withdrawalRequestedAt) out.push('withdrawal requested');
  if (!prev.pause && next.pause) out.push(`clock paused by ${(next.pause as { disputeId: string }).disputeId}`);
  if (prev.pause && !next.pause) out.push('clock resumed');
  if (!prev.reinspection && next.reinspection) out.push(`re-inspector ${(next.reinspection as { inspectorId: string }).inspectorId}`);
  return out.join(' · ') || 'updated';
}

/** Every committed version (GetHistory), newest first, with function, invoker, change, tx and endorsing orgs. */
export function LedgerHistory({ rows, keyLabel }: { rows: HistoryRow<object>[]; keyLabel?: string }) {
  if (rows.length === 0) return <p className="m-0 text-[13px] text-muted">No committed versions.</p>;
  return (
    <ol className="m-0 flex list-none flex-col gap-0 p-0">
      {rows.map((r, i) => {
        const prev = rows[i + 1]?.value ?? null;
        const latest = i === 0;
        return (
          <li key={r.txId + i} className="flex gap-3 border-b border-line-soft py-3 last:border-b-0">
            <span className={cx('h-fit rounded-chip px-1.5 py-0.5 font-mono text-[12px] font-semibold', latest ? 'bg-ink text-yellow' : 'bg-tint-neutral text-ink')}>
              v{r.version ?? rows.length - i}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 text-[13px]">
              <b className="font-mono text-[13px]">{(r.fn ?? '?').split(':').pop()}</b>
              <span className="text-muted">
                {r.creator ? `${r.creator.mspId} · ${r.creator.entityId ?? r.creator.name}` : 'unknown invoker'} · {describeChange(prev as Record<string, unknown> | null, r.value as Record<string, unknown> | null)}
              </span>
              <span className="font-mono text-[12px] text-muted">
                {feedTime(r.timestamp)} · tx {shortHash(r.txId)} · endorsed {r.endorsers.map((e) => orgShort[e] ?? e).join(' ')}
                {r.blockNumber !== null && ` · block ${r.blockNumber}`}
              </span>
            </div>
          </li>
        );
      })}
      {keyLabel && <li className="pt-2 font-mono text-[11px] text-muted">{keyLabel}</li>}
    </ol>
  );
}

// ------------------------------------------------------------------ EscrowLedger

export function EscrowLedger({ escrow, releaseAt }: { escrow: Escrow | null; releaseAt?: number }) {
  if (!escrow) return <p className="m-0 p-4 text-[13px] text-muted">The escrow opens when the farmer accepts the offer.</p>;
  const entries = [...escrow.entries].reverse();
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <span className="text-[13px] text-muted">
          Balance held <b className="font-mono text-ink">{tzs(escrow.balanceTzs)} TZS</b>
          {releaseAt !== undefined && ` · releases to lender at ${tzs(releaseAt)}`}
        </span>
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Entry</th>
              <th className="r">Amount (TZS)</th>
              <th>Payment ref (simulated rail)</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
                  No entries yet.
                </td>
              </tr>
            )}
            {entries.map((e, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap font-mono">{feedTime(e.at)}</td>
                <td>
                  <StatusChip domain="escrow" status={e.type} />
                </td>
                <td className="r font-mono">{signedTzs(e.amountTzs, ESCROW_OUTFLOWS.has(e.type))}</td>
                <td className="whitespace-nowrap font-mono">{e.paymentRef}</td>
                <td className="whitespace-nowrap font-mono">
                  <Link to={`/regulator/explorer?q=${e.txId}`}>{shortHash(e.txId)}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ ActivityFeed

function describeEvent(e: StreamEvent): ReactNode {
  const p = e.payload as Record<string, string | number | undefined>;
  switch (e.name) {
    case 'ReceiptIssued':
      return <>receipt <b className="font-mono">{p.receiptId}</b> issued</>;
    case 'ReceiptStatusChanged':
      return <><span className="font-mono">{p.receiptId}</span> {p.from} → <b>{p.to}</b></>;
    case 'LoanStatusChanged':
      return <><span className="font-mono">{p.loanId}</span> {p.from} → <b>{p.to}</b></>;
    case 'DisputeOpened':
      return <><b className="font-mono">{p.disputeId}</b> opened · {String(p.type)}</>;
    case 'DisputeResolved':
      return <><b className="font-mono">{p.disputeId}</b> resolved · {String(p.outcome)}</>;
    case 'EscrowReleased':
      return <><span className="font-mono">{p.loanId}</span> {String(p.type)} · <span className="font-mono">{tzs(Number(p.amountTzs))}</span></>;
    case 'MarginCall':
      return <><b className="font-mono">{p.loanId}</b> margin call at {bpPct(Number(p.ltvBp))}</>;
    case 'LienReleased':
      return <>lien released on <span className="font-mono">{p.receiptId}</span></>;
    default:
      return e.name;
  }
}

export function ActivityFeed({ events, live, limit = 8, showOrg }: { events: StreamEvent[]; live: boolean; limit?: number; showOrg?: boolean }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="section-title">Live activity</h2>
        <span className="font-mono text-[12px] text-muted">
          <span className={cx('mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle', live ? 'bg-cyan' : 'bg-neutral-dot')} />
          {live ? 'streaming' : 'reconnecting'}
        </span>
      </div>
      <div className="flex flex-col px-4 py-1">
        {events.length === 0 && <p className="text-[13px] text-muted">No events yet. Chaincode events appear here as transactions commit.</p>}
        {events.slice(0, limit).map((e) => (
          <div key={e.id} className="flex gap-3 border-b border-line-soft py-2 text-[13px] last:border-b-0">
            <span className="w-[86px] flex-none font-mono text-[12px] text-muted">{feedTime(e.receivedAt)}</span>
            {showOrg && <span className="w-[96px] flex-none font-mono text-[12px] text-muted">{e.org ?? ''}</span>}
            <span className="min-w-0">
              <b>{e.name}</b> · {describeEvent(e)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RejectedChip() {
  return <Chip tone="red">Rejected · not committed</Chip>;
}

export { dateTime };
