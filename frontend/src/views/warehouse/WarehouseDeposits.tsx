/** Screen 09: deposits, tabbed by status. */
import type { Deposit, DepositStatus } from '@wrt/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyRow, FilterTabs, LinkButton, PageHeader, StatusChip, TableCard } from '../../components/ui';
import { bpPct, commodity, feedTime, kg, signedBp } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useDeposits, useFarmerPII } from '../../lib/queries';

function FarmerName({ id }: { id: string }) {
  const pii = useFarmerPII(id);
  return (
    <>
      {pii.data?.fullName ?? ''} <span className="font-mono text-muted">{id}</span>
    </>
  );
}

const TABS: { id: DepositStatus; label: string }[] = [
  { id: 'PENDING_ATTESTATION', label: 'Awaiting attestation' },
  { id: 'MISMATCH_DISPUTED', label: 'Mismatch disputed' },
  { id: 'ATTESTED', label: 'Attested' },
  { id: 'REJECTED', label: 'Rejected' },
];

export function WarehouseDeposits() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const all = useDeposits({ warehouseId: id }, !!id);
  const [tab, setTab] = useState<DepositStatus>('PENDING_ATTESTATION');
  const list = (all.data ?? []).filter((d) => d.status === tab).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const count = (s: DepositStatus) => (all.data ?? []).filter((d) => d.status === s).length;
  const gap = (d: Deposit) => (d.attestation ? Math.trunc(((d.attestation.observed.netKg - d.declared.netKg) * 10_000) / d.declared.netKg) : 0);
  const showReadings = tab !== 'PENDING_ATTESTATION';
  return (
    <>
      <PageHeader eyebrow="Before minting" title="Deposits" actions={<LinkButton to="/warehouse/deposits/new" variant="accent">Record deposit</LinkButton>} />
      <FilterTabs label="Deposit status" tabs={TABS.map((t) => ({ ...t, count: count(t.id) }))} value={tab} onChange={setTab} />
      <TableCard>
        <thead>
          <tr>
            <th>Deposit</th>
            <th>Farmer</th>
            <th>Commodity</th>
            <th className="r">Declared</th>
            {showReadings ? <th className="r">Observed</th> : <th className="r">Moisture</th>}
            {showReadings ? <th className="r">Gap</th> : <th>Seal</th>}
            <th>Inspector</th>
            <th>{showReadings ? 'Outcome' : 'Recorded'}</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && <EmptyRow cols={9}>{all.isLoading ? 'Loading…' : 'Nothing in this tab.'}</EmptyRow>}
          {list.map((d) => (
            <tr key={d.id}>
              <td className="font-mono">{d.id}</td>
              <td>
                <FarmerName id={d.farmerId} />
              </td>
              <td>
                {commodity(d.commodity)} {d.declared.grade}
              </td>
              <td className="r font-mono">{kg(d.declared.netKg)}</td>
              {showReadings ? <td className="r font-mono">{d.attestation ? kg(d.attestation.observed.netKg) : '—'}</td> : <td className="r font-mono">{bpPct(d.declared.moistureBp)}</td>}
              {showReadings ? <td className="r font-mono">{d.attestation ? signedBp(gap(d)) : '—'}</td> : <td className="font-mono">{d.sampleSealNo}</td>}
              <td className="font-mono">{d.attestation?.inspectorId ?? d.assignedInspectorId}</td>
              <td className="font-mono">
                {d.receiptId ? <Link to={`/receipts/${d.receiptId}`}>{d.receiptId}</Link> : d.disputeId ? <Link to={`/disputes/${d.disputeId}`}>{d.disputeId}</Link> : feedTime(d.createdAt)}
              </td>
              <td>
                <StatusChip domain="deposit" status={d.status} label={d.status === 'MISMATCH_DISPUTED' ? 'No receipt minted' : undefined} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>
      {tab === 'MISMATCH_DISPUTED' && list.length > 0 && (
        <p className="m-0 text-[13px] text-muted">
          The inspector's reading was outside tolerance, so the chaincode opened a <span className="font-mono">MINT_MISMATCH</span> dispute. The regulator will assign a second inspector. A{' '}
          <span className="font-mono">FRAUDULENT</span> ruling suspends this warehouse.
        </p>
      )}
    </>
  );
}
