import { GAIN_COLOR, LOSS_COLOR, formatMoney, formatReturn } from '../utils/finance';
import { MetricTile } from './MetricTile';
import type { FundMarketItem } from './FundMarketTable';

export function PortfolioSummary({
  cashBalance,
  fundHoldingsValue,
  portfolioValue,
  fundHoldings,
  funds,
}: {
  cashBalance: bigint;
  fundHoldingsValue: bigint;
  portfolioValue: bigint;
  fundHoldings: readonly { id: bigint; symbol: string; shares: bigint }[];
  funds: readonly FundMarketItem[];
}) {
  const returnPositive = portfolioValue >= 1_000_000n;
  return (
    <article className="panel">
      <h2>Portfolio</h2>
      <div className="metric-grid">
        <MetricTile label="Portfolio value" value={formatMoney(portfolioValue)} />
        <MetricTile accent={returnPositive ? GAIN_COLOR : LOSS_COLOR} label="Total return" value={formatReturn(portfolioValue)} />
        <MetricTile label="Cash" value={formatMoney(cashBalance)} />
        <MetricTile label="Fund shares" value={formatMoney(fundHoldingsValue)} />
      </div>
      {fundHoldings.length > 0 && (
        <ul className="position-list">
          {[...fundHoldings]
            .sort((left, right) => left.symbol.localeCompare(right.symbol))
            .map(holding => {
              const fund = funds.find(row => row.symbol === holding.symbol);
              const value = fund ? holding.shares * fund.priceCents : 0n;
              return (
                <li key={holding.id.toString()}>
                  <strong>{fund?.name ?? holding.symbol}</strong>
                  <span>{holding.shares.toString()} shares · {formatMoney(value)}</span>
                </li>
              );
            })}
        </ul>
      )}
    </article>
  );
}
