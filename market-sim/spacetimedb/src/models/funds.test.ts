import { describe, expect, it } from 'vitest';
import {
  computeConstituentWeightBps,
  computeFundSharePriceCents,
  fundAliasFor,
} from './funds';

describe('fund model helpers', () => {
  it('computes NAV-backed share price', () => {
    expect(computeFundSharePriceCents(1_000_000n, 1_000n)).toBe(1_000n);
    expect(computeFundSharePriceCents(0n, 1_000n)).toBe(1n);
  });

  it('assigns deterministic aliases for a session seed', () => {
    expect(fundAliasFor('APEX', 42n)).toBe(fundAliasFor('APEX', 42n));
    expect(fundAliasFor('APEX', 42n).length).toBeGreaterThan(0);
  });

  it('computes public fund constituent weights in basis points', () => {
    expect(computeConstituentWeightBps(250_000n, 1_000_000n)).toBe(2_500n);
    expect(computeConstituentWeightBps(1n, 3n)).toBe(3_333n);
    expect(computeConstituentWeightBps(1_000n, 0n)).toBe(0n);
    expect(computeConstituentWeightBps(0n, 1_000n)).toBe(0n);
  });
});
