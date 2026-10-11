/** Screen 26: ledger explorer. Search by key, tx id or block; shows rejected attempts (S6) above committed history. */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EndorsementBadges, RejectedChip } from '../../components/ledger';
import { Async, Button, Chip, EmptyRow, Mono, PageHeader, Section, TableCard } from '../../components/ui';
import { api } from '../../lib/api';
import { feedTime, shortHash } from '../../lib/format';
import { useExplorerTxs } from '../../lib/queries';
import type { ExplorerTx, HistoryRow } from '../../lib/types';

type SearchResult = { kind: 'block'; block: number; txs: ExplorerTx[] } | { kind: 'tx'; tx: ExplorerTx } | { kind: 'key'; key: string; history: HistoryRow[] };

const DIFF_FIELDS = ['status', 'grade', 'netKg', 'moistureBp', 'repaidTzs', 'balanceTzs', 'legal', 'lien', 'release', 'penaltyCount'];

function diff(attempted: Record<string, unknown>, current: Record<string, unknown> | null): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const k of DIFF_FIELDS) {
    const a = JSON.stringify(attempted[k] ?? null);
    const c = JSON.stringify(current?.[k] ?? null);
    if (a !== c) out.push([k, c === 'null' ? '—' : c.replace(/"/g, ''), a === 'null' ? '—' : a.replace(/"/g, '')]);
  }
  return out;
}

function Rejected({ tx }: { tx: ExplorerTx }) {
  const write = tx.writes[0];
  const [docType, ...rest] = (write?.key ?? '').split('~');
  const current = useQuery({ queryKey: ['current', write?.key], queryFn: () => api.get<Record<string, unknown>>(`/registry/${docType}/${rest.join('~')}`), enabled: !!write });
  const changes = write?.value ? diff(write.value as Record<string, unknown>, current.data ?? null) : [];
  return (
    <section className="card flex flex-col gap-4 border-tint-red-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-2">
          <RejectedChip />
          <b className="text-[15px]">Attempt to rewrite {write?.key ?? 'state'}</b>
        </div>
        <span className="font-mono text-[12px] text-muted">
          {feedTime(tx.timestamp)} · block {tx.blockNumber} · tx {shortHash(tx.txId)}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="eyebrow mb-1">Attempted write</div>
          <pre className="m-0 overflow-x-auto rounded-card bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">
            {write?.key}
            {'\n'}
            {changes.map(([k, from, to]) => `  ${k.padEnd(12)} ${from} → ${to}\n`).join('')}
            {`  function     ${tx.fn}\n  submitter    ${tx.creator.mspId} (${tx.creator.entityId ?? tx.creator.name})`}
          </pre>
        </div>
        <div className="flex flex-col gap-2">
          <div className="eyebrow">Endorsements collected</div>
          <EndorsementBadges endorsers={tx.endorsers} />
          <div className="font-mono text-[12px] text-muted">{tx.endorsers.length} of 4 · policy needs 3</div>
          <Chip tone="red" mono>
            {tx.validationCode}
          </Chip>
          <p className="m-0 text-[13px] leading-relaxed text-muted">
            The warehouse holds the crop, but cannot change the record on its own. The transaction reached a block, and every peer marked it invalid; the world state never changed.
          </p>
        </div>
      </div>
    </section>
  );
}

