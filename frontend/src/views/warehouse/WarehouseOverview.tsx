/** Screen 06: warehouse overview. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ActivityFeed } from '../../components/ledger';
import { Button, Chip, LinkButton, PageHeader, Section, StatTile, StatusChip, TagChip, Tiles } from '../../components/ui';
import { useCustody } from '../../lib/derive';
import { useStreamLive } from '../../lib/events';
import { bpPct, commodity, date, kg } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useDeposits, useDisputes, useRecentEvents } from '../../lib/queries';
import type { StreamEvent } from '../../lib/types';
import { RegisterFarmerModal } from '../../modals/Modals';

const COLORS = ['bg-cyan', 'bg-steel', 'bg-yellow', 'bg-ink'];

export function WarehouseOverview() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const wh = me?.entity as { name?: string; region?: string; status?: string; penaltyCount?: number; bondRef?: string; capacityKg?: number } | null;
  const custody = useCustody(id);
  const pending = useDeposits({ warehouseId: id, status: 'PENDING_ATTESTATION' }, !!id);
  const mismatched = useDeposits({ warehouseId: id, status: 'MISMATCH_DISPUTED' }, !!id);
  const disputes = useDisputes({ status: 'OPEN,REINSPECTION_ASSIGNED,REINSPECTED' });
  const events = useRecentEvents();
  const { live } = useStreamLive();
  const [registerOpen, setRegisterOpen] = useState(false);

  const receipts = custody.data ?? [];
  const pledged = receipts.filter((r) => r.status === 'PLEDGED').length;
  const myDisputes = (disputes.data ?? []).filter(
    (d) => receipts.some((r) => r.id === d.subject.id) || (mismatched.data ?? []).some((m) => m.id === d.subject.id),
  );
  const withdrawals = receipts.filter((r) => r.status === 'ISSUED' && r.withdrawalRequestedAt);
  const storedKg = receipts.reduce((s, r) => s + r.netKg, 0);
  const byCommodity = Object.entries(
    receipts.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.commodity]: (acc[r.commodity] ?? 0) + r.netKg }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const capacity = wh?.capacityKg ?? 0;
  const utilBp = capacity ? Math.floor((storedKg * 10_000) / capacity) : 0;
  const oldest = (pending.data ?? []).map((d) => d.createdAt).sort()[0];
  const mine = (events.data ?? []).filter((e: StreamEvent) => JSON.stringify(e.payload).includes(id ?? '#') || receipts.some((r) => JSON.stringify(e.payload).includes(r.id)));

  return (
    <>
      <PageHeader
        chips={
          <>
            <StatusChip domain="entity" status={wh?.status ?? 'ACTIVE'} label={wh?.status === 'ACTIVE' ? 'Licence active' : wh?.status} />
            <TagChip>penalties {wh?.penaltyCount ?? 0}</TagChip>
            <TagChip>bond {wh?.bondRef}</TagChip>
          </>
        }
        title={wh?.name ?? id ?? ''}
        sub={`${wh?.region ?? ''} region · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRegisterOpen(true)}>
              Register farmer
            </Button>
            <LinkButton to="/warehouse/deposits/new" variant="accent">
              Record deposit
            </LinkButton>
          </>
        }
      />
      {wh?.status === 'SUSPENDED' && (
        <div role="alert" className="rounded-card border border-tint-red-line bg-tint-red px-4 py-3 text-[13px]">
          <b>Warehouse suspended.</b> The regulator suspended this warehouse (penalty count {wh.penaltyCount}). New deposits and farmer registrations are rejected by the chaincode.
        </div>
      )}
      <Tiles>
        <StatTile label="Receipts in custody" value={receipts.length} sub={`${pledged} pledged · ${receipts.length - pledged} free`} to="/warehouse/receipts" />
        <StatTile label="Awaiting attestation" value={pending.data?.length ?? '…'} sub={oldest ? `oldest ${date(oldest)}` : 'none waiting'} to="/warehouse/deposits" />
        <StatTile label="Open disputes" value={myDisputes.length} sub={`${myDisputes.filter((d) => d.type === 'MINT_MISMATCH').length} mismatch at minting`} variant={myDisputes.length ? 'attention' : undefined} />
        <StatTile label="Withdrawals to confirm" value={withdrawals.length} sub="physical release pending" to="/warehouse/withdrawals" />
      </Tiles>
      <Section title="Storage utilisation" aside={<span className="font-mono">{storedKg.toLocaleString('en-US')} / {capacity.toLocaleString('en-US')} kg · {bpPct(utilBp)}</span>}>
        <div className="flex h-3 overflow-hidden rounded-full bg-line-soft" role="img" aria-label={byCommodity.map(([c, k]) => `${commodity(c)} ${kg(k)}`).join(', ') || 'empty'}>
          {byCommodity.map(([c, k], i) => (
            <div key={c} className={COLORS[i % COLORS.length]} style={{ width: `${capacity ? (k / capacity) * 100 : 0}%` }} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          {byCommodity.map(([c, k], i) => (
            <span key={c} className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-sm ${COLORS[i % COLORS.length]}`} />
              {commodity(c)} <span className="font-mono">{k.toLocaleString('en-US')}</span>
            </span>
          ))}
          {byCommodity.length === 0 && <span className="text-muted">No stock in custody.</span>}
        </div>
      </Section>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Needs your attention" pad={false}>
          <div className="flex flex-col">
            {myDisputes.map((d) => (
              <Link key={d.id} to={`/disputes/${d.id}`} className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3 text-ink no-underline last:border-b-0 hover:bg-surface-2">
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip tone={d.type === 'MINT_MISMATCH' ? 'red' : 'yellow'}>{d.type === 'MINT_MISMATCH' ? 'Mismatch' : 'Dispute'}</Chip>
                    <b>
                      {d.type.replace(/_/g, ' ').toLowerCase()} on {d.subject.id}
                    </b>
                  </span>
                  <span className="text-[12px] text-muted">
                    {d.id} · {d.status.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </span>
                <span className="font-mono text-[12px] text-link">view →</span>
              </Link>
            ))}
            {withdrawals.map((r) => (
              <Link key={r.id} to="/warehouse/withdrawals" className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3 text-ink no-underline last:border-b-0 hover:bg-surface-2">
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip tone="cyan">Withdrawal</Chip>
                    <b>
                      Release {kg(r.netKg)} {commodity(r.commodity).toLowerCase()} to {r.holderFarmerId}
                    </b>
                  </span>
                  <span className="text-[12px] text-muted">
                    {r.id} · no lien · requested {date(r.withdrawalRequestedAt)}
                  </span>
                </span>
                <span className="font-mono text-[12px] text-link">confirm →</span>
              </Link>
            ))}
            {(pending.data?.length ?? 0) > 0 && (
              <Link to="/warehouse/deposits" className="flex items-center justify-between gap-3 px-4 py-3 text-ink no-underline hover:bg-surface-2">
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip>Pending</Chip>
                    <b>{pending.data!.length} deposits waiting for inspectors</b>
                  </span>
                  <span className="text-[12px] text-muted">
                    {Object.entries(pending.data!.reduce<Record<string, number>>((a, d) => ({ ...a, [d.assignedInspectorId]: (a[d.assignedInspectorId] ?? 0) + 1 }), {}))
                      .map(([i, n]) => `${i} × ${n}`)
                      .join(', ')}{' '}
                    · assigned by tx-hash draw
                  </span>
                </span>
                <span className="font-mono text-[12px] text-link">view →</span>
              </Link>
            )}
            {myDisputes.length + withdrawals.length + (pending.data?.length ?? 0) === 0 && <p className="m-0 px-4 py-4 text-[13px] text-muted">Nothing needs you right now.</p>}
          </div>
        </Section>
        <ActivityFeed events={mine.length ? mine : events.data ?? []} live={live} />
      </div>
      <RegisterFarmerModal open={registerOpen} onClose={() => setRegisterOpen(false)} />
    </>
  );
}
