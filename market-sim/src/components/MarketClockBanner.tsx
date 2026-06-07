export type MarketClockItem = {
  dayIndex: bigint;
  phase: string;
  currentGameTimeLabel: string;
  secondsUntilClose: bigint;
  secondsUntilNextDay: bigint;
  tradesAllowed: boolean;
  predictionsAllowed: boolean;
};

export function MarketClockBanner({ clock }: { clock: MarketClockItem | undefined }) {
  if (!clock) return null;
  const isFrozen = clock.phase === 'frozen';
  const isWarning = clock.phase === 'closing_warning';
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
