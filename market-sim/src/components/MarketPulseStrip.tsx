import {
  GAIN_COLOR,
  LOSS_COLOR,
  formatBpsPercent,
  formatPriceChangePercent,
} from '../utils/finance';
import { stockMoveBps, topStockMovers } from '../utils/gamification';
import type { MarketClockItem } from './MarketClockBanner';

export type StockMarketItem = {
  symbol: string;
  name: string;
  priceCents: bigint;
  dayOpenPriceCents: bigint;
};

export type KeyArticleItem = {
  id: bigint;
  symbol: string;
  sentiment: string;
  headline: string;
  shockBps: bigint;
};

export function MarketPulseStrip({
  stocks,
  clock,
  keyArticle,
  affectedFunds,
  soundEnabled,
  onToggleSound,
}: {
  stocks: readonly StockMarketItem[];
  clock: MarketClockItem | undefined;
  keyArticle: KeyArticleItem | undefined;
  affectedFunds: readonly string[];
  soundEnabled: boolean;
  onToggleSound: () => void;
}) {
  const movers = topStockMovers(stocks, 3);
  const affectedFundsText = affectedFunds.join(', ');

  return (
    <section className="market-pulse-strip">
      <div className="pulse-group">
        <span className="pulse-label">Movers</span>
        {movers.length === 0 ? (
          <span className="muted">No stock data</span>
        ) : (
          movers.map(stock => {
            const move = stockMoveBps(stock);
            const up = move >= 0n;
            return (
              <span className="pulse-chip" key={stock.symbol}>
                <strong>{stock.symbol}</strong>
                <span style={{ color: up ? GAIN_COLOR : LOSS_COLOR }}>
                  {formatPriceChangePercent(stock.priceCents, stock.dayOpenPriceCents)}
                </span>
              </span>
            );
          })
        )}
      </div>

      <div className={`pulse-group ${keyArticle ? 'pulse-alert' : ''}`}>
        <span className="pulse-label">Article</span>
        {keyArticle ? (
          <>
            <strong>{keyArticle.symbol}</strong>
            <span>{keyArticle.sentiment}</span>
            <span>{formatBpsPercent(keyArticle.shockBps)}</span>
            {affectedFunds.length > 0 && (
              <span className="muted pulse-truncate" title={`Affects ${affectedFundsText}`}>
                Affects {affectedFundsText}
              </span>
            )}
          </>
        ) : (
          <span className="muted">No shock article today</span>
        )}
      </div>

      <div className="pulse-group pulse-clock">
        <span className="pulse-label">Clock</span>
        <strong>{clock?.currentGameTimeLabel ?? '--'}</strong>
        <span>{clock ? `${clock.secondsUntilClose.toString()}s to close` : 'Waiting'}</span>
      </div>

      <button className="secondary-button sound-toggle" onClick={onToggleSound} type="button">
        Sound {soundEnabled ? 'on' : 'off'}
      </button>
    </section>
  );
}
