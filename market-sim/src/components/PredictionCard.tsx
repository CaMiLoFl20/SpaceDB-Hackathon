import { useMemo, useState } from 'react';
import { formatMoney } from '../utils/finance';
import type { FundMarketItem } from './FundMarketTable';

export function PredictionCard({
  funds,
  prediction,
  predictionsAllowed,
  submitting,
  error,
  onSubmit,
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

  return (
    <article className="panel">
      <h2>Daily prediction</h2>
      <p className="muted">Pick the best and worst performing funds before 10:30 AM game time. Correct picks pay cash bonuses at close.</p>
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
    </article>
  );
}
