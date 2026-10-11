/** Screen 07: farmers. Phone numbers masked; PII only from GetFarmerPII. */
import type { Farmer } from '@wrt/shared';
import { useMemo, useState } from 'react';
import { Button, Callout, EmptyRow, Mono, PageHeader, StatusChip, TableCard } from '../../components/ui';
import { useCustody } from '../../lib/derive';
import { date, shortHash } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useFarmerPII, useFarmers } from '../../lib/queries';
import { RegisterFarmerModal } from '../../modals/Modals';

function mask(phone: string): string {
  const digits = phone.replace(/\s/g, '');
  return digits.length > 8 ? `${digits.slice(0, 4)} ${digits[4]}•• ••• ${digits.slice(-3)}` : '•••';
}

function Row({ f, stats, filter }: { f: Farmer; stats: { receipts: number; kg: number }; filter: string }) {
  const pii = useFarmerPII(f.id);
  const text = `${f.id} ${pii.data?.fullName ?? ''} ${pii.data?.villageOrWard ?? ''}`.toLowerCase();
  if (filter && !text.includes(filter)) return null;
  return (
    <tr>
      <td className="font-mono">{f.id}</td>
      <td>{pii.data?.fullName ?? (pii.isLoading ? '…' : '—')}</td>
      <td className="font-mono">{pii.data ? mask(pii.data.phone) : '—'}</td>
      <td>{pii.data?.villageOrWard ?? '—'}</td>
      <td className="r font-mono">{stats.receipts}</td>
      <td className="r font-mono">{stats.kg.toLocaleString('en-US')}</td>
      <td className="font-mono">{date(f.createdAt)}</td>
      <td className="font-mono" title={f.piiHash}>
        {shortHash(f.piiHash, 4, 4)}
      </td>
      <td>
        <StatusChip domain="entity" status={f.status} />
      </td>
    </tr>
  );
}

export function WarehouseFarmers() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const farmers = useFarmers(id);
  const custody = useCustody(id);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const stats = useMemo(() => {
    const m = new Map<string, { receipts: number; kg: number }>();
    for (const r of custody.data ?? []) {
      const s = m.get(r.holderFarmerId) ?? { receipts: 0, kg: 0 };
      m.set(r.holderFarmerId, { receipts: s.receipts + 1, kg: s.kg + r.netKg });
    }
    return m;
  }, [custody.data]);
  const list = (farmers.data ?? []).filter((f) => status === 'ALL' || f.status === status);
  return (
    <>
      <PageHeader eyebrow="Warehouse" title="Farmers" actions={<Button variant="accent" onClick={() => setOpen(true)}>Register farmer</Button>} />
      <Callout tone="info">
        Names, phones and NIDA numbers live in the private collection <Mono>farmerPII</Mono>, readable by Warehouse, Lender and Regulator only. Inspectors and the public state see the farmer ID and a{' '}
        <Mono>sha256</Mono> hash.
      </Callout>
      <div className="flex flex-wrap gap-3">
        <label className="field min-w-[240px] flex-1">
          Search
          <input className="input" type="search" placeholder="Name, farmer ID or village" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="field min-w-[160px]">
          Status
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="ALL">All</option>
          </select>
        </label>
      </div>
      <TableCard footer={<span>Showing {list.length} farmers registered by {id}</span>}>
        <thead>
          <tr>
            <th>Farmer ID</th>
            <th>Name</th>
            <th>Phone</th>
            <th>Village / ward</th>
            <th className="r">Receipts</th>
            <th className="r">kg stored</th>
            <th>Registered</th>
            <th>PII hash</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && <EmptyRow cols={9}>{farmers.isLoading ? 'Loading…' : 'No farmers registered yet.'}</EmptyRow>}
          {list.map((f) => (
            <Row key={f.id} f={f} stats={stats.get(f.id) ?? { receipts: 0, kg: 0 }} filter={search.trim().toLowerCase()} />
          ))}
        </tbody>
      </TableCard>
      <RegisterFarmerModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
