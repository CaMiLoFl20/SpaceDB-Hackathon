import { describe, expect, it } from 'vitest';
import {
  computeFundSplitRatio,
  FUND_SPLIT_TARGET_PRICE_CENTS,
  FUND_SPLIT_TRIGGER_PRICE_CENTS,
  projectedPriceAfterSplit,
} from './fund_split';

describe('fund split', () => {
  it('does not split affordable prices', () => {
    expect(computeFundSplitRatio(FUND_SPLIT_TARGET_PRICE_CENTS)).toBe(1n);
    expect(computeFundSplitRatio(FUND_SPLIT_TRIGGER_PRICE_CENTS)).toBeGreaterThan(1n);
  });

  it('projects lower post-split prices', () => {
    const ratio = computeFundSplitRatio(250_000n);
    expect(projectedPriceAfterSplit(250_000n, ratio)).toBeLessThanOrEqual(FUND_SPLIT_TARGET_PRICE_CENTS);
  });
});
