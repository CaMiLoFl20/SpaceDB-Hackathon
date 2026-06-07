import { describe, expect, it } from 'vitest';
import { buildChartYAxis, buildPortfolioChartSeries } from './chart';

describe('chart utils', () => {
  it('builds a stable 24-hour chart series', () => {
    const nowMs = Date.UTC(2026, 0, 2, 12, 30, 0);
    const points = buildPortfolioChartSeries([], 1_250_000n, nowMs, 'day');
    expect(points).toHaveLength(24);
    expect(points[points.length - 1]?.portfolioValueCents).toBe(1_250_000n);
    expect(points[points.length - 1]?.label).toBe('Now');
  });

  it('supports longer game-time ranges without producing oversized series', () => {
    const nowMs = Date.UTC(2026, 0, 2, 12, 30, 0);
    expect(buildPortfolioChartSeries([], 1_250_000n, nowMs, 'week').length).toBe(168);
    expect(buildPortfolioChartSeries([], 1_250_000n, nowMs, 'month').length).toBeLessThanOrEqual(181);
    expect(buildPortfolioChartSeries([], 1_250_000n, nowMs, 'year').length).toBeLessThanOrEqual(181);
  });

  it('carries snapshots forward when long ranges are downsampled', () => {
    const nowMs = Date.UTC(2026, 0, 2, 12, 30, 0);
    const nowMicros = BigInt(nowMs) * 1000n;
    const points = buildPortfolioChartSeries(
      [{ hourStartMicros: nowMicros - 30_000_000n * 10n, portfolioValueCents: 1_100_000n }],
      1_250_000n,
      nowMs,
      'month'
    );

    expect(points[points.length - 1]?.portfolioValueCents).toBe(1_250_000n);
    expect(points.some(point => point.portfolioValueCents === 1_100_000n)).toBe(true);
  });

  it('builds a non-empty y axis for flat data', () => {
    const axis = buildChartYAxis([1_000_000, 1_000_000]);
    expect(axis.axisMax).toBeGreaterThan(axis.axisMin);
    expect(axis.ticks.length).toBeGreaterThan(1);
  });
});
