/** AppShell, LedgerStrip, IdentityBar, SideNav (handoff §3). */
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useEligibleCollateral, useInspectorQueue, queueSize, useCustody } from '../lib/derive';
import { useIdentity } from '../lib/identity';
import { useDeposits, useDisputes, useFarmerPII, useFarmers, useLoans, useNetwork, useReceipts } from '../lib/queries';
import { cx } from './ui';

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="grid flex-none place-items-center rounded-[5px] bg-yellow" style={{ width: size, height: size }} aria-hidden="true">
      <span className="rounded-[2px] border-2 border-ink" style={{ width: size * 0.38, height: size * 0.46 }} />
    </span>
  );
}

export function LedgerStrip() {
  const net = useNetwork();
  const peers = net.data?.peers ?? {};
  return (
    <div className="relative flex flex-wrap gap-x-[18px] gap-y-1.5 font-mono text-[12px] text-muted-dark" aria-label="Ledger status">
      <span>{net.data?.channel ?? 'wrt-channel'}</span>
      <span>block {net.data ? net.data.height.toLocaleString('en-US') : '…'}</span>
      <span>policy {net.data?.policy ?? '3 of 4'}</span>
      <span className="flex items-center gap-1.5">
        {(['WarehouseMSP', 'LenderMSP', 'InspectorMSP', 'RegulatorMSP'] as const).map((m, i) => {
          const up = peers[m];
          return (
            <span key={m} className="flex items-center" title={`peer0.${m.replace('MSP', '').toLowerCase()} ${up === false ? 'unreachable' : 'up'}`}>
              <span className={cx('mr-1 inline-block h-1.5 w-1.5 rounded-full', up === false ? 'bg-neutral-dot' : 'bg-cyan', i > 0 && 'ml-1')} />
              {['WH', 'LN', 'IN', 'RG'][i]}
              <span className="sr-only">{up === false ? ' unreachable' : ' up'}</span>
            </span>
          );
        })}
      </span>
    </div>
  );
}

export function IdentityBar() {
  const { me, label } = useIdentity();
  const v = me?.chaincodeView;
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[13px]">
      <span className="rounded-chip border border-ink-chip-line px-2 py-[3px] font-mono text-[12px] text-cyan">{v?.mspId ?? me?.identity.mspId ?? '…'}</span>
      <span className="text-muted-dark-2">{v?.role ?? (label ? '…' : 'no identity')}</span>
      {v?.entityId && <span className="font-mono text-[12px]">{v.entityId}</span>}
      <Link to="/" className="font-semibold text-yellow hover:text-white">
        Switch identity
      </Link>
    </div>
  );
}

interface NavItem {
  to: string;
  label: string;
  count?: number | string | undefined;
  end?: boolean;
}

function SideNav({ title, items, footer }: { title: string; items: NavItem[]; footer: ReactNode }) {
  return (
    <nav aria-label={title} className="box-border flex flex-[1_1_220px] flex-col gap-0.5 bg-ink px-3 py-4">
      <div className="eyebrow px-3 pb-2.5 pt-2 text-muted-dark-3">{title}</div>
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end ?? true}
          className={({ isActive }) =>
            cx(
              'flex min-h-[40px] items-center justify-between gap-2 rounded-chip px-3 text-[14px] font-medium no-underline',
              isActive ? 'bg-ink-2-active text-white shadow-[inset_3px_0_0_#FBD116]' : 'text-muted-dark-2 hover:bg-ink-2 hover:text-white',
            )
          }
        >
          {it.label}
          {it.count !== undefined && <span className="font-mono text-[11px] text-muted-dark-3">{it.count}</span>}
        </NavLink>
      ))}
      <div className="mt-auto px-3 pb-1 pt-4 text-[12px] leading-relaxed text-muted-dark-3">{footer}</div>
    </nav>
  );
}

function WarehouseNav() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const farmers = useFarmers(id);
  const pending = useDeposits({ warehouseId: id, status: 'PENDING_ATTESTATION' }, !!id);
  const custody = useCustody(id);
  const withdrawals = (custody.data ?? []).filter((r) => r.status === 'ISSUED' && r.withdrawalRequestedAt).length;
  return (
    <SideNav
      title="Warehouse"
      items={[
        { to: '/warehouse', label: 'Overview' },
        { to: '/warehouse/farmers', label: 'Farmers', count: farmers.data?.length },
        { to: '/warehouse/deposits/new', label: 'Record deposit' },
        { to: '/warehouse/deposits', label: 'Deposits', count: pending.data?.length },
        { to: '/warehouse/receipts', label: 'Receipts in custody', count: custody.data?.length },
        { to: '/warehouse/withdrawals', label: 'Withdrawals', count: withdrawals || undefined },
      ]}
      footer={
        <>
          {String(me?.entity?.name ?? '')}
          <br />
          <span className="font-mono">{String(me?.entity?.licenseNo ?? '')}</span>
        </>
      }
    />
  );
}

