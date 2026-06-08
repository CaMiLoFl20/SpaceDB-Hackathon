import { formatMoney } from '../utils/finance';
import { formatFlowBehavior } from '../utils/newsKind';

export function InstitutionalFlow({
  flows,
}: {
  flows: readonly {
    id: bigint;
    institution: string;
    symbol: string;
    side: string;
    shares: bigint;
    priceCents: bigint;
    totalCents: bigint;
    behavior: string;
    createdAt: { toDate: () => Date };
  }[];
}) {
  return (
    <article className="panel institutional-panel">
      <h2>Institutional flow</h2>
      <p className="muted">
        Background block trades from simulated desks (Atlas Pension, Titan Capital, etc.). These move
        prices and volume but are not fund-manager trades.
      </p>
      <div className="activity-log institutional-log">
        {flows.length === 0 ? (
          <p className="muted">{'> waiting for institutional flow...'}</p>
        ) : (
          flows.slice(-40).map(flow => (
            <span key={flow.id.toString()}>
              {flow.createdAt.toDate().toLocaleTimeString()}  {flow.institution}  {flow.side.toUpperCase()}{' '}
              {flow.shares.toString()} {flow.symbol} @ {formatMoney(flow.priceCents)} ({formatMoney(flow.totalCents)}) ·{' '}
              {formatFlowBehavior(flow.behavior)}
              {'\n'}
            </span>
          ))
        )}
      </div>
    </article>
  );
}
