import {
  GAIN_COLOR,
  LOSS_COLOR,
  formatBpsPercent,
  formatMoney,
  formatPriceChangePercent,
} from '../utils/finance';
import type { FundMarketItem } from './FundMarketTable';

export type FundConstituentItem = {
  fundSymbol: string;
  fundName: string;
  symbol: string;
  name: string;
  shares: bigint;
  priceCents: bigint;
  dayOpenPriceCents: bigint;
  valueCents: bigint;
  weightBps: bigint;
};

export function FundConstituentsPanel({
  activeFund,
  constituents,
}: {
  activeFund: FundMarketItem | undefined;
  constituents: readonly FundConstituentItem[];
}) {
  const visible = activeFund
    ? constituents.filter(row => row.fundSymbol === activeFund.symbol)
    : [];

  return (
    <article className="panel fund-research-panel">
      <div className="panel-header">
        <div>
          <h2>Fund holdings</h2>
          <p className="muted">Research the underlying stocks before placing a fund order.</p>
        </div>
      </div>

      {!activeFund ? (
        <p className="muted">Select a fund to see its holdings.</p>
      ) : visible.length === 0 ? (
        <p className="muted">{activeFund.name} has not disclosed active stock positions yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table compact-table">
          <thead>
            <tr>
              <th align="left">Stock</th>
              <th align="right">Price</th>
              <th align="right">Day</th>
              <th align="right">Shares</th>
              <th align="right">Weight</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              const up = row.priceCents >= row.dayOpenPriceCents;
              return (
                <tr key={`${row.fundSymbol}-${row.symbol}`}>
                  <td>
                    <strong>{row.symbol}</strong>
                    <div className="muted">{row.name}</div>
                  </td>
                  <td align="right">
                    {formatMoney(row.priceCents)}
                    <div className="muted">{formatMoney(row.valueCents)}</div>
                  </td>
                  <td align="right" style={{ color: up ? GAIN_COLOR : LOSS_COLOR }}>
                    {up ? '▲' : '▼'} {formatPriceChangePercent(row.priceCents, row.dayOpenPriceCents)}
                  </td>
                  <td align="right">{row.shares.toLocaleString()}</td>
                  <td align="right">{formatBpsPercent(row.weightBps)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </article>
  );
}
