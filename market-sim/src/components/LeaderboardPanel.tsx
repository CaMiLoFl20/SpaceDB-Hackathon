import { Identity } from 'spacetimedb';
import { formatMoney } from '../utils/finance';

export type LeaderboardEntry = {
  owner: Identity;
  name: string;
  balanceCents: bigint;
  estimatedPortfolioValueCents: bigint;
};

export function sortLeaderboard(rows: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return [...rows].sort((left, right) => {
    const valueDiff = right.estimatedPortfolioValueCents - left.estimatedPortfolioValueCents;
    if (valueDiff > 0n) return 1;
    if (valueDiff < 0n) return -1;
    return left.name.localeCompare(right.name);
  });
}

export function LeaderboardPanel({
  rows,
  identity,
}: {
  rows: readonly LeaderboardEntry[];
  identity: Identity | undefined;
}) {
  const topRows = sortLeaderboard(rows).slice(0, 10);
  return (
    <article className="panel">
      <h2>Leaderboard</h2>
      {topRows.length === 0 ? (
        <p className="muted">No ranked players yet.</p>
      ) : (
        <ol className="leaderboard-list leaderboard-list--ranked">
          {topRows.map((entry, index) => (
            <li key={entry.owner.toHexString()}>
              <span className="rank-pill">#{index + 1}</span>
              <div className="leaderboard-entry">
                <div>
                  <strong>{entry.name}</strong>
                  {identity?.isEqual(entry.owner) && <span className="you-badge">You</span>}
                </div>
                <div className="muted">Cash {formatMoney(entry.balanceCents)}</div>
              </div>
              <strong className="leaderboard-value">
                {formatMoney(entry.estimatedPortfolioValueCents)}
              </strong>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
