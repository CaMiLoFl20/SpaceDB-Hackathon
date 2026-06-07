import { type FormEvent } from 'react';
import { formatMoney } from '../utils/finance';
import type { FundMarketItem } from './FundMarketTable';

export function TradeTicket({
  activeFund,
  shares,
  submitting,
  tradesAllowed,
  error,
  onSharesChange,
  onTrade,
}: {
  activeFund: FundMarketItem | undefined;
  shares: string;
  submitting: boolean;
  tradesAllowed: boolean;
  error: string;
  onSharesChange: (value: string) => void;
  onTrade: (side: 'buy' | 'sell') => void;
}) {
  const submit = (side: 'buy' | 'sell') => (event: FormEvent) => {
    event.preventDefault();
    onTrade(side);
  };

  return (
    <article className="panel">
      <h2>Trade fund shares</h2>
      {activeFund ? (
        <div className="trade-context">
          <strong>{activeFund.name}</strong>
          <span className="muted">{activeFund.symbol} @ {formatMoney(activeFund.priceCents)}</span>
        </div>
      ) : (
        <p className="muted">Select a fund from the market.</p>
      )}
      <form className="trade-ticket" onSubmit={submit('buy')}>
        <label>
          Shares
          <input inputMode="numeric" onChange={event => onSharesChange(event.target.value)} value={shares} />
        </label>
        <div className="button-row">
          <button disabled={!activeFund || submitting || !tradesAllowed} type="submit">Buy</button>
          <button className="danger-button" disabled={!activeFund || submitting || !tradesAllowed} onClick={submit('sell')} type="button">Sell</button>
        </div>
        {!tradesAllowed && <p className="muted">Trading is frozen until the next day starts.</p>}
        {error && <p className="error-text">{error}</p>}
      </form>
    </article>
  );
}
