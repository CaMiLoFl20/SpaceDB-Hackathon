import { formatMoney } from '../utils/finance';

export function ManagerActivity({
  minds,
  trades,
}: {
  minds: readonly {
    traderName: string;
    rank: bigint;
    portfolioValueCents: bigint;
    lastActionSummary: string;
    lastDecisionSource: string;
  }[];
  trades: readonly {
    id: bigint;
    traderName: string;
    side: string;
    shares: bigint;
    symbol: string;
    priceCents: bigint;
    totalCents: bigint;
    createdAt: { toDate: () => Date };
  }[];
}) {
  return (
    <article className="panel manager-panel">
      <h2>Fund manager tape</h2>
      <div className="manager-grid">
        {minds.map(mind => (
          <div className="manager-card" key={mind.traderName}>
            <strong>{mind.traderName}</strong>
            <span className="muted">Rank #{mind.rank.toString()} · {formatMoney(mind.portfolioValueCents)}</span>
            <span>{mind.lastActionSummary === 'none' ? 'Waiting for a trade' : mind.lastActionSummary}</span>
          </div>
        ))}
      </div>
      <div className="activity-log">
        {trades.length === 0 ? (
          <p className="muted">{'> waiting for fund manager trades...'}</p>
        ) : (
          trades.slice(-40).map(trade => (
            <span key={trade.id.toString()}>
              {trade.createdAt.toDate().toLocaleTimeString()}  {trade.traderName}  {trade.side.toUpperCase()} {trade.shares.toString()} {trade.symbol} @ {formatMoney(trade.priceCents)} ({formatMoney(trade.totalCents)})
              {'\n'}
            </span>
          ))
        )}
      </div>
    </article>
  );
}
