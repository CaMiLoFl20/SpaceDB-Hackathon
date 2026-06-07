export type StockMoverInput = {
  symbol: string;
  name: string;
  priceCents: bigint;
  dayOpenPriceCents: bigint;
};

export type FundExposureInput = {
  fundName: string;
  symbol: string;
  weightBps: bigint;
};

export function stockMoveBps(stock: StockMoverInput): bigint {
  if (stock.dayOpenPriceCents === 0n) return 0n;
  return ((stock.priceCents - stock.dayOpenPriceCents) * 10_000n) / stock.dayOpenPriceCents;
}

export function absoluteBigint(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function topStockMovers<T extends StockMoverInput>(
  stocks: readonly T[],
  limit: number
): T[] {
  return [...stocks]
    .sort((left, right) => {
      const rightMove = absoluteBigint(stockMoveBps(right));
      const leftMove = absoluteBigint(stockMoveBps(left));
      if (rightMove > leftMove) return 1;
      if (rightMove < leftMove) return -1;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, limit);
}

export function affectedFundNames(
  symbol: string | undefined,
  exposures: readonly FundExposureInput[],
  limit: number
): string[] {
  if (!symbol) return [];

  const seen = new Set<string>();
  const rows = exposures
    .filter(row => row.symbol === symbol)
    .sort((left, right) => {
      if (right.weightBps > left.weightBps) return 1;
      if (right.weightBps < left.weightBps) return -1;
      return left.fundName.localeCompare(right.fundName);
    });

  const names: string[] = [];
  for (const row of rows) {
    if (seen.has(row.fundName)) continue;
    seen.add(row.fundName);
    names.push(row.fundName);
    if (names.length >= limit) break;
  }
  return names;
}
