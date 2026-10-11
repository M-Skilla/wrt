/** Screen 22: entity registry with tabs for warehouses, lenders, inspectors and farmers. */
import type { EntityStatus } from '@wrt/shared';
import { useState } from 'react';
import { Button, Callout, EmptyRow, FilterTabs, PageHeader, StatusChip, TableCard } from '../../components/ui';
import { api } from '../../lib/api';
import { bpPct, date, shortHash } from '../../lib/format';
import { useCustody } from '../../lib/derive';
import { useFarmers, useInspectors, useLenders, useLoans, useWarehouses } from '../../lib/queries';
import { useTx } from '../../lib/tx';
import { AccreditInspectorModal, RegisterLenderModal, RegisterWarehouseModal } from '../../modals/Modals';

type Tab = 'warehouse' | 'lender' | 'inspector' | 'farmer';

function StatusAction({ kind, id, status }: { kind: Tab; id: string; status: EntityStatus }) {
  const tx = useTx();
  if (status === 'REVOKED') return <span className="text-muted">revoked</span>;
  const next: EntityStatus = status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  return (
    <Button variant="secondary" size="sm" disabled={tx.pending} onClick={() => void tx.run(() => api.post(`/registry/${kind}/${id}/status`, { status: next }), () => `${id} ${next}.`)}>
      {status === 'ACTIVE' ? 'Suspend' : 'Reinstate'}
    </Button>
  );
}

function Utilisation({ id, capacity }: { id: string; capacity: number }) {
  const custody = useCustody(id);
  const kg = (custody.data ?? []).reduce((s, r) => s + r.netKg, 0);
  return <>{capacity ? bpPct(Math.floor((kg * 10_000) / capacity)) : '—'}</>;
}

