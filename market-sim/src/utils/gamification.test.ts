import { describe, expect, it } from 'vitest';
import { affectedFundNames, stockMoveBps, topStockMovers } from './gamification';

describe('gamification utils', () => {
  it('computes stock move basis points', () => {
    expect(stockMoveBps({ symbol: 'AAA', name: 'A', priceCents: 110n, dayOpenPriceCents: 100n })).toBe(1_000n);
    expect(stockMoveBps({ symbol: 'BBB', name: 'B', priceCents: 90n, dayOpenPriceCents: 100n })).toBe(-1_000n);
    expect(stockMoveBps({ symbol: 'CCC', name: 'C', priceCents: 90n, dayOpenPriceCents: 0n })).toBe(0n);
  });

  it('sorts top movers by absolute daily move', () => {
    const movers = topStockMovers(
      [
        { symbol: 'FLAT', name: 'Flat', priceCents: 100n, dayOpenPriceCents: 100n },
        { symbol: 'UP', name: 'Up', priceCents: 120n, dayOpenPriceCents: 100n },
        { symbol: 'DOWN', name: 'Down', priceCents: 80n, dayOpenPriceCents: 100n },
      ],
      2
    );

    expect(movers.map(row => row.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('finds affected funds by exposure weight', () => {
    expect(
      affectedFundNames(
        'NVDA',
        [
          { fundName: 'Small', symbol: 'NVDA', weightBps: 100n },
          { fundName: 'Large', symbol: 'NVDA', weightBps: 2_000n },
          { fundName: 'Other', symbol: 'AAPL', weightBps: 4_000n },
        ],
        2
      )
    ).toEqual(['Large', 'Small']);
  });
});
