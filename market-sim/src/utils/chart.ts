import { STARTING_CAPITAL_CENTS, clampNonNegativeCents, formatMoney, formatReturn } from './finance';

const GAME_DAY_OPEN_MINUTE = 570n;
const GAME_MINUTES_PER_DAY = 390n;
const MAX_CHART_POINTS = 180;

export type PortfolioChartRange = 'day' | 'week' | 'month' | 'year';

export const PORTFOLIO_CHART_RANGES: Record<
  PortfolioChartRange,
  { label: string; gameMinutes: number }
> = {
  day: { label: 'Today', gameMinutes: Number(GAME_MINUTES_PER_DAY) },
  week: { label: 'Week', gameMinutes: Number(GAME_MINUTES_PER_DAY) * 7 },
  month: { label: 'Month', gameMinutes: Number(GAME_MINUTES_PER_DAY) * 30 },
  year: { label: 'Year', gameMinutes: Number(GAME_MINUTES_PER_DAY) * 365 },
};

/** Stored in `hourStartMicros` — monotonic game-session minute index from the server. */
export type PortfolioSnapshot = {
  hourStartMicros: bigint;
  portfolioValueCents: bigint;
};

export type PortfolioChartPoint = PortfolioSnapshot & {
  label: string;
};

export function gameTimelineMinuteFromClock(dayIndex: bigint, currentGameMinute: bigint): bigint {
  const minuteOffset =
    currentGameMinute > GAME_DAY_OPEN_MINUTE
      ? currentGameMinute - GAME_DAY_OPEN_MINUTE
      : 0n;
  const cappedOffset =
    minuteOffset > GAME_MINUTES_PER_DAY ? GAME_MINUTES_PER_DAY : minuteOffset;
  const dayOffset = dayIndex > 0n ? dayIndex - 1n : 0n;
  return dayOffset * GAME_MINUTES_PER_DAY + cappedOffset;
}

function formatGameClockLabel(timelineMinute: bigint): string {
  const minuteInDay = timelineMinute % GAME_MINUTES_PER_DAY;
  const gameMinute = GAME_DAY_OPEN_MINUTE + minuteInDay;
  const hour24 = gameMinute / 60n;
  const mins = gameMinute % 60n;
  const suffix = hour24 >= 12n ? 'PM' : 'AM';
  const hour12Raw = hour24 % 12n;
  const hour12 = hour12Raw === 0n ? 12n : hour12Raw;
  return `${hour12.toString()}:${mins.toString().padStart(2, '0')} ${suffix}`;
}

function chartStepGameMinutes(range: PortfolioChartRange): number {
  const minutes = PORTFOLIO_CHART_RANGES[range].gameMinutes;
  return Math.max(1, Math.ceil(minutes / MAX_CHART_POINTS));
}

function formatGameRangeLabel(
  offsetMinutes: number,
  stepMinutes: number,
  range: PortfolioChartRange
): string {
  if (offsetMinutes === 0) return 'Now';
  if (range === 'day') {
    return formatGameClockLabel(BigInt(offsetMinutes));
  }
  if (stepMinutes < 60) return `-${offsetMinutes}m`;
  const gameHours = Math.round(offsetMinutes / 60);
  if (gameHours < 24) return `-${gameHours}h`;
  const gameDays = Math.round(offsetMinutes / Number(GAME_MINUTES_PER_DAY));
  if (gameDays < 31) return `-${gameDays}d`;
  const months = Math.round(gameDays / 30);
  if (months < 12) return `-${months}mo`;
  return `-${Math.round(gameDays / 365)}y`;
}