function FarmerNav() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const receipts = useReceipts({ holderFarmerId: id }, !!id);
  const offers = useLoans({ farmerId: id, status: 'OFFERED' }, !!id);
  const pii = useFarmerPII(id);
  return (
    <SideNav
      title="Farmer"
      items={[
        { to: '/farmer', label: 'My receipts', count: receipts.data?.length },
        { to: '/farmer/loans', label: 'Loans', count: offers.data?.length ? `${offers.data.length} offer${offers.data.length > 1 ? 's' : ''}` : undefined },
      ]}
      footer={
        <>
          {pii.data ? `${pii.data.fullName} · ${pii.data.villageOrWard}` : id}
          <br />
          <span className="font-mono">hosted by WarehouseMSP</span>
        </>
      }
    />
  );
}

function LenderNav() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const eligible = useEligibleCollateral();
  const loans = useLoans({ lenderId: id }, !!id);
  const disputes = useDisputes({ status: 'OPEN,REINSPECTION_ASSIGNED,REINSPECTED' });
  const mine = (disputes.data ?? []).filter((d) => d.raisedBy.entityId === id).length;
  const hosted = me?.hostingTier === 2;
  return (
    <SideNav
      title="Lender"
      items={[
        { to: '/lender', label: 'Portfolio' },
        { to: '/lender/collateral', label: 'Eligible collateral', count: eligible.data?.length },
        { to: '/lender/loans', label: 'My loans', count: loans.data?.length },
        { to: '/lender/disputes', label: 'Disputes raised', count: mine || undefined },
      ]}
      footer={
        <>
          {String(me?.entity?.name ?? id ?? '')}
          <br />
          <span className="font-mono">{hosted ? 'hosted identity · no peer' : 'via peer0.lender'}</span>
        </>
      }
    />
  );
}

function InspectorNav() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const queue = useInspectorQueue(id);
  return (
    <SideNav
      title="Inspector"
      items={[
        { to: '/inspector', label: 'Assignment queue', count: queueSize(queue.data) },
        { to: '/inspector/inspect', label: 'Inspection form', end: false },
        { to: '/inspector/history', label: 'Completed' },
      ]}
      footer={
        <>
          {String(me?.entity?.name ?? '')}
          <br />
          <span className="font-mono">{String(me?.entity?.accreditationNo ?? '')}</span>
        </>
      }
    />
  );
}

function RegulatorNav() {
  const wrrb = useReceipts({ legal_status: 'PENDING_WRRB', status: 'ISSUED,PLEDGED,UNDER_DISPUTE' });
  const disputes = useDisputes({ status: 'OPEN,REINSPECTION_ASSIGNED,REINSPECTED' });
  return (
    <SideNav
      title="Regulator"
      items={[
        { to: '/regulator', label: 'Network overview' },
        { to: '/regulator/registry', label: 'Entity registry' },
        { to: '/regulator/wrrb', label: 'WRRB queue', count: wrrb.data?.length || undefined },
        { to: '/regulator/disputes', label: 'Arbitration', count: disputes.data?.length || undefined },
        { to: '/regulator/settings', label: 'Prices & policy' },
        { to: '/regulator/explorer', label: 'Ledger explorer' },
      ]}
      footer={
        <>
          Regulator officer · REG-01
          <br />
          <span className="font-mono">peer0.regulator · full node</span>
        </>
      }
    />
  );
}

export function RoleNav() {
  const { me } = useIdentity();
  switch (me?.chaincodeView.role) {
    case 'warehouse_operator':
      return <WarehouseNav />;
    case 'farmer':
      return <FarmerNav />;
    case 'lender_officer':
      return <LenderNav />;
    case 'inspector':
      return <InspectorNav />;
    case 'regulator_officer':
      return <RegulatorNav />;
    default:
      return <SideNav title="WRT" items={[{ to: '/', label: 'Choose identity' }]} footer={null} />;
  }
}

/** Ink header above a row of sidebar + main; the row wraps so the sidebar stacks above content on phones. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 border-b border-ink-line bg-ink px-5 py-2.5 text-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
          <Link to="/" className="flex items-center gap-2.5 text-[17px] font-extrabold text-white no-underline hover:text-white">
            <Logo />
            WRT
          </Link>
          <LedgerStrip />
        </div>
        <IdentityBar />
      </header>
      <div className="flex flex-1 flex-wrap">
        <RoleNav />
        <main className="box-border flex min-w-0 flex-[999_1_560px] flex-col gap-5 px-4 pb-12 pt-7 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