export function RegulatorRegistry() {
  const warehouses = useWarehouses();
  const lenders = useLenders();
  const inspectors = useInspectors();
  const farmers = useFarmers();
  const loans = useLoans({ status: 'ACTIVE,MARGIN_CALL' });
  const [tab, setTab] = useState<Tab>('warehouse');
  const [modal, setModal] = useState<Tab | null>(null);
  return (
    <>
      <PageHeader
        eyebrow="Onboarding governance"
        title="Entity registry"
        sub="A hosted member can transact only after you register it here. Suspension takes effect on the next transaction it attempts."
        actions={
          tab === 'warehouse' ? (
            <Button variant="accent" onClick={() => setModal('warehouse')}>Register warehouse</Button>
          ) : tab === 'lender' ? (
            <Button variant="accent" onClick={() => setModal('lender')}>Register lender</Button>
          ) : tab === 'inspector' ? (
            <Button variant="accent" onClick={() => setModal('inspector')}>Accredit inspector</Button>
          ) : undefined
        }
      />
      <FilterTabs
        label="Entity type"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'warehouse', label: 'Warehouses', count: warehouses.data?.length },
          { id: 'lender', label: 'Lenders', count: lenders.data?.length },
          { id: 'inspector', label: 'Inspectors', count: inspectors.data?.length },
          { id: 'farmer', label: 'Farmers', count: farmers.data?.length },
        ].map((t) => ({ ...t, count: t.count ?? 0 })) as { id: Tab; label: string; count: number }[]}
      />
      {tab === 'warehouse' && (
        <TableCard>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Region</th>
              <th>WRRB licence</th>
              <th className="r">Capacity kg</th>
              <th className="r">Utilised</th>
              <th>Bond ref</th>
              <th className="r">Penalties</th>
              <th>Tier</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(warehouses.data ?? []).map((w) => (
              <tr key={w.id}>
                <td className="font-mono">{w.id}</td>
                <td>{w.name}</td>
                <td>{w.region}</td>
                <td className="font-mono">{w.licenseNo}</td>
                <td className="r font-mono">{w.capacityKg.toLocaleString('en-US')}</td>
                <td className="r font-mono">
                  <Utilisation id={w.id} capacity={w.capacityKg} />
                </td>
                <td className="font-mono">{w.bondRef}</td>
                <td className="r font-mono">{w.penaltyCount}</td>
                <td className="font-mono">hosted</td>
                <td>
                  <StatusChip domain="entity" status={w.status} />
                </td>
                <td className="r">
                  <StatusAction kind="warehouse" id={w.id} status={w.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
      {tab === 'lender' && (
        <TableCard>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Type</th>
              <th>Licence</th>
              <th>Node</th>
              <th className="r">Active loans</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(lenders.data ?? []).map((l) => (
              <tr key={l.id}>
                <td className="font-mono">{l.id}</td>
                <td>{l.name}</td>
                <td>{l.type === 'BANK' ? 'Bank' : l.type}</td>
                <td className="font-mono">{l.licenseNo}</td>
                <td className="font-mono">{l.type === 'BANK' ? 'via peer0.lender' : 'hosted · no peer'}</td>
                <td className="r font-mono">{(loans.data ?? []).filter((x) => x.lenderId === l.id).length}</td>
                <td>
                  <StatusChip domain="entity" status={l.status} />
                </td>
                <td className="r">
                  <StatusAction kind="lender" id={l.id} status={l.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
      {tab === 'lender' && !(lenders.data ?? []).some((l) => l.id === 'LND-MFI-01') && (
        <Callout tone="info" title="S7: hosted MFI onboarding.">
          LND-MFI-01 holds a Lender-CA certificate but is not registered on-chain yet, so its offers fail.{' '}
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-semibold text-link underline" onClick={() => setModal('lender')}>
            Register it
          </button>{' '}
          to let it transact through peer0.lender.
        </Callout>
      )}
      {tab === 'inspector' && (
        <TableCard>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Accreditation</th>
              <th>Declared conflicts</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(inspectors.data ?? []).map((i) => (
              <tr key={i.id}>
                <td className="font-mono">{i.id}</td>
                <td>{i.name}</td>
                <td className="font-mono">{i.accreditationNo}</td>
                <td className="font-mono">{i.conflictWarehouseIds.join(', ') || '—'}</td>
                <td>
                  <StatusChip domain="entity" status={i.status} />
                </td>
                <td className="r">
                  <StatusAction kind="inspector" id={i.id} status={i.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
      {tab === 'farmer' && (
        <TableCard footer={<span>Farmers are registered by warehouse operators. Names live in the private collection.</span>}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Registered by</th>
              <th>Registered</th>
              <th>PII hash</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(farmers.data ?? []).length === 0 && <EmptyRow cols={6}>No farmers.</EmptyRow>}
            {(farmers.data ?? []).map((f) => (
              <tr key={f.id}>
                <td className="font-mono">{f.id}</td>
                <td className="font-mono">{f.registeredByWarehouseId}</td>
                <td className="font-mono">{date(f.createdAt)}</td>
                <td className="font-mono" title={f.piiHash}>
                  {shortHash(f.piiHash, 4, 4)}
                </td>
                <td>
                  <StatusChip domain="entity" status={f.status} />
                </td>
                <td className="r">
                  <StatusAction kind="farmer" id={f.id} status={f.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
      {modal === 'warehouse' && <RegisterWarehouseModal open onClose={() => setModal(null)} />}
      {modal === 'lender' && (
        <RegisterLenderModal
          open
          onClose={() => setModal(null)}
          {...(!(lenders.data ?? []).some((l) => l.id === 'LND-MFI-01') ? { preset: { id: 'LND-MFI-01', name: 'Uhuru Rural MFI', type: 'MFI', licenseNo: 'BOT/MFI/T2/2023/118' } } : {})}
        />
      )}
      {modal === 'inspector' && <AccreditInspectorModal open onClose={() => setModal(null)} />}
    </>
  );
}
