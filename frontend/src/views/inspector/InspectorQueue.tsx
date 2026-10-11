/** Screen 18: inspector assignment queue. Farmer identity is never shown to inspectors. */
import { EmptyState, LinkButton, PageHeader, Section } from '../../components/ui';
import { useInspectorQueue } from '../../lib/derive';
import { ago, bpPct, commodity, date, kg } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useWarehouses } from '../../lib/queries';

function Row({ type, id, text, when, to, accent }: { type: string; id: string; text: string; when: string; to: string; accent?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="rounded-chip bg-tint-neutral px-1.5 py-0.5 font-mono text-[11px] font-semibold">{type}</span>
        <div className="min-w-0">
          <b className="block font-mono text-[13px]">{id}</b>
          <span className="text-[13px] text-muted">{text}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[12px] text-muted">{when}</span>
        <LinkButton to={to} variant={accent ? 'accent' : 'primary'} size="sm">
          {accent ? 'Inspect' : 'Start'}
        </LinkButton>
      </div>
    </div>
  );
}

export function InspectorQueue() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const ins = me?.entity as { conflictWarehouseIds?: string[]; accreditationNo?: string } | null;
  const q = useInspectorQueue(id);
  const warehouses = useWarehouses();
  const wh = (w: string) => warehouses.data?.find((x) => x.id === w)?.name ?? w;
  const total = q.data ? q.data.attest.length + q.data.quality.length + q.data.reinspect.length : 0;
  return (
    <>
      <PageHeader
        eyebrow={`Inspector · ${id}`}
        title="Assignment queue"
        sub="Assignments come from a tx-hash draw, never from the warehouse. You see crop data only; farmer identities are hidden from inspectors."
        actions={
          <div className="font-mono text-[13px] text-muted">
            conflicts declared <b className="text-ink">{ins?.conflictWarehouseIds?.length ?? 0}</b>
          </div>
        }
      />
      {q.data && total === 0 && <EmptyState title="Nothing assigned to you">When the chaincode draws you for an attestation, quality check or re-inspection, it appears here.</EmptyState>}
      {q.data && q.data.attest.length > 0 && (
        <Section title={`Attestations · ${q.data.attest.length}`} aside={<span className="font-mono">minting depends on these</span>} pad={false}>
          {q.data.attest.map((d) => (
            <Row
              key={d.id}
              type="ATTEST"
              id={d.id}
              text={`${wh(d.warehouseId)} · ${commodity(d.commodity)} · declared ${d.declared.grade} · ${kg(d.declared.netKg)} · ${bpPct(d.declared.moistureBp)} · seal ${d.sampleSealNo}`}
              when={`assigned ${ago(d.createdAt)}`}
              to={`/inspector/inspect/${d.id}`}
              accent
            />
          ))}
        </Section>
      )}
      {q.data && q.data.quality.length > 0 && (
        <Section title={`Quality checks · ${q.data.quality.length}`} aside={<span className="font-mono">live receipts</span>} pad={false}>
          {q.data.quality.map((r) => (
            <Row
              key={r.id}
              type="QUALITY"
              id={r.id}
              text={`${wh(r.warehouseId)} · ${commodity(r.commodity)} ${r.grade} · ${kg(r.netKg)} · ${r.pendingQualityCheck?.reason.toLowerCase().replace('_', ' ')}${r.pendingQualityCheck?.requestedBy ? ` by ${r.pendingQualityCheck.requestedBy.entityId}` : ''} · last check ${date(r.lastQualityCheckAt)}`}
              when={`requested ${ago(r.pendingQualityCheck?.requestedAt)}`}
              to={`/inspector/inspect/${r.id}`}
            />
          ))}
        </Section>
      )}
      {q.data && q.data.reinspect.length > 0 && (
        <Section title={`Re-inspections · ${q.data.reinspect.length}`} aside={<span className="font-mono">for open disputes</span>} pad={false}>
          {q.data.reinspect.map((d) => (
            <Row
              key={d.id}
              type="REINSPECT"
              id={`${d.id} · ${d.subject.id}`}
              text={`${d.type} · original reading hidden until you submit`}
              when={`assigned ${ago(d.reinspection?.assignedAt)}`}
              to={`/inspector/inspect/${d.id}`}
            />
          ))}
        </Section>
      )}
    </>
  );
}
