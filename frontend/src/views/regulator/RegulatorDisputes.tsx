/** Screen 24: dispute arbitration. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyRow, LinkButton, PageHeader, StatusChip, TableCard } from '../../components/ui';
import { duration, shortReceipt } from '../../lib/format';
import { useDisputes } from '../../lib/queries';
import type { Dispute } from '@wrt/shared';

export function RegulatorDisputes() {
  const all = useDisputes();
  const [showResolved, setShowResolved] = useState(false);
  const list = (all.data ?? []).filter((d) => showResolved || d.status !== 'RESOLVED').sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
  const count = (s: Dispute['status']) => (all.data ?? []).filter((d) => d.status === s).length;
  const quarter = Date.now() - 90 * 86_400_000;
  const resolvedQ = (all.data ?? []).filter((d) => d.resolution && new Date(d.resolution.resolvedAt).getTime() > quarter);
  const tiles: [string, number, string][] = [
    ['Open', count('OPEN'), 'needs re-inspector'],
    ['Re-inspection assigned', count('REINSPECTION_ASSIGNED'), 'with inspector'],
    ['Ready to rule', count('REINSPECTED'), 're-inspected'],
    ['Resolved this quarter', resolvedQ.length, `${resolvedQ.filter((d) => d.resolution?.outcome === 'FRAUDULENT').length} fraudulent`],
  ];
  return (
    <>
      <PageHeader eyebrow="Regulator" title="Dispute arbitration" actions={<Button variant="secondary" onClick={() => setShowResolved(!showResolved)}>{showResolved ? 'Hide resolved' : 'Show resolved'}</Button>} />
      <section className="card grid overflow-hidden" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {tiles.map(([k, n, s]) => (
          <div key={k} className="flex flex-col gap-1 border-b border-r border-line p-4">
            <span className="eyebrow">{k}</span>
            <span className="font-mono text-[24px] font-semibold">{n}</span>
            <span className="text-[12px] text-muted">{s}</span>
          </div>
        ))}
      </section>
      <TableCard footer={<span>The draw excludes the inspector whose reading is disputed and any inspector with a declared conflict.</span>}>
        <thead>
          <tr>
            <th>Dispute</th>
            <th>Type</th>
            <th>Subject</th>
            <th>Raised by</th>
            <th>Frozen</th>
            <th>Re-inspector</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && <EmptyRow cols={8}>{all.isLoading ? 'Loading…' : 'No open disputes.'}</EmptyRow>}
          {list.map((d) => (
            <tr key={d.id}>
              <td className="font-mono">
                <Link to={`/disputes/${d.id}`}>{d.id}</Link>
              </td>
              <td className="font-mono">{d.type}</td>
              <td className="font-mono">{shortReceipt(d.subject.id)}</td>
              <td className="font-mono">{d.type === 'MINT_MISMATCH' ? 'chaincode · auto' : d.raisedBy.entityId}</td>
              <td className="font-mono">{d.subject.kind === 'DEPOSIT' ? 'no receipt' : d.status === 'RESOLVED' ? '—' : duration((Date.now() - new Date(d.raisedAt).getTime()) / 1000)}</td>
              <td className="font-mono">{d.reinspection?.inspectorId ?? '—'}</td>
              <td>
                <StatusChip domain="dispute" status={d.status} label={d.resolution ? d.resolution.outcome : undefined} />
              </td>
              <td className="r">
                {d.status === 'REINSPECTED' ? (
                  <LinkButton to={`/disputes/${d.id}`} variant="accent" size="sm">Rule</LinkButton>
                ) : d.status === 'OPEN' ? (
                  <LinkButton to={`/disputes/${d.id}`} size="sm">Assign re-inspection</LinkButton>
                ) : (
                  <span className="text-muted">{d.status === 'RESOLVED' ? '' : 'waiting'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </>
  );
}
