/** Screen 21: network overview. Peer-health strip; yellow tile counts rejected tx this week. */
import { Link } from 'react-router-dom';
import { ActivityFeed } from '../../components/ledger';
import { Button, EmptyState, LinkButton, PageHeader, Section, StatTile, StatusChip, Tiles } from '../../components/ui';
import { api } from '../../lib/api';
import { useStreamLive } from '../../lib/events';
import { feedTime, tzsShort } from '../../lib/format';
import { useDisputes, useExplorerTxs, useFarmers, useInspectors, useKeeper, useLenders, useLoanViews, useNetwork, useReceipts, useRecentEvents, useWarehouses } from '../../lib/queries';
import { useToast } from '../../lib/tx';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export function RegulatorOverview() {
  const net = useNetwork();
  const rejected = useExplorerTxs('rejected', 200);
  const receipts = useReceipts({ status: 'ISSUED,PLEDGED,UNDER_DISPUTE,DEFAULTED' });
  const loans = useLoanViews({ status: 'ACTIVE,MARGIN_CALL' });
  const disputes = useDisputes({ status: 'OPEN,REINSPECTION_ASSIGNED,REINSPECTED' });
  const warehouses = useWarehouses();
  const lenders = useLenders();
  const inspectors = useInspectors();
  const farmers = useFarmers();
  const events = useRecentEvents();
  const keeper = useKeeper();
  const { live } = useStreamLive();
  const toast = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  async function runKeeper() {
    setRunning(true);
    try {
      const r = await api.post<never>('/keeper/run') as unknown as { checked: number; submitted: unknown[]; errors: { message: string }[] };
      toast({ kind: 'ok', title: 'Keeper pass finished.', detail: `${r.checked} open loans checked, ${r.submitted.length} changed${r.errors.length ? `, ${r.errors.length} errors` : ''}.` });
      await qc.invalidateQueries();
    } catch (e) {
      toast({ kind: 'error', title: 'KEEPER', detail: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }
  const week = Date.now() - 7 * 86_400_000;
  const rejectedWeek = (rejected.data?.txs ?? []).filter((t) => new Date(t.timestamp).getTime() > week);
  const live_ = receipts.data ?? [];
  const pledged = live_.filter((r) => r.status === 'PLEDGED');
  const pledgedValue = (loans.data ?? []).reduce((s, v) => s + (v.collateralTzs ?? 0), 0);
  const pendingWrrb = live_.filter((r) => r.legal.status === 'PENDING_WRRB');
  const ready = (disputes.data ?? []).filter((d) => d.status === 'REINSPECTED');
  const peers: [string, string][] = [
    ['WarehouseMSP', 'peer0.warehouse'],
    ['LenderMSP', 'peer0.lender'],
    ['InspectorMSP', 'peer0.inspector'],
    ['RegulatorMSP', 'peer0.regulator'],
  ];
  return (
    <>
      <PageHeader
        eyebrow="Regulator · WRRB role"
        title="Network overview"
        actions={
          <Button variant="secondary" onClick={() => void runKeeper()} disabled={running}>
            {running ? 'Running…' : 'Run keeper now'}
          </Button>
        }
      />
      <section aria-label="Peer health" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {peers.map(([msp, name]) => {
          const up = net.data?.peers[msp];
          return (
            <div key={msp} className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4">
              <span className="eyebrow">{name}</span>
              <span className="font-mono text-[20px] font-semibold">
                <span className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${up === false ? 'bg-danger' : 'bg-cyan'}`} />
                {up === false ? 'down' : (net.data?.height ?? 0).toLocaleString('en-US')}
              </span>
              <span className="font-mono text-[12px] text-muted">{up === false ? 'unreachable' : 'block height'}</span>
            </div>
          );
        })}
        <Link to="/regulator/explorer" className="flex flex-col gap-1.5 rounded-card border border-yellow bg-yellow p-4 text-ink no-underline">
          <span className="eyebrow text-ink">Rejected this week</span>
          <span className="font-mono text-[20px] font-semibold">{rejectedWeek.length}</span>
          <span className="font-mono text-[12px]">{rejectedWeek[0]?.validationCode.toLowerCase().replace(/_/g, ' ') ?? 'none'} →</span>
        </Link>
      </section>
      <Tiles>
        <StatTile label="Receipts live" value={live_.length} sub={`${new Set(live_.map((r) => r.warehouseId)).size} warehouses`} />
        <StatTile label="Pledged value" value={tzsShort(pledgedValue)} sub={`TZS · ${pledged.length} receipts`} />
        <StatTile label="Active loans" value={loans.data?.length ?? '…'} sub={`${new Set((loans.data ?? []).map((v) => v.loan.lenderId)).size} lenders`} />
        <StatTile label="Open disputes" value={disputes.data?.length ?? '…'} sub={`${ready.length} ready to rule`} to="/regulator/disputes" variant={ready.length ? 'attention' : undefined} />
        <StatTile label="Pending WRRB" value={pendingWrrb.length} sub="registration queue" to="/regulator/wrrb" />
      </Tiles>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Section title="Arbitration queue" pad={false}>
            {(disputes.data ?? []).length === 0 && <p className="m-0 p-4 text-[13px] text-muted">No open disputes.</p>}
            {(disputes.data ?? []).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3 text-[13px] last:border-b-0">
                <span>
                  <b className="font-mono">{d.id}</b> · {d.type} · {d.subject.id}
                  <br />
                  <span className="text-muted">
                    {d.status === 'REINSPECTED' ? 'Re-inspected. Ready for your ruling.' : d.status === 'OPEN' ? 'Needs a re-inspector.' : `Re-inspection with ${d.reinspection?.inspectorId}.`}
                  </span>
                </span>
                {d.status === 'REINSPECTED' ? <LinkButton to={`/disputes/${d.id}`} size="sm">Rule</LinkButton> : d.status === 'OPEN' ? <LinkButton to={`/disputes/${d.id}`} size="sm">Assign</LinkButton> : <StatusChip domain="dispute" status={d.status} label="Waiting" />}
              </div>
            ))}
          </Section>
          <Section title="Registry" pad={false}>
            {[
              ['Warehouses', `${(warehouses.data ?? []).filter((w) => w.status === 'ACTIVE').length} active · ${(warehouses.data ?? []).filter((w) => w.status !== 'ACTIVE').length} suspended`],
              ['Lenders', `${(lenders.data ?? []).filter((l) => l.type === 'BANK').length} bank · ${(lenders.data ?? []).filter((l) => l.type !== 'BANK').length} hosted (MFI/SACCO)`],
              ['Inspectors', `${(inspectors.data ?? []).filter((i) => i.status === 'ACTIVE').length} accredited`],
              ['Farmers', `${farmers.data?.length ?? 0} registered`],
            ].map(([k, v]) => (
              <Link key={k} to="/regulator/registry" className="flex justify-between border-b border-line-soft px-4 py-3 text-[13px] text-ink no-underline last:border-b-0 hover:bg-surface-2">
                {k}
                <span className="font-mono text-muted">{v}</span>
              </Link>
            ))}
          </Section>
          <Section title="Keeper" aside={<span className="font-mono">{keeper.data?.identity}</span>}>
            {keeper.data ? (
              <p className="m-0 text-[13px] text-muted">
                {keeper.data.enabled ? `Runs every ${Math.round(keeper.data.intervalMs / 1000)} s` : 'Disabled (KEEPER_ENABLED=false)'}.{' '}
                {keeper.data.lastRun
                  ? `Last pass ${feedTime(keeper.data.lastRun.at)}: ${keeper.data.lastRun.checked} open loans checked, ${keeper.data.lastRun.submitted.length} changed.`
                  : 'No pass yet.'}{' '}
                Evaluates first on one peer and submits only when a rule fires, so quiet passes write nothing.
              </p>
            ) : (
              <EmptyState title="Keeper status unavailable" />
            )}
          </Section>
        </div>
        <ActivityFeed events={events.data ?? []} live={live} limit={14} showOrg />
      </div>
    </>
  );
}
