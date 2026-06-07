import { describe, expect, it } from 'vitest';
import { buildChartYAxis, buildPortfolioChartSeries } from './chart';

describe('chart utils', () => {
  it('builds a stable 24-hour chart series', () => {
    const nowMs = Date.UTC(2026, 0, 2, 12, 30, 0);
    const points = buildPortfolioChartSeries([], 1_250_000n, nowMs);
    expect(points).toHaveLength(24);
    expect(points[points.length - 1]?.portfolioValueCents).toBe(1_250_000n);
  });

  it('builds a non-empty y axis for flat data', () => {
    const axis = buildChartYAxis([1_000_000, 1_000_000]);
    expect(axis.axisMax).toBeGreaterThan(axis.axisMin);
    expect(axis.ticks.length).toBeGreaterThan(1);
  });
});
