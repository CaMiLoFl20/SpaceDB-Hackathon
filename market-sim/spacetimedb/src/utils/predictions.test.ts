import { describe, expect, it } from 'vitest';
import { rankFundsForPrediction, settlePrediction } from './predictions';

describe('prediction helpers', () => {
  it('ranks funds by day return', () => {
    expect(
      rankFundsForPrediction([
        { symbol: 'AAA', dayOpenPriceCents: 100n, priceCents: 120n },
        { symbol: 'BBB', dayOpenPriceCents: 100n, priceCents: 80n },
        { symbol: 'CCC', dayOpenPriceCents: 100n, priceCents: 105n },
      ])
    ).toEqual({ bestFundSymbol: 'AAA', worstFundSymbol: 'BBB' });
  });

  it('awards combo bonus when both predictions are correct', () => {
    const result = settlePrediction('AAA', 'BBB', 'AAA', 'BBB');
    expect(result.bestCorrect).toBe(true);
    expect(result.worstCorrect).toBe(true);
    expect(result.bonusCents).toBe(75_000n);
  });
});
