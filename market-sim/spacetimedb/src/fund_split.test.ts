import { describe, expect, it } from 'vitest';
import {
  affordableShareCount,
  computeVariedTargetPriceCents,
  maxAffordablePriceCents,
  planFundSplit,
  shouldScheduleFundSplit,
  STARTING_BALANCE_CENTS,
  MIN_AFFORDABLE_SHARES,
} from './fund_split';

describe('fund split', () => {
  it('assigns different target prices per fund symbol', () => {
    const targets = ['CEDR', 'HARB', 'APEX', 'MKT1', 'MKT2'].map(symbol =>
      computeVariedTargetPriceCents(symbol, 100n)
    );
    expect(new Set(targets).size).toBeGreaterThan(1);
  });

  it('plans splits that leave new players able to buy a few shares', () => {
    const plan = planFundSplit('APEX', 5_000_000n, 42n);
    expect(plan).toBeDefined();
    expect(plan!.splitRatio).toBeGreaterThan(1n);
    expect(
      affordableShareCount(STARTING_BALANCE_CENTS, plan!.targetPriceCents)
    ).toBeGreaterThanOrEqual(MIN_AFFORDABLE_SHARES);
  });

  it('does not split already affordable funds', () => {
    expect(planFundSplit('MKT1', maxAffordablePriceCents(), 1n)).toBeUndefined();
  });

  it('schedules splits when the market is too expensive for newcomers', () => {
    expect(shouldScheduleFundSplit(maxAffordablePriceCents() + 1n, 0, 0)).toBe(true);
    expect(shouldScheduleFundSplit(maxAffordablePriceCents(), 2, 0)).toBe(false);
  });
});
