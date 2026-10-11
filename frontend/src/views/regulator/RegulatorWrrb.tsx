/** Screen 23: WRRB registration queue with an inline WRRB-number input per row. */
import type { WarehouseReceipt } from '@wrt/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Callout, EmptyRow, Mono, PageHeader, TableCard } from '../../components/ui';
import { api } from '../../lib/api';
import { commodity, feedTime } from '../../lib/format';
import { useDeposits, useReceipts, useWarehouses } from '../../lib/queries';
import { useTx } from '../../lib/tx';

function QueueRow({ r, licence, attestedBy }: { r: WarehouseReceipt; licence: string; attestedBy?: string | undefined }) {
  const tx = useTx();
  const prefix = `WRRB/${licence.split('/')[2] ?? 'TZ'}/${new Date().getFullYear()}/`;
  const [no, setNo] = useState(prefix);
  return (
    <tr>
      <td className="font-mono">
        <Link to={`/receipts/${r.id}`}>{r.id}</Link>
      </td>
      <td>
        {r.warehouseId} · <Mono>{licence.split('/').slice(2).join('/')}</Mono>
      </td>
      <td>
        {commodity(r.commodity)} {r.grade}
      </td>
      <td className="r font-mono">{r.netKg.toLocaleString('en-US')}</td>
      <td className="font-mono">{attestedBy ?? '—'}</td>
      <td className="font-mono">{feedTime(r.issuedAt)}</td>
      <td>
        <label className="sr-only" htmlFor={`wrrb-${r.id}`}>
          WRRB number for {r.id}
        </label>
        <input id={`wrrb-${r.id}`} className="input min-h-[36px] min-w-[200px] font-mono" value={no} onChange={(e) => setNo(e.target.value)} />
      </td>
      <td className="r">
        <Button
          size="sm"
          disabledReason={no.length <= prefix.length && 'Enter the WRRB receipt number'}
          disabled={tx.pending}
          onClick={() => void tx.run(() => api.post(`/receipts/${r.id}/wrrb`, { wrrbReceiptNo: no }), () => `${r.id} WRRB_REGISTERED.`)}
        >
          Register
        </Button>
      </td>
    </tr>
  );
}

export function RegulatorWrrb() {
  const queue = useReceipts({ legal_status: 'PENDING_WRRB', status: 'ISSUED,PLEDGED,UNDER_DISPUTE' });
  const warehouses = useWarehouses();
  const deposits = useDeposits({ status: 'ATTESTED' });
  const licence = (w: string) => warehouses.data?.find((x) => x.id === w)?.licenseNo ?? '';
  const attestedBy = (depositId: string) => deposits.data?.find((d) => d.id === depositId)?.attestation?.inspectorId;
  const list = (queue.data ?? []).slice().sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  return (
    <>
      <PageHeader eyebrow="Legal anchoring" title="WRRB registration queue" />
      <Callout tone="ink" tag="GATE">
        A receipt cannot be pledged until you record its WRRB receipt number. WRT does not create a new title; it anchors the receipt the Warehouse Receipts Regulatory Board recognises. Exact legal standing
        under the WRS Act 2005 to be confirmed with WRRB.
      </Callout>
      <TableCard>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Warehouse · licence</th>
            <th>Commodity</th>
            <th className="r">Net kg</th>
            <th>Attested by</th>
            <th>Issued</th>
            <th>WRRB receipt no.</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && <EmptyRow cols={8}>{queue.isLoading ? 'Loading…' : 'Queue empty: every live receipt is registered.'}</EmptyRow>}
          {list.map((r) => (
            <QueueRow key={r.id} r={r} licence={licence(r.warehouseId)} attestedBy={attestedBy(r.depositId)} />
          ))}
        </tbody>
      </TableCard>
      <p className="m-0 text-[13px] text-muted">
        Each registration signs <Mono>RecordWrrbRegistration</Mono> as REG-01 and is visible to every org on the channel.
      </p>
    </>
  );
}
