import { formatMoney, formatPriceChangePercent, GAIN_COLOR, LOSS_COLOR } from '../utils/finance';

export type FundMarketItem = {
  symbol: string;
  name: string;
  kind: string;
  riskProfile: string;
  availableShares: bigint;
  priceCents: bigint;
  dayOpenPriceCents: bigint;
  navCents: bigint;
};

export function FundMarketTable({
  funds,
  selectedSymbol,
  onSelect,
}: {
  funds: readonly FundMarketItem[];
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}) {
  if (funds.length === 0) return <p className="muted">No funds listed yet.</p>;

  return (
    <div className="table-scroll">
      <table className="data-table">
      <thead>
        <tr>
          <th align="left">Fund</th>
          <th align="right">Price</th>
          <th align="right">Day</th>
          <th align="right">Float</th>
        </tr>
      </thead>
      <tbody>
        {funds.map(fund => {
          const up = fund.priceCents >= fund.dayOpenPriceCents;
          return (
            <tr
              className={fund.symbol === selectedSymbol ? 'selected-row' : ''}
              key={fund.symbol}
              onClick={() => onSelect(fund.symbol)}
            >
              <td>
                <strong>{fund.name}</strong>
                <div className="muted">{fund.symbol}</div>
              </td>
              <td align="right">{formatMoney(fund.priceCents)}</td>
              <td align="right" style={{ color: up ? GAIN_COLOR : LOSS_COLOR }}>
                {up ? '▲' : '▼'} {formatPriceChangePercent(fund.priceCents, fund.dayOpenPriceCents)}
              </td>
              <td align="right">{fund.availableShares.toLocaleString()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
