import { useMemo, useState } from 'react';
import { formatMoney } from '../utils/finance';
import type { FundMarketItem } from './FundMarketTable';

type PredictionResult = {
  dayIndex: bigint;
  bestFundSymbol: string;
  worstFundSymbol: string;
  bestCorrect: boolean;
  worstCorrect: boolean;
  bonusCents: bigint;
  settledAt?: unknown;
};

type PredictionLeaderboardEntry = {
  name: string;
  totalPredictions: bigint;
  correctPredictions: bigint;
  accuracyPct: bigint;
  totalBonusCents: bigint;
};

export function PredictionCard({
  funds,
  prediction,
  predictionsAllowed,
  submitting,
  error,
  onSubmit,
  history = [],
  leaderboard = [],
}: {
  funds: readonly FundMarketItem[];
  prediction: {
    bestFundSymbol: string;
    worstFundSymbol: string;
    settledAt?: unknown;
    actualBestFundSymbol?: unknown;
    actualWorstFundSymbol?: unknown;
    bestCorrect: boolean;
    worstCorrect: boolean;
    bonusCents: bigint;
  } | undefined;
  predictionsAllowed: boolean;
  submitting: boolean;
  error: string;
  onSubmit: (bestFundSymbol: string, worstFundSymbol: string) => void;
  history?: readonly PredictionResult[];
  leaderboard?: readonly PredictionLeaderboardEntry[];
}) {
  const [bestFundSymbol, setBestFundSymbol] = useState('');
  const [worstFundSymbol, setWorstFundSymbol] = useState('');
  const sortedFunds = useMemo(
    () => [...funds].sort((left, right) => left.name.localeCompare(right.name)),
    [funds]
  );
  const activeBest = bestFundSymbol || sortedFunds[0]?.symbol || '';
  const activeWorst = worstFundSymbol || sortedFunds[1]?.symbol || sortedFunds[0]?.symbol || '';
  const disabled =
    !predictionsAllowed ||
    submitting ||
    prediction != null ||
    activeBest.length === 0 ||
    activeWorst.length === 0 ||
    activeBest === activeWorst;

  const settledHistory = history.filter(r => r.settledAt != null);
  const correctCount = settledHistory.reduce(
    (sum, r) => sum + (r.bestCorrect ? 1 : 0) + (r.worstCorrect ? 1 : 0),
    0
  );
  const totalChecks = settledHistory.length * 2;

  return (
    <article className="panel">
      <h2>Daily prediction</h2>
      <p className="muted">Which fund will end the day strongest? Which will fall behind? Correct picks pay cash bonuses at close.</p>
      {prediction ? (
        <div className="prediction-result">
          <strong>Submitted: {prediction.bestFundSymbol} best, {prediction.worstFundSymbol} worst</strong>
          {prediction.bonusCents > 0n || prediction.settledAt ? (
            <span>
              Result: best {prediction.bestCorrect ? '✓' : '×'}, worst {prediction.worstCorrect ? '✓' : '×'} · Bonus {formatMoney(prediction.bonusCents)}
            </span>
          ) : (
            <span className="muted">Settles at market close.</span>
          )}
        </div>
      ) : (
        <>
          <label>
            Best fund
            <select onChange={event => setBestFundSymbol(event.target.value)} value={activeBest}>
              {sortedFunds.map(fund => (
                <option key={fund.symbol} value={fund.symbol}>{fund.name}</option>
              ))}
            </select>
          </label>
          <label>
            Worst fund
            <select onChange={event => setWorstFundSymbol(event.target.value)} value={activeWorst}>
              {sortedFunds.map(fund => (
                <option key={fund.symbol} value={fund.symbol}>{fund.name}</option>
              ))}
            </select>
          </label>
          <button disabled={disabled} onClick={() => onSubmit(activeBest, activeWorst)} type="button">
            Submit prediction
          </button>
        </>
      )}
      {!predictionsAllowed && !prediction && <p className="muted">Prediction window is closed for this trading day.</p>}
      {error && <p className="error-text">{error}</p>}

      {settledHistory.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Your history ({correctCount}/{totalChecks} correct)</h3>
          <ul className="trade-list">
            {settledHistory.slice(0, 5).map(r => (
              <li key={r.dayIndex.toString()}>
                Day {r.dayIndex.toString()}: best {r.bestCorrect ? '✓' : '×'} worst {r.worstCorrect ? '✓' : '×'}
                {r.bonusCents > 0n && <span style={{ color: '#16a34a' }}> +{formatMoney(r.bonusCents)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {leaderboard.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Prediction leaderboard</h3>
          <ul className="trade-list">
            {leaderboard.map(entry => (
              <li key={entry.name}>
                <strong>{entry.name}</strong> — {entry.accuracyPct.toString()}% accuracy ({entry.correctPredictions.toString()}/{(entry.totalPredictions * 2n).toString()}) · {formatMoney(entry.totalBonusCents)} earned
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
