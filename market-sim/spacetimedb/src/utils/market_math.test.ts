import { describe, expect, it } from 'vitest';
import { applyPriceImpact, impactBasisPoints } from './market_math';

describe('market math', () => {
  it('clamps impact basis points', () => {
    expect(impactBasisPoints(1n)).toBe(5n);
    expect(impactBasisPoints(1_000_000n)).toBe(1000n);
  });

  it('applies buy and sell price impact', () => {
    expect(applyPriceImpact(10_000n, 'buy', 100n).priceCents).toBe(10_010n);
    expect(applyPriceImpact(10_000n, 'sell', 100n).priceCents).toBe(9_990n);
  });
});
