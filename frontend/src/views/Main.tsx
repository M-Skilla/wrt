/** Screen 01: demo identity picker, grouped by MSP. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Shell';
import { homeFor, useIdentity } from '../lib/identity';
import { useIdentities, useNetwork } from '../lib/queries';
import type { WalletIdentity } from '../lib/types';

const GROUPS: { msp: string; note: string }[] = [
  { msp: 'WarehouseMSP', note: 'hosts operators + farmers' },
  { msp: 'LenderMSP', note: 'banks, MFIs, SACCOs' },
  { msp: 'RegulatorMSP', note: 'WRRB role' },
  { msp: 'InspectorMSP', note: 'accredited, independent' },
];

export function Main() {
  const ids = useIdentities();
  const net = useNetwork();
  const { signIn } = useIdentity();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (ids.data ?? []).filter((i) => !f || [i.displayName, i.role, i.entityId, i.detail, i.label].some((v) => v?.toLowerCase().includes(f)));
  }, [ids.data, filter]);

  function enter(i: WalletIdentity) {
    signIn(i.label);
    navigate(homeFor(i.role));
  }

  const group = (msp: string) => visible.filter((i) => i.mspId === msp);
  const Card = ({ msp, note }: { msp: string; note: string }) => (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <h2 className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-3 text-[13px] font-bold">
        {msp} <span className="font-mono text-[11px] font-medium text-muted">{note}</span>
      </h2>
      {group(msp).length === 0 && <p className="m-0 px-4 py-3 text-[13px] text-muted">No identities match.</p>}
      {group(msp).map((i) => (
        <button
          key={i.label}
          type="button"
          onClick={() => enter(i)}
          className="flex min-h-[56px] w-full cursor-pointer items-center justify-between gap-3 border-0 border-b border-line-soft bg-transparent px-4 py-2.5 text-left font-sans text-ink last:border-b-0 hover:bg-tint-cyan"
        >
          <span>
            <b className="block text-[14px] font-semibold">{i.displayName ?? i.entityId ?? i.label}</b>
            <span className="mt-0.5 block text-[12px] text-muted">
              {i.role} · <span className="font-mono">{i.entityId}</span>
              {i.detail ? ` · ${i.detail}` : ''}
            </span>
          </span>
          <span className="whitespace-nowrap font-mono text-[12px] text-link">enter →</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-wrap bg-canvas">
      <section className="box-border flex flex-[1_1_380px] flex-col gap-9 bg-ink px-6 pb-8 pt-10 text-white sm:px-10">
        <div className="flex items-center gap-3 text-[22px] font-extrabold tracking-[-0.01em]">
          <Logo size={32} />
          WRT
        </div>
        <div className="flex flex-col gap-4">
          <h1 className="m-0 text-[32px] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[40px]">Crop receipts as collateral, on a ledger no single party can rewrite.</h1>
          <p className="m-0 max-w-[460px] text-[15px] leading-relaxed text-muted-dark-2">
            Warehouse receipts are minted after independent inspection, registered with the regulator, and pledged into escrow-backed loans on a four-organisation Hyperledger Fabric network.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-card border border-ink-line-2 p-4">
          <div className="eyebrow text-muted-dark-3">Network</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 font-mono text-[12px] text-muted-dark-2">
            <span>
              channel <span className="text-white">{net.data?.channel ?? 'wrt-channel'}</span>
            </span>
            <span>
              chaincode <span className="text-white">{net.data?.chaincode ?? 'wrt'}</span>
            </span>
            <span>
              block <span className="text-white">{net.data ? net.data.height.toLocaleString('en-US') : '…'}</span>
            </span>
            <span>
              policy <span className="text-white">3 of 4 orgs</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2 font-mono text-[12px]">
            {['WarehouseMSP', 'LenderMSP', 'InspectorMSP', 'RegulatorMSP'].map((m) => (
              <span key={m} className="rounded-chip border border-ink-line-2 px-2.5 py-1.5">
                <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${net.data?.peers[m] === false ? 'bg-neutral-dot' : 'bg-cyan'}`} />
                peer0.{m.replace('MSP', '').toLowerCase()}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-auto flex items-start gap-2.5 rounded-card bg-yellow px-3.5 py-3 text-[13px] leading-normal text-ink" role="note">
          <span aria-hidden="true" className="grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-2 border-ink text-[11px] font-bold">
            !
          </span>
          <span>
            <b>Demo identity.</b> Not real authentication. Each identity maps to a pre-enrolled Fabric wallet with role attributes.
          </span>
        </div>
      </section>
      <section className="box-border flex min-w-0 flex-[999_1_560px] flex-col gap-6 px-4 pb-12 pt-10 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Sign in as</div>
            <h2 className="mt-1.5 text-[28px] font-extrabold tracking-[-0.02em]">Choose a demo identity</h2>
          </div>
          <label className="field min-w-[260px]">
            Filter identities
            <input className="input" type="search" placeholder="Name, role or entity ID" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
        {ids.error ? (
          <div role="alert" className="rounded-card border border-tint-red-line bg-tint-red p-4 font-mono text-[13px]">
            {(ids.error as Error).message}. Start the backend (make dev) and the network (make up).
          </div>
        ) : (
          <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <Card {...GROUPS[0]!} />
            <div className="flex flex-col gap-4">
              <Card {...GROUPS[1]!} />
              <Card {...GROUPS[2]!} />
            </div>
            <Card {...GROUPS[3]!} />
          </div>
        )}
      </section>
    </div>
  );
}
