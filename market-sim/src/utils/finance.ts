export const STARTING_CAPITAL_CENTS = 1_000_000n;
export const GAIN_COLOR = '#15803d';
export const LOSS_COLOR = '#b91c1c';

export function clampNonNegativeCents(cents: bigint): bigint {
  return cents < 0n ? 0n : cents;
}

export function formatMoney(cents: bigint): string {
  const safeCents = clampNonNegativeCents(cents);
  const dollars = safeCents / 100n;
  const remainder = (safeCents % 100n).toString().padStart(2, '0');
  return `$${dollars.toLocaleString()}.${remainder}`;
}

export function formatReturn(portfolioCents: bigint, startingCents = STARTING_CAPITAL_CENTS): string {
  const diff = portfolioCents - startingCents;
  const pct = Number((diff * 10000n) / startingCents) / 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatPriceChangePercent(current: bigint, previous: bigint): string {
  if (previous === 0n) return '0.00%';
  const pct = Number(((current - previous) * 10000n) / previous) / 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function parseShares(input: string): bigint | undefined {
  const value = input.trim();
  if (!/^\d+$/.test(value)) return undefined;
  const shares = BigInt(value);
  return shares > 0n ? shares : undefined;
}

export function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'tag' in value) {
    const option = value as { tag: string; value?: string };
    return option.tag === 'some' ? option.value : undefined;
  }
  return undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed.';
}

export function sortByTimeDesc<T extends { createdAt: { microsSinceUnixEpoch: bigint } }>(
  rows: readonly T[]
): T[] {
  return [...rows].sort((left, right) =>
    Number(right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch)
  );
}

export function computeFundHoldingsValue(
  holdings: readonly { symbol: string; shares: bigint }[],
  funds: readonly { symbol: string; priceCents: bigint }[]
): bigint {
  return holdings.reduce((sum, holding) => {
    const fund = funds.find(row => row.symbol === holding.symbol);
    return sum + (fund ? holding.shares * fund.priceCents : 0n);
  }, 0n);
}
