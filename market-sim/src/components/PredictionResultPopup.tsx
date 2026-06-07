import { formatMoney } from '../utils/finance';

type Props = {
  bestFundSymbol: string;
  worstFundSymbol: string;
  bestCorrect: boolean;
  worstCorrect: boolean;
  bonusCents: bigint;
  onClose: () => void;
};

export function PredictionResultPopup({
  bestFundSymbol,
  worstFundSymbol,
  bestCorrect,
  worstCorrect,
  bonusCents,
  onClose,
}: Props) {
  const bothCorrect = bestCorrect && worstCorrect;
  const anyCorrect = bestCorrect || worstCorrect;

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="popup-card" onClick={e => e.stopPropagation()}>
        <h2>{bothCorrect ? 'Perfect prediction!' : anyCorrect ? 'Partially correct!' : 'Better luck tomorrow'}</h2>
        <div className="popup-results">
          <div className="popup-pick">
            <span className="muted">Best fund pick</span>
            <strong>
              {bestFundSymbol} {bestCorrect ? <span className="gain">Correct</span> : <span className="loss">Wrong</span>}
            </strong>
          </div>
          <div className="popup-pick">
            <span className="muted">Worst fund pick</span>
            <strong>
              {worstFundSymbol} {worstCorrect ? <span className="gain">Correct</span> : <span className="loss">Wrong</span>}
            </strong>
          </div>
        </div>
        {bonusCents > 0n && (
          <p className="popup-bonus">+{formatMoney(bonusCents)} bonus earned</p>
        )}
        <button onClick={onClose} type="button">Got it</button>
      </div>
    </div>
  );
}
