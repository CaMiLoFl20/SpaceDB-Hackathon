export type MarketClockItem = {
  dayIndex: bigint;
  phase: string;
  currentGameTimeLabel: string;
  secondsUntilClose: bigint;
  secondsUntilNextDay: bigint;
  tradesAllowed: boolean;
  predictionsAllowed: boolean;
};

export type DaySummaryItem = {
  dayIndex: bigint;
  bestFundSymbol: string;
  worstFundSymbol: string;
  bestFundReturnBps: bigint;
  worstFundReturnBps: bigint;
  topPlayerName: string;
  topPlayerValueCents: bigint;
};

type FundNameLookup = { symbol: string; name: string };

function formatBps(bps: bigint): string {
  const pct = Number(bps) / 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function fundLabel(symbol: string, funds: FundNameLookup[]): string {
  const fund = funds.find(f => f.symbol === symbol);
  return fund ? fund.name : symbol;
}

function formatCents(cents: bigint): string {
  return `$${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MarketClockBanner({
  clock,
  daySummary,
  funds = [],
}: {
  clock: MarketClockItem | undefined;
  daySummary?: DaySummaryItem;
  funds?: FundNameLookup[];
}) {
  if (!clock) return null;
  const isFrozen = clock.phase === 'frozen';
  const isResults = clock.phase === 'results';
  const isWarning = clock.phase === 'closing_warning';

  if (isResults && daySummary) {
    return (
      <section className="clock-banner clock-banner--results">
        <div>
          <span className="muted">Day {daySummary.dayIndex.toString()} results</span>
          <strong>Market closed</strong>
        </div>
        <div>
          <span className="muted">Best fund</span>
          <strong className="gain">
            {fundLabel(daySummary.bestFundSymbol, funds)} ({formatBps(daySummary.bestFundReturnBps)})
          </strong>
        </div>
        <div>
          <span className="muted">Worst fund</span>
          <strong className="loss">
            {fundLabel(daySummary.worstFundSymbol, funds)} ({formatBps(daySummary.worstFundReturnBps)})
          </strong>
        </div>
        <div>
          <span className="muted">Top player</span>
          <strong>{daySummary.topPlayerName || '—'} ({formatCents(daySummary.topPlayerValueCents)})</strong>
        </div>
        <p>Next trading day starts in {clock.secondsUntilNextDay.toString()}s</p>
      </section>
    );
  }

  return (
    <section className={`clock-banner ${isFrozen ? 'clock-banner--frozen' : isWarning ? 'clock-banner--warning' : ''}`}>
      <div>
        <span className="muted">Trading day {clock.dayIndex.toString()}</span>
        <strong>{clock.currentGameTimeLabel}</strong>
      </div>
      <div>
        <span className="muted">Market status</span>
        <strong>{isFrozen ? 'Frozen' : isWarning ? 'Closing soon' : 'Open'}</strong>
      </div>
      <div>
        <span className="muted">{isFrozen ? 'Next day starts in' : 'Close in'}</span>
        <strong>
          {isFrozen
            ? `${clock.secondsUntilNextDay.toString()}s`
            : `${clock.secondsUntilClose.toString()}s`}
        </strong>
      </div>
      <p>
        {isFrozen
          ? 'Trading is frozen while the day settles.'
          : isWarning
            ? 'Trading day ending soon. Positions and predictions settle at close.'
            : clock.predictionsAllowed
              ? 'Prediction window is open.'
              : 'Prediction window is closed; trading remains open.'}
      </p>
    </section>
  );
}
