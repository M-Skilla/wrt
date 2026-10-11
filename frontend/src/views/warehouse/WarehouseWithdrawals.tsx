/** Screen 11: withdrawals to confirm. Gate-pass no. is required before ConfirmRelease. */
import type { WarehouseReceipt } from '@wrt/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckRow } from '../../components/ledger';
import { Button, Chip, EmptyRow, EmptyState, Mono, PageHeader, StatusChip, TableCard } from '../../components/ui';
import { api } from '../../lib/api';
import { bpPct, commodity, date, dateTime, kg } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useFarmerPII, useReceipts } from '../../lib/queries';
import { useTx } from '../../lib/tx';
import { Field } from '../../modals/Modals';

function Request({ r, warehouse }: { r: WarehouseReceipt; warehouse: string }) {
  const pii = useFarmerPII(r.holderFarmerId);
  const tx = useTx();
  const [gatePass, setGatePass] = useState('');
  return (
    <section className="card grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div className="flex flex-col gap-3">
        <div>
          <Chip>Requested {dateTime(r.withdrawalRequestedAt)}</Chip>
        </div>
        <Link to={`/receipts/${r.id}`} className="font-mono text-[18px] font-semibold">
          {r.id}
        </Link>
        <div className="grid grid-cols-3 gap-3 text-[13px]">
          <div>
            <div className="eyebrow">Holder</div>
            <div>{pii.data?.fullName}</div>
            <div className="font-mono text-muted">{r.holderFarmerId}</div>
          </div>
          <div>
            <div className="eyebrow">Commodity</div>
            <div>
              {commodity(r.commodity)} {r.grade}
            </div>
            <div className="font-mono text-muted">{bpPct(r.moistureBp)} moisture</div>
          </div>
          <div>
            <div className="eyebrow">Release</div>
            <div className="font-mono text-[16px] font-semibold">{kg(r.netKg)}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="eyebrow mb-1">Chaincode checks</div>
        <CheckRow state={r.status === 'ISSUED' ? 'pass' : 'fail'}>Status {r.status}</CheckRow>
        <CheckRow state={!r.lien ? 'pass' : 'fail'}>No lien on receipt</CheckRow>
        <CheckRow state={!r.activeDisputeId ? 'pass' : 'fail'}>No open dispute</CheckRow>
        <div className="mt-2">
          <Field label="Gate pass / release note no.">
            <input className="input font-mono" value={gatePass} onChange={(e) => setGatePass(e.target.value)} placeholder="KGS-GP-26-1142" />
          </Field>
        </div>
      </div>
      <div className="flex flex-col items-stretch justify-end gap-2">
        <Button
          variant="accent"
          size="form"
          disabledReason={!gatePass && 'Enter the gate pass number first'}
          disabled={tx.pending}
          onClick={() => void tx.run(() => api.post(`/receipts/${r.id}/release`, { gatePassNo: gatePass }), () => `${r.id} REDEEMED.`)}
        >
          Confirm release
        </Button>
        <span className="hint">
          Signs <Mono>ConfirmRelease</Mono> as {warehouse}
        </span>
      </div>
    </section>
  );
}

export function WarehouseWithdrawals() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const issued = useReceipts({ warehouseId: id, status: 'ISSUED' }, !!id);
  const redeemed = useReceipts({ warehouseId: id, status: 'REDEEMED' }, !!id);
  const requests = (issued.data ?? []).filter((r) => r.withdrawalRequestedAt);
  return (
    <>
      <PageHeader
        eyebrow="Physical release"
        title="Withdrawals to confirm"
        sub="The farmer has requested their crop back. Confirm only after the goods physically leave the store. The receipt then becomes REDEEMED and cannot be pledged again."
      />
      {requests.length === 0 && !issued.isLoading && <EmptyState title="No withdrawals waiting">Farmers request withdrawals from their receipts page; requests appear here for physical release.</EmptyState>}
      {requests.map((r) => (
        <Request key={r.id} r={r} warehouse={id ?? ''} />
      ))}
      <TableCard title="Recently released">
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Holder</th>
            <th>Commodity</th>
            <th className="r">kg</th>
            <th>Gate pass</th>
            <th>Confirmed</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(redeemed.data ?? []).length === 0 && <EmptyRow cols={7}>None yet.</EmptyRow>}
          {(redeemed.data ?? []).map((r) => (
            <tr key={r.id}>
              <td className="font-mono">
                <Link to={`/receipts/${r.id}`}>{r.id}</Link>
              </td>
              <td className="font-mono">{r.holderFarmerId}</td>
              <td>
                {commodity(r.commodity)} {r.grade}
              </td>
              <td className="r font-mono">{r.netKg.toLocaleString('en-US')}</td>
              <td className="font-mono">{r.release?.gatePassNo}</td>
              <td className="font-mono">{date(r.release?.releasedAt)}</td>
              <td>
                <StatusChip domain="receipt" status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </>
  );
}
