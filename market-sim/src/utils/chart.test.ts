import { describe, expect, it } from 'vitest';
import {
  buildChartYAxis,
  buildPortfolioChartSeries,
  gameTimelineMinuteFromClock,
} from './chart';

describe('chart utils', () => {
  it('derives game timeline minute from market clock', () => {
    expect(gameTimelineMinuteFromClock(1n, 570n)).toBe(0n);
    expect(gameTimelineMinuteFromClock(1n, 630n)).toBe(60n);
    expect(gameTimelineMinuteFromClock(2n, 570n)).toBe(390n);
  });

  it('builds a today chart series in game clock time', () => {
    const nowTimeline = gameTimelineMinuteFromClock(1n, 630n);
    const points = buildPortfolioChartSeries([], 1_250_000n, nowTimeline, 'day');
    expect(points.length).toBeGreaterThan(1);
    expect(points[points.length - 1]?.portfolioValueCents).toBe(1_250_000n);
    expect(points[points.length - 1]?.label).toBe('Now');
    expect(points[0]?.label).toMatch(/AM|PM/);
  });

  it('supports longer game-time ranges without producing oversized series', () => {
    const nowTimeline = gameTimelineMinuteFromClock(10n, 960n);
    expect(buildPortfolioChartSeries([], 1_250_000n, nowTimeline, 'week').length).toBeLessThanOrEqual(
      181
    );
    expect(
      buildPortfolioChartSeries([], 1_250_000n, nowTimeline, 'month').length
    ).toBeLessThanOrEqual(181);
    expect(buildPortfolioChartSeries([], 1_250_000n, nowTimeline, 'year').length).toBeLessThanOrEqual(
      181
    );
  });

  it('carries snapshots forward when long ranges are downsampled', () => {
    const nowTimeline = gameTimelineMinuteFromClock(5n, 960n);
    const points = buildPortfolioChartSeries(
      [{ hourStartMicros: nowTimeline - 500n, portfolioValueCents: 1_100_000n }],
      1_250_000n,
      nowTimeline,
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
