export const BASIS_POINTS_SCALE = 10_000n;
export const MAX_U64 = (1n << 64n) - 1n;

export function centsToDollarString(cents: bigint): string {
  const safe = cents < 0n ? 0n : cents;
  const dollars = safe / 100n;
  const remainder = (safe % 100n).toString().padStart(2, '0');
  return `${dollars}.${remainder}`;
}

export function multiplyCents(priceCents: bigint, quantity: bigint): bigint {
  if (quantity > 0n && priceCents > MAX_U64 / quantity) {
    throw new Error('amount_overflow');
  }
  return priceCents * quantity;
}

export function percentChangeBps(fromCents: bigint, toCents: bigint): bigint {
  if (fromCents === 0n) return 0n;
  return ((toCents - fromCents) * BASIS_POINTS_SCALE) / fromCents;
}
