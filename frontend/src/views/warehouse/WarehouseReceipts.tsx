/** Screen 10: receipts in custody, with status filter pills. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyRow, FilterPills, PageHeader, StatusChip, TableCard } from '../../components/ui';
import { useCustody } from '../../lib/derive';
import { bpPct, commodity, kg, shortDate } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useFarmerPII, useLoans } from '../../lib/queries';

function Holder({ id }: { id: string }) {
  const pii = useFarmerPII(id);
  return <>{pii.data?.fullName ?? <span className="font-mono">{id}</span>}</>;
}

type F = 'all' | 'ISSUED' | 'PLEDGED' | 'UNDER_DISPUTE' | 'PENDING_WRRB' | 'EXPIRING';

export function WarehouseReceipts() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const custody = useCustody(id);
  const offers = useLoans({ status: 'OFFERED' });
  const [f, setF] = useState<F>('all');
  const all = custody.data ?? [];
  const soon = Date.now() + 30 * 86_400_000;
  const match = (r: (typeof all)[number], k: F) =>
    k === 'all' || (k === 'PENDING_WRRB' ? r.legal.status === 'PENDING_WRRB' : k === 'EXPIRING' ? new Date(r.expiresAt).getTime() < soon : r.status === k);
  const pills: { id: F; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'ISSUED', label: 'Issued' },
    { id: 'PLEDGED', label: 'Pledged' },
    { id: 'UNDER_DISPUTE', label: 'Under dispute' },
    { id: 'PENDING_WRRB', label: 'Pending WRRB' },
    { id: 'EXPIRING', label: 'Expiring < 30 d' },
  ];
  const list = all.filter((r) => match(r, f)).sort((a, b) => b.id.localeCompare(a.id));
  const offered = new Set((offers.data ?? []).map((l) => l.receiptId));
  return (
    <>
      <PageHeader eyebrow="Custody" title="Receipts in custody" actions={<span className="font-mono text-[13px] text-muted">{all.reduce((s, r) => s + r.netKg, 0).toLocaleString('en-US')} kg · {all.length} receipts</span>} />
      <FilterPills label="Filter by status" pills={pills.map((p) => ({ ...p, count: all.filter((r) => match(r, p.id)).length }))} value={f} onChange={setF} />
      <TableCard>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Holder</th>
            <th>Commodity</th>
            <th className="r">Net kg</th>
            <th className="r">Moisture</th>
            <th>Legal</th>
            <th>Status</th>
            <th>Lien</th>
            <th>Expires</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && <EmptyRow cols={9}>{custody.isLoading ? 'Loading…' : 'No receipts in custody yet. Receipts appear once an inspector attests a deposit within tolerance.'}</EmptyRow>}
          {list.map((r) => (
            <tr key={r.id}>
              <td className="font-mono">
                <Link to={`/receipts/${r.id}`}>{r.id}</Link>
              </td>
              <td>
                <Holder id={r.holderFarmerId} />
              </td>
              <td>
                {commodity(r.commodity)} {r.grade}
              </td>
              <td className="r font-mono">{r.netKg.toLocaleString('en-US')}</td>
              <td className="r font-mono">{bpPct(r.moistureBp)}</td>
              <td>
                <StatusChip domain="legal" status={r.legal.status} label={r.legal.status === 'WRRB_REGISTERED' ? 'WRRB' : undefined} />
              </td>
              <td>
                <StatusChip domain="receipt" status={r.status} />
              </td>
              <td className="font-mono">{r.lien ? `${r.lien.loanId} · ${r.lien.lenderId.replace('LND-', '')}` : offered.has(r.id) ? <span className="font-sans text-muted">offer pending</span> : '—'}</td>
              <td className="font-mono">{shortDate(r.expiresAt)}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
      <span className="sr-only">{kg(0)}</span>
    </>
  );
}
