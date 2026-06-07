import { STARTING_CAPITAL_CENTS, clampNonNegativeCents, formatMoney, formatReturn } from './finance';

const GAME_HOUR_MICROS = 30_000_000n;
const MAX_CHART_POINTS = 180;

export type PortfolioChartRange = 'day' | 'week' | 'month' | 'year';

export const PORTFOLIO_CHART_RANGES: Record<
  PortfolioChartRange,
  { label: string; gameHours: number }
> = {
  day: { label: '24h', gameHours: 24 },
  week: { label: 'Week', gameHours: 24 * 7 },
  month: { label: 'Month', gameHours: 24 * 30 },
  year: { label: 'Year', gameHours: 24 * 365 },
};

export type PortfolioSnapshot = {
  hourStartMicros: bigint;
  portfolioValueCents: bigint;
};

export type PortfolioChartPoint = PortfolioSnapshot & {
  label: string;
};

function hourStartMicrosFromMs(ms: number): bigint {
  const micros = BigInt(ms) * 1000n;
  return (micros / GAME_HOUR_MICROS) * GAME_HOUR_MICROS;
}

function chartStepGameHours(range: PortfolioChartRange): number {
  const hours = PORTFOLIO_CHART_RANGES[range].gameHours;
  return Math.max(1, Math.ceil(hours / MAX_CHART_POINTS));
}

function formatGameRangeLabel(hourOffset: number, stepHours: number): string {
  if (stepHours < 24) return `-${hourOffset}h`;
  const days = Math.round(hourOffset / 24);
  if (days < 31) return `-${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `-${months}mo`;
  return `-${Math.round(days / 365)}y`;
}

export function buildPortfolioChartSeries(
  snapshots: readonly PortfolioSnapshot[],
  livePortfolioCents: bigint,
  nowMs: number,
  range: PortfolioChartRange = 'day'
): PortfolioChartPoint[] {
  const currentHourStart = hourStartMicrosFromMs(nowMs);
  const sortedSnapshots = [
    ...snapshots.map(row => ({
      hourStartMicros: row.hourStartMicros,
      portfolioValueCents: row.portfolioValueCents,
    })),
    { hourStartMicros: currentHourStart, portfolioValueCents: livePortfolioCents },
  ].sort((left, right) => {
    if (left.hourStartMicros < right.hourStartMicros) return -1;
    if (left.hourStartMicros > right.hourStartMicros) return 1;
    return 0;
  });

  let lastValue = STARTING_CAPITAL_CENTS;
  let snapshotIndex = 0;
  const points: PortfolioChartPoint[] = [];
  const rangeHours = PORTFOLIO_CHART_RANGES[range].gameHours;
  const stepHours = chartStepGameHours(range);
  const firstOffset = Math.ceil((rangeHours - 1) / stepHours) * stepHours;

  for (let offset = firstOffset; offset >= 0; offset -= stepHours) {
    const hourStart = currentHourStart - BigInt(offset) * GAME_HOUR_MICROS;
    while (
      snapshotIndex < sortedSnapshots.length &&
      sortedSnapshots[snapshotIndex]!.hourStartMicros <= hourStart
    ) {
      lastValue = sortedSnapshots[snapshotIndex]!.portfolioValueCents;
      snapshotIndex += 1;
    }

    points.push({
      hourStartMicros: hourStart,
      portfolioValueCents: lastValue,
      label: offset === 0 ? 'Now' : formatGameRangeLabel(offset, stepHours),
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
  return `${formatReturn(last, first)} over selected game-time range (${formatMoney(first)} -> ${formatMoney(last)})`;
}

export function chartValues(points: readonly PortfolioChartPoint[]): number[] {
  return points.map(point => Math.max(0, Number(clampNonNegativeCents(point.portfolioValueCents))));
}