function History({ keyLabel, rows }: { keyLabel: string; rows: HistoryRow[] }) {
  return (
    <TableCard title={<>Committed history · <Mono>{keyLabel}</Mono></>} aside={<span className="font-mono">getHistoryForKey · {rows.length} versions</span>} footer={<span>Every version above is in a block every peer holds. Rejected attempts never enter the history.</span>}>
      <thead>
        <tr>
          <th>Ver</th>
          <th>Block</th>
          <th>Committed</th>
          <th>Function</th>
          <th>Invoker</th>
          <th>Endorsed by</th>
          <th>Status</th>
          <th>Tx</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow cols={8}>No committed versions.</EmptyRow>}
        {rows.map((r) => (
          <tr key={r.txId}>
            <td className="font-mono">v{r.version}</td>
            <td className="font-mono">{r.blockNumber ?? '—'}</td>
            <td className="font-mono">{feedTime(r.timestamp)}</td>
            <td className="font-mono">{(r.fn ?? '?').split(':').pop()}</td>
            <td className="font-mono">{r.creator?.entityId ?? r.creator?.name ?? '—'}</td>
            <td>
              <EndorsementBadges endorsers={r.endorsers} />
            </td>
            <td className="font-mono">{String((r.value as { status?: string } | null)?.status ?? '')}</td>
            <td className="whitespace-nowrap font-mono">{shortHash(r.txId)}</td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

function TxTable({ txs, title }: { txs: ExplorerTx[]; title: string }) {
  return (
    <TableCard title={title}>
      <thead>
        <tr>
          <th>Block</th>
          <th>Time</th>
          <th>Function</th>
          <th>Invoker</th>
          <th>Endorsed by</th>
          <th>Validation</th>
          <th>Tx</th>
        </tr>
      </thead>
      <tbody>
        {txs.length === 0 && <EmptyRow cols={7}>No transactions.</EmptyRow>}
        {txs.map((t) => (
          <tr key={t.txId}>
            <td className="font-mono">{t.blockNumber}</td>
            <td className="font-mono">{feedTime(t.timestamp)}</td>
            <td className="font-mono">{t.fn}</td>
            <td className="font-mono">{t.creator.entityId ?? t.creator.name} · {t.creator.mspId.replace('MSP', '')}</td>
            <td>
              <EndorsementBadges endorsers={t.endorsers} />
            </td>
            <td>{t.validationCode === 'VALID' ? <Chip tone="green">VALID</Chip> : <Chip tone="red" mono>{t.validationCode}</Chip>}</td>
            <td className="whitespace-nowrap font-mono">
              <Link to={`/regulator/explorer?q=${t.txId}`}>{shortHash(t.txId)}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

export function RegulatorExplorer() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);
  const result = useQuery({ queryKey: ['explorer-search', q], queryFn: () => api.get<SearchResult>(`/explorer/search?q=${encodeURIComponent(q)}`), enabled: !!q, retry: false });
  const rejected = useExplorerTxs('rejected', 100);
  const recent = useExplorerTxs(undefined, 25);
  const keyOf = result.data?.kind === 'key' ? result.data.key : null;
  const rejectedForKey = (rejected.data?.txs ?? []).filter((t) => (keyOf ? t.writes.some((w) => w.key === keyOf) : !q));
  const examples = (recent.data?.txs ?? []).flatMap((t) => t.writes.map((w) => w.key)).filter((k, i, a) => a.indexOf(k) === i && !k.startsWith('policyParams')).slice(0, 3);
  return (
    <>
      <PageHeader eyebrow="Tamper evidence" title="Ledger explorer" />
      <form
        role="search"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(input ? { q: input.trim() } : {});
        }}
      >
        <label className="field min-w-[280px] flex-1">
          Key, tx ID or block number
          <input className="input font-mono" type="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder="receipt~WRT-WH001-000001" />
        </label>
        <Button type="submit" size="form">
          Look up history
        </Button>
      </form>
      {examples.length > 0 && (
        <p className="m-0 text-[13px] text-muted">
          Try:{' '}
          {examples.map((k) => (
            <Link key={k} to={`/regulator/explorer?q=${encodeURIComponent(k)}`} className="mr-3 font-mono">
              {k}
            </Link>
          ))}
        </p>
      )}
      {rejectedForKey.slice(0, keyOf ? 5 : 3).map((t) => (
        <Rejected key={t.txId} tx={t} />
      ))}
      {q ? (
        <Async q={result} what={`searching ${q}`}>
          {(r) =>
            r.kind === 'key' ? (
              <History keyLabel={r.key} rows={r.history} />
            ) : r.kind === 'tx' ? (
              <>
                {r.tx.validationCode !== 'VALID' && <Rejected tx={r.tx} />}
                <TxTable txs={[r.tx]} title={`Transaction ${shortHash(r.tx.txId)}`} />
                <Section title="Writes">
                  <pre className="m-0 overflow-x-auto font-mono text-[12px]">{JSON.stringify(r.tx.writes, null, 2)}</pre>
                </Section>
              </>
            ) : (
              <TxTable txs={r.txs} title={`Block ${r.block}`} />
            )
          }
        </Async>
      ) : (
        <Async q={recent} what="reading blocks">
          {(r) => <TxTable txs={r.txs} title={`Latest transactions · height ${r.height}`} />}
        </Async>
      )}
    </>
  );
}
