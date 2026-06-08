import { describe, expect, it } from 'vitest';
import {
  affordableShareCount,
  computeVariedTargetPriceCents,
  maxAffordablePriceCents,
  planShareSplit,
  shouldScheduleShareSplit,
  STARTING_BALANCE_CENTS,
  MIN_AFFORDABLE_SHARES,
} from './share_split';

describe('share split', () => {
  it('assigns different target prices per symbol', () => {
    const targets = ['NVDA', 'AAPL', 'CEDR', 'HARB'].map(symbol =>
      computeVariedTargetPriceCents(symbol, 100n)
    );
    expect(new Set(targets).size).toBeGreaterThan(1);
  });

  it('plans splits that leave new players able to buy a few shares', () => {
    const plan = planShareSplit('NVDA', 5_000_000n, 42n);
    expect(plan).toBeDefined();
    expect(plan!.splitRatio).toBeGreaterThan(1n);
    expect(
      affordableShareCount(STARTING_BALANCE_CENTS, plan!.targetPriceCents)
    ).toBeGreaterThanOrEqual(MIN_AFFORDABLE_SHARES);
  });

  it('does not split already affordable prices', () => {
    expect(planShareSplit('AAPL', maxAffordablePriceCents(), 1n)).toBeUndefined();
  });

  it('schedules splits when the market is too expensive for newcomers', () => {
    expect(shouldScheduleShareSplit(maxAffordablePriceCents() + 1n, 0, 0)).toBe(true);
    expect(shouldScheduleShareSplit(maxAffordablePriceCents(), 2, 0)).toBe(false);
  });
});
