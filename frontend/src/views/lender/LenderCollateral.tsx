/** Screen 15: eligible collateral. Lists only receipts that pass every OfferLoan precondition. */
import type { WarehouseReceipt } from '@wrt/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Chip, EmptyRow, PageHeader, TableCard } from '../../components/ui';
import { useEligibleCollateral } from '../../lib/derive';
import { ago, commodity, parseWhole, shortDate, tzs } from '../../lib/format';
import { useIdentity } from '../../lib/identity';
import { useLoans, usePolicy, usePrices, useWarehouses } from '../../lib/queries';
import { MakeOfferModal } from '../../modals/Modals';

export function LenderCollateral() {
  const { me } = useIdentity();
  const id = me?.chaincodeView.entityId ?? undefined;
  const eligible = useEligibleCollateral();
  const prices = usePrices();
  const policy = usePolicy();
  const warehouses = useWarehouses();
  const myOffers = useLoans({ lenderId: id, status: 'OFFERED' }, !!id);
  const [filters, setFilters] = useState({ commodity: '', warehouse: '', min: '', sort: 'max' });
  const [offer, setOffer] = useState<{ r: WarehouseReceipt; value: number } | null>(null);
  const maxLtv = policy.data?.maxLtvBp ?? 6000;
  const rows = useMemo(() => {
    const min = parseWhole(filters.min) ?? 0;
    return (eligible.data ?? [])
      .map((r) => {
        const price = prices.data?.find((p) => p.commodity === r.commodity && p.grade === r.grade)?.priceTzsPerKg ?? 0;
        const value = r.netKg * price;
        return { r, value, maxLoan: Math.floor((value * maxLtv) / 10_000) };
      })
      .filter((x) => (!filters.commodity || x.r.commodity === filters.commodity) && (!filters.warehouse || x.r.warehouseId === filters.warehouse) && x.value >= min)
      .sort((a, b) => (filters.sort === 'max' ? b.maxLoan - a.maxLoan : a.r.expiresAt.localeCompare(b.r.expiresAt)));
  }, [eligible.data, prices.data, filters, maxLtv]);
  const commodities = [...new Set((prices.data ?? []).map((p) => p.commodity))].sort();
  const pending = new Set((myOffers.data ?? []).map((l) => l.receiptId));
  const whName = (wid: string) => warehouses.data?.find((w) => w.id === wid)?.name.split(' ')[0] ?? wid;
  return (
    <>
      <PageHeader
        eyebrow="Lender"
        title="Eligible collateral"
        sub="Only receipts the chaincode would accept appear here: issued, WRRB-registered, unexpired, unpledged, no open dispute, warehouse active."
      />
      <div className="flex flex-wrap gap-3">
        <label className="field min-w-[150px]">
          Commodity
          <select className="input" value={filters.commodity} onChange={(e) => setFilters({ ...filters, commodity: e.target.value })}>
            <option value="">All</option>
            {commodities.map((c) => (
              <option key={c} value={c}>
                {commodity(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="field min-w-[180px]">
          Warehouse
          <select className="input" value={filters.warehouse} onChange={(e) => setFilters({ ...filters, warehouse: e.target.value })}>
            <option value="">All warehouses</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.id} {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field min-w-[150px]">
          Min. value (TZS)
          <input className="input font-mono" value={filters.min} onChange={(e) => setFilters({ ...filters, min: e.target.value })} placeholder="0" />
        </label>
        <label className="field min-w-[190px]">
          Sort
          <select className="input" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
            <option value="max">Max loan, high → low</option>
            <option value="expiry">Expiry, soonest</option>
          </select>
        </label>
      </div>
      <TableCard>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Warehouse</th>
            <th>Holder</th>
            <th>Commodity</th>
            <th className="r">Net kg</th>
            <th className="r">Value (TZS)</th>
            <th className="r">Max loan @ {maxLtv / 100}%</th>
            <th>Last check</th>
            <th>Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={10}>{eligible.isLoading ? 'Loading…' : 'No eligible receipts match.'}</EmptyRow>}
          {rows.map(({ r, value, maxLoan }) => (
            <tr key={r.id}>
              <td className="font-mono">
                <Link to={`/receipts/${r.id}`}>{r.id}</Link>
              </td>
              <td>
                {whName(r.warehouseId)} <span className="font-mono text-muted">{r.warehouseId}</span>
              </td>
              <td className="font-mono">{r.holderFarmerId}</td>
              <td>
                {commodity(r.commodity)} {r.grade}
              </td>
              <td className="r font-mono">{r.netKg.toLocaleString('en-US')}</td>
              <td className="r font-mono">{tzs(value)}</td>
              <td className="r font-mono">{tzs(maxLoan)}</td>
              <td className="font-mono">{ago(r.lastQualityCheckAt)}</td>
              <td className="font-mono">{shortDate(r.expiresAt)}</td>
              <td className="r">{pending.has(r.id) ? <Chip dot={false}>Your offer pending</Chip> : <Button size="sm" onClick={() => setOffer({ r, value })}>Make offer</Button>}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
      <p className="m-0 text-[13px] text-muted">Values = net kg × illustrative reference price set by the regulator. Farmer identities show as IDs; names appear once you make an offer.</p>
      {offer && <MakeOfferModal open onClose={() => setOffer(null)} receipt={offer.r} collateralTzs={offer.value} />}
    </>
  );
}
