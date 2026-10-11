/** Screen 20: completed inspections. */
import { Link } from 'react-router-dom';
import { Chip, EmptyRow, PageHeader, StatTile, TableCard, Tiles } from '../../components/ui';
import { bpPct, commodity, feedTime, kg } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useDeposits, useDisputes, useReceipts } from '../../lib/queries';

interface Row {
  at: string;
  type: 'ATTEST' | 'QUALITY' | 'REINSPECT';
  subject: string;
  link: string;
  warehouse: string;
  reading: string;
  outcome: JSX.Element;
}

export function InspectorHistory() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const deposits = useDeposits({ assignedInspectorId: id }, !!id);
  const receipts = useReceipts();
  const disputes = useDisputes({ reinspection_inspectorId: id }, !!id);
  const rows: Row[] = [];
  for (const d of deposits.data ?? []) {
    if (!d.attestation || d.attestation.inspectorId !== id) continue;
    const o = d.attestation.observed;
    rows.push({
      at: d.attestation.attestedAt,
      type: 'ATTEST',
      subject: d.id,
      link: d.receiptId ? `/receipts/${d.receiptId}` : d.disputeId ? `/disputes/${d.disputeId}` : '#',
      warehouse: d.warehouseId,
      reading: `${commodity(d.commodity)} ${o.grade} · ${kg(o.netKg)} · ${bpPct(o.moistureBp)}`,
      outcome: d.receiptId && d.status === 'ATTESTED' && !d.disputeId ? <Chip tone="cyan">Minted {d.receiptId.slice(-6)}</Chip> : <Chip tone="red">Mismatch → {d.disputeId}</Chip>,
    });
  }
  for (const r of receipts.data ?? []) {
    for (const q of r.qualityHistory.filter((x) => x.inspectorId === id)) {
      rows.push({
        at: q.at,
        type: 'QUALITY',
        subject: r.id,
        link: `/receipts/${r.id}`,
        warehouse: r.warehouseId,
        reading: `${commodity(r.commodity)} ${q.observed.grade} · ${kg(q.observed.netKg)} · ${bpPct(q.observed.moistureBp)}`,
        outcome: <Chip tone="green">Recorded · {q.reason.toLowerCase().replace('_', ' ')}</Chip>,
      });
    }
  }
  for (const d of disputes.data ?? []) {
    if (!d.reinspection?.submittedAt || !d.reinspection.observed) continue;
    const o = d.reinspection.observed;
    rows.push({
      at: d.reinspection.submittedAt,
      type: 'REINSPECT',
      subject: d.id,
      link: `/disputes/${d.id}`,
      warehouse: d.subject.id,
      reading: `${o.grade} · ${kg(o.netKg)} · ${bpPct(o.moistureBp)}`,
      outcome: d.resolution ? <Chip tone="green">Ruled {d.resolution.outcome}</Chip> : <Chip tone="yellow">Awaiting ruling</Chip>,
    });
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  const attests = rows.filter((r) => r.type === 'ATTEST');
  const minted = (deposits.data ?? []).filter((d) => d.attestation?.inspectorId === id && !d.disputeId).length;
  return (
    <>
      <PageHeader eyebrow={`Inspector · ${id}`} title="Completed inspections" />
      <Tiles>
        <StatTile label="Total signed" value={rows.length} />
        <StatTile label="Attestations minted" value={minted} />
        <StatTile label="Mismatches flagged" value={attests.length - minted} />
        <StatTile label="Re-inspections" value={rows.filter((r) => r.type === 'REINSPECT').length} />
      </Tiles>
      <TableCard>
        <thead>
          <tr>
            <th>Signed</th>
            <th>Type</th>
            <th>Subject</th>
            <th>Warehouse</th>
            <th>Reading</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={6}>No completed inspections yet.</EmptyRow>}
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="font-mono">{feedTime(r.at)}</td>
              <td className="font-mono">{r.type}</td>
              <td className="font-mono">
                <Link to={r.link}>{r.subject}</Link>
              </td>
              <td className="font-mono">{r.warehouse}</td>
              <td className="font-mono">{r.reading}</td>
              <td>{r.outcome}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </>
  );
}
