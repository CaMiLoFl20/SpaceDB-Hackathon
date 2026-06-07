import { describe, expect, it } from 'vitest';
import { computeFundSharePriceCents, fundAliasFor } from './funds';

describe('fund model helpers', () => {
  it('computes NAV-backed share price', () => {
    expect(computeFundSharePriceCents(1_000_000n, 1_000n)).toBe(1_000n);
    expect(computeFundSharePriceCents(0n, 1_000n)).toBe(1n);
  });

  it('assigns deterministic aliases for a session seed', () => {
    expect(fundAliasFor('APEX', 42n)).toBe(fundAliasFor('APEX', 42n));
    expect(fundAliasFor('APEX', 42n).length).toBeGreaterThan(0);
  });
});
