/** Screen 12: farmer's receipts. Plain-language copy; yellow banner when an offer is pending. */
import type { WarehouseReceipt } from '@wrt/shared';
import { Link } from 'react-router-dom';
import { Button, EmptyState, LinkButton, PageHeader, StatusChip } from '../../components/ui';
import { api } from '../../lib/api';
import { bpPct, commodity, kg, shortDate, tzs, tzsShort } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useFarmerPII, useLenders, useLoans, usePrices, useReceipts } from '../../lib/queries';
import { useTx } from '../../lib/tx';

function ReceiptCard({ r, price, outstanding, offers }: { r: WarehouseReceipt; price: number | null; outstanding: number | null; offers: number }) {
  const tx = useTx();
  const value = price ? r.netKg * price : null;
  const closed = ['REDEEMED', 'LIQUIDATED', 'CANCELLED'].includes(r.status);
  const message = (() => {
    if (r.status === 'PLEDGED') return <>Locked as collateral. It unlocks by itself when you finish repaying <b className="font-mono">{tzs(outstanding)}</b> TZS.</>;
    if (r.status === 'UNDER_DISPUTE') return <>Frozen while the regulator looks at a dispute. Nothing can happen to it until they rule.</>;
    if (r.status === 'DEFAULTED') return <>The loan was not repaid in time. The lender may sell the crop; anything above what you owe comes back to you.</>;
    if (r.status === 'REDEEMED') return <>Crop collected. Gate pass <span className="font-mono">{r.release?.gatePassNo}</span>. Kept here for your history.</>;
    if (r.status === 'LIQUIDATED') return <>Sold to repay the loan. Any surplus was paid to you.</>;
    if (r.status === 'CANCELLED') return <>Cancelled by the regulator after a dispute.</>;
    if (r.withdrawalRequestedAt) return <>You asked for your crop back. The warehouse will confirm when it leaves the store.</>;
    if (r.legal.status !== 'WRRB_REGISTERED') return <>Waiting for the regulator to register it. After that you can use it to borrow.</>;
    return offers ? <>{offers} loan offer{offers > 1 ? 's' : ''} waiting for your answer.</> : <>Free. You can borrow against it or collect your crop.</>;
  })();
  return (
    <article className="card flex flex-col">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <StatusChip domain="receipt" status={r.status} label={r.status === 'PLEDGED' ? `Pledged · ${r.lien?.loanId}` : r.status === 'ISSUED' ? 'Issued · free' : undefined} />
          <span className="font-mono text-[12px] text-muted">{closed ? shortDate(r.updatedAt) : `exp ${shortDate(r.expiresAt)}`}</span>
        </div>
        <div>
          <div className="text-[15px] font-bold">
            {commodity(r.commodity)} · Grade {r.grade}
          </div>
          <div className="font-mono text-[24px] font-semibold">{kg(r.netKg)}</div>
        </div>
        {!closed && (
          <div className="grid grid-cols-3 gap-2 rounded-card bg-surface-2 p-3 text-[13px]">
            <div>
              <div className="eyebrow">Value</div>
              <div className="font-mono">{tzsShort(value)}</div>
            </div>
            <div>
              <div className="eyebrow">Moisture</div>
              <div className="font-mono">{bpPct(r.moistureBp)}</div>
            </div>
            <div>
              <div className="eyebrow">WRRB</div>
              <div>{r.legal.status === 'WRRB_REGISTERED' ? 'Registered' : 'Pending'}</div>
            </div>
          </div>
        )}
        <p className="m-0 text-[13px] leading-relaxed text-muted">{message}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-3">
        <Link to={`/receipts/${r.id}`} className="font-mono text-[12px]">
          {r.id}
        </Link>
        <div className="flex gap-2">
          {r.status === 'PLEDGED' && (
            <LinkButton to={`/loans/${r.lien?.loanId}`} variant="secondary" size="sm">
              Repay loan
            </LinkButton>
          )}
          {r.status === 'ISSUED' && !r.withdrawalRequestedAt && (
            <Button
              variant="secondary"
              size="sm"
              disabled={tx.pending}
              onClick={() => void tx.run(() => api.post(`/receipts/${r.id}/withdrawal`), () => 'Withdrawal requested.')}
            >
              Request withdrawal
            </Button>
          )}
          {offers > 0 && r.status === 'ISSUED' && (
            <LinkButton to="/farmer/loans" variant="accent" size="sm">
              See offer
            </LinkButton>
          )}
        </div>
      </div>
    </article>
  );
}

export function FarmerReceipts() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const pii = useFarmerPII(id);
  const receipts = useReceipts({ holderFarmerId: id }, !!id);
  const loans = useLoans({ farmerId: id }, !!id);
  const prices = usePrices();
  const lenders = useLenders();
  const lenderName = (lid: string) => lenders.data?.find((l) => l.id === lid)?.name ?? lid;
  const priceOf = (r: WarehouseReceipt) => prices.data?.find((p) => p.commodity === r.commodity && p.grade === r.grade)?.priceTzsPerKg ?? null;
  const all = (receipts.data ?? []).slice().sort((a, b) => {
    const rank = (x: WarehouseReceipt) => (['REDEEMED', 'LIQUIDATED', 'CANCELLED'].includes(x.status) ? 1 : 0);
    return rank(a) - rank(b) || b.id.localeCompare(a.id);
  });
  const stored = all.filter((r) => ['ISSUED', 'PLEDGED', 'UNDER_DISPUTE', 'DEFAULTED'].includes(r.status));
  const offers = (loans.data ?? []).filter((l) => l.status === 'OFFERED');
  const first = offers[0];
  const firstName = pii.data?.fullName.split(' ')[0];
  return (
    <>
      <PageHeader
        eyebrow={firstName ? `Habari, ${firstName}` : 'Farmer'}
        title="My receipts"
        actions={
          <div className="flex gap-6">
            <div>
              <div className="eyebrow">Stored now</div>
              <div className="font-mono text-[20px] font-semibold">{kg(stored.reduce((s, r) => s + r.netKg, 0))}</div>
            </div>
            <div>
              <div className="eyebrow">Total value</div>
              <div className="font-mono text-[20px] font-semibold">{tzsShort(stored.reduce((s, r) => s + r.netKg * (priceOf(r) ?? 0), 0))} TZS</div>
            </div>
          </div>
        }
      />
      {first && (
        <Link to="/farmer/loans" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-tint-yellow-line bg-yellow px-4 py-3 text-ink no-underline hover:text-ink">
          <span>
            <b className="block">You have a loan offer from {lenderName(first.lenderId)}</b>
            <span className="text-[13px]">
              {tzs(first.principalTzs)} TZS against your receipt {first.receiptId} · {bpPct(first.interestBp, 2)} flat
            </span>
          </span>
          <span className="btn">Review offer</span>
        </Link>
      )}
      {all.length === 0 && !receipts.isLoading && <EmptyState title="No receipts yet">When the warehouse records your crop and an inspector checks it, your receipt appears here.</EmptyState>}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {all.map((r) => {
          const loan = r.lien ? loans.data?.find((l) => l.id === r.lien!.loanId) : undefined;
          return <ReceiptCard key={r.id} r={r} price={priceOf(r)} outstanding={loan ? loan.totalDueTzs - loan.repaidTzs : null} offers={offers.filter((o) => o.receiptId === r.id).length} />;
        })}
      </div>
      <p className="m-0 text-[13px] text-muted">Values use the regulator's illustrative reference prices. Your phone, name and ID are stored privately and are never shown to inspectors.</p>
    </>
  );
}
