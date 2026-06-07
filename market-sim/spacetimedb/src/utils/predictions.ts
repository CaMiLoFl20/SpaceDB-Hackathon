export const BEST_FUND_BONUS_CENTS = 25_000n;
export const WORST_FUND_BONUS_CENTS = 25_000n;
export const COMBO_BONUS_CENTS = 25_000n;

export type FundPerformanceInput = {
  symbol: string;
  dayOpenPriceCents: bigint;
  priceCents: bigint;
};

export type PredictionSettlement = {
  bestFundSymbol: string;
  worstFundSymbol: string;
  bestCorrect: boolean;
  worstCorrect: boolean;
  bonusCents: bigint;
};

function returnBps(row: FundPerformanceInput): bigint {
  if (row.dayOpenPriceCents === 0n) return 0n;
  return ((row.priceCents - row.dayOpenPriceCents) * 10_000n) / row.dayOpenPriceCents;
}

export function rankFundsForPrediction(
  funds: readonly FundPerformanceInput[]
): { bestFundSymbol: string; worstFundSymbol: string } {
  const sorted = [...funds].sort((left, right) => {
    const diff = returnBps(right) - returnBps(left);
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return left.symbol.localeCompare(right.symbol);
  });
  return {
    bestFundSymbol: sorted[0]?.symbol ?? '',
    worstFundSymbol: sorted[sorted.length - 1]?.symbol ?? '',
  };
}

export function settlePrediction(
  predictedBest: string,
  predictedWorst: string,
  actualBest: string,
  actualWorst: string
): PredictionSettlement {
  const bestCorrect = predictedBest === actualBest;
  const worstCorrect = predictedWorst === actualWorst;
  let bonusCents = 0n;
  if (bestCorrect) bonusCents += BEST_FUND_BONUS_CENTS;
  if (worstCorrect) bonusCents += WORST_FUND_BONUS_CENTS;
  if (bestCorrect && worstCorrect) bonusCents += COMBO_BONUS_CENTS;
  return {
    bestFundSymbol: actualBest,
    worstFundSymbol: actualWorst,
    bestCorrect,
    worstCorrect,
    bonusCents,
  };
}
