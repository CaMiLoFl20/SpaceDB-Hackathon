import { STARTING_CAPITAL_CENTS, clampNonNegativeCents, formatMoney, formatReturn } from './finance';

const HOUR_MICROS = 3_600_000_000n;
const PORTFOLIO_CHART_HOURS = 24;

export type PortfolioSnapshot = {
  hourStartMicros: bigint;
  portfolioValueCents: bigint;
};

export type PortfolioChartPoint = PortfolioSnapshot & {
  label: string;
};

function hourStartMicrosFromMs(ms: number): bigint {
  const micros = BigInt(ms) * 1000n;
  return (micros / HOUR_MICROS) * HOUR_MICROS;
}

export function buildPortfolioChartSeries(
  snapshots: readonly PortfolioSnapshot[],
  livePortfolioCents: bigint,
  nowMs: number
): PortfolioChartPoint[] {
  const currentHourStart = hourStartMicrosFromMs(nowMs);
  const snapshotByHour = new Map<string, bigint>();

  for (const row of snapshots) {
    snapshotByHour.set(row.hourStartMicros.toString(), row.portfolioValueCents);
  }
  snapshotByHour.set(currentHourStart.toString(), livePortfolioCents);

  let lastValue = STARTING_CAPITAL_CENTS;
  const points: PortfolioChartPoint[] = [];

  for (let offset = PORTFOLIO_CHART_HOURS - 1; offset >= 0; offset -= 1) {
    const hourStart = currentHourStart - BigInt(offset) * HOUR_MICROS;
    const key = hourStart.toString();
    if (snapshotByHour.has(key)) lastValue = snapshotByHour.get(key)!;

    points.push({
      hourStartMicros: hourStart,
      portfolioValueCents: lastValue,
      label: new Date(Number(hourStart / 1000n)).toLocaleTimeString([], {
        hour: 'numeric',
      }),
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
  return `${formatReturn(last, first)} vs 24h ago (${formatMoney(first)} -> ${formatMoney(last)})`;
}

export function chartValues(points: readonly PortfolioChartPoint[]): number[] {
  return points.map(point => Math.max(0, Number(clampNonNegativeCents(point.portfolioValueCents))));
}
