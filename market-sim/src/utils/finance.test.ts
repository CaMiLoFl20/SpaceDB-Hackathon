import { describe, expect, it } from 'vitest';
import {
  computeFundHoldingsValue,
  formatMoney,
  formatPriceChangePercent,
  parseShares,
} from './finance';

describe('finance utils', () => {
  it('formats cents as money', () => {
    expect(formatMoney(123_456n)).toBe('$1,234.56');
    expect(formatMoney(-50n)).toBe('$0.00');
  });

  it('parses positive whole share counts only', () => {
    expect(parseShares('10')).toBe(10n);
    expect(parseShares('0')).toBeUndefined();
    expect(parseShares('1.5')).toBeUndefined();
    expect(parseShares('abc')).toBeUndefined();
  });

  it('formats signed price changes', () => {
    expect(formatPriceChangePercent(110n, 100n)).toBe('+10.00%');
    expect(formatPriceChangePercent(90n, 100n)).toBe('-10.00%');
  });

  it('computes fund holding value from latest market prices', () => {
    expect(
      computeFundHoldingsValue(
        [
          { symbol: 'AAA', shares: 3n },
          { symbol: 'BBB', shares: 2n },
        ],
        [
          { symbol: 'AAA', priceCents: 100n },
          { symbol: 'BBB', priceCents: 250n },
        ]
      )
    ).toBe(800n);
  });
});