export function buildPortfolioChartSeries(
  snapshots: readonly PortfolioSnapshot[],
  livePortfolioCents: bigint,
  nowTimelineMinute: bigint,
  range: PortfolioChartRange = 'day'
): PortfolioChartPoint[] {
  const sessionStart =
    (nowTimelineMinute / GAME_MINUTES_PER_DAY) * GAME_MINUTES_PER_DAY;
  let rangeMinutes = PORTFOLIO_CHART_RANGES[range].gameMinutes;
  if (range === 'day') {
    rangeMinutes = Math.max(
      1,
      Math.min(rangeMinutes, Number(nowTimelineMinute - sessionStart) + 1)
    );
  }
  const earliestTimeline =
    range === 'day'
      ? sessionStart
      : (() => {
          const lookbackStart = nowTimelineMinute - BigInt(rangeMinutes);
          return lookbackStart < 0n ? 0n : lookbackStart;
        })();

  const sortedSnapshots = [
    ...snapshots.map(row => ({
      hourStartMicros: row.hourStartMicros,
      portfolioValueCents: row.portfolioValueCents,
    })),
    {
      hourStartMicros: nowTimelineMinute,
      portfolioValueCents: livePortfolioCents,
    },
  ].sort((left, right) => {
    if (left.hourStartMicros < right.hourStartMicros) return -1;
    if (left.hourStartMicros > right.hourStartMicros) return 1;
    return 0;
  });

  let lastValue = STARTING_CAPITAL_CENTS;
  let snapshotIndex = 0;
  const points: PortfolioChartPoint[] = [];
  const stepMinutes = chartStepGameMinutes(range);
  const firstOffset = Math.min(
    Math.ceil((rangeMinutes - 1) / stepMinutes) * stepMinutes,
    Number(nowTimelineMinute - earliestTimeline)
  );

  for (let offset = firstOffset; offset >= 0; offset -= stepMinutes) {
    let timelineMinute = nowTimelineMinute - BigInt(offset);
    if (timelineMinute < earliestTimeline) {
      timelineMinute = earliestTimeline;
    }
    if (points.some(point => point.hourStartMicros === timelineMinute)) {
      continue;
    }
    while (
      snapshotIndex < sortedSnapshots.length &&
      sortedSnapshots[snapshotIndex]!.hourStartMicros <= timelineMinute
    ) {
      lastValue = sortedSnapshots[snapshotIndex]!.portfolioValueCents;
      snapshotIndex += 1;
    }

    const label =
      offset === 0
        ? 'Now'
        : range === 'day'
          ? formatGameClockLabel(timelineMinute)
          : formatGameRangeLabel(offset, stepMinutes, range);

    points.push({
      hourStartMicros: timelineMinute,
      portfolioValueCents: lastValue,
      label,
    });
  }

  return points;
}

function niceChartStep(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;

  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;

  return niceFraction * 10 ** exponent;
}

export function buildChartYAxis(values: number[], targetTicks = 5) {
  const safeValues = values.map(value => Math.max(0, value));
  let minValue = Math.min(...safeValues);
  let maxValue = Math.max(...safeValues);

  if (minValue === maxValue) {
    const pad = Math.max(minValue * 0.01, 1_000);
    minValue = Math.max(0, minValue - pad);
    maxValue += pad;
  } else {
    const pad = (maxValue - minValue) * 0.1;
    minValue = Math.max(0, minValue - pad);
    maxValue += pad;
  }

  const range = niceChartStep(Math.max(maxValue - minValue, 1), false);
  const tickSpacing = niceChartStep(range / Math.max(targetTicks - 1, 1), true);
  const axisMin = Math.max(0, Math.floor(minValue / tickSpacing) * tickSpacing);
  const axisMax = Math.max(axisMin + tickSpacing, Math.ceil(maxValue / tickSpacing) * tickSpacing);
  const ticks: number[] = [];

  for (let tick = axisMin; tick <= axisMax + tickSpacing * 0.001; tick += tickSpacing) {
    ticks.push(Math.max(0, tick));
  }

  return { axisMin, axisMax, ticks, tickSpacing };
}

export function formatChartAxisLabel(cents: number, tickSpacingCents: number): string {
  const dollars = Math.max(0, cents) / 100;
  if (tickSpacingCents < 100) {
    return `$${dollars.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (tickSpacingCents < 100_000) return `$${Math.round(dollars).toLocaleString()}`;
  return `$${(dollars / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
}

export function chartSummary(points: readonly PortfolioChartPoint[]): string {
  const first = points[0]?.portfolioValueCents ?? STARTING_CAPITAL_CENTS;
  const last = points[points.length - 1]?.portfolioValueCents ?? STARTING_CAPITAL_CENTS;
  return `${formatReturn(last, first)} over selected range (${formatMoney(first)} -> ${formatMoney(last)})`;
}

export function chartValues(points: readonly PortfolioChartPoint[]): number[] {
  return points.map(point => Math.max(0, Number(clampNonNegativeCents(point.portfolioValueCents))));
}
