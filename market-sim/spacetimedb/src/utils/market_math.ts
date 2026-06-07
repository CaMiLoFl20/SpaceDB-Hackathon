import { BASIS_POINTS_SCALE, percentChangeBps } from './money';

export const MIN_PRICE_CENTS = 100n;

export function impactBasisPoints(shares: bigint): bigint {
  const raw = shares / 10n;
  if (raw < 5n) return 5n;
  if (raw > 1000n) return 1000n;
  return raw;
}

export function applyPriceImpact(
  priceCents: bigint,
  direction: 'buy' | 'sell',
  shares: bigint
): { previousPriceCents: bigint; priceCents: bigint } {
  const bps = impactBasisPoints(shares);
  const factor =
    direction === 'buy'
      ? BASIS_POINTS_SCALE + bps
      : BASIS_POINTS_SCALE - bps;
  let nextPrice = (priceCents * factor) / BASIS_POINTS_SCALE;
  if (nextPrice < MIN_PRICE_CENTS) nextPrice = MIN_PRICE_CENTS;
  return { previousPriceCents: priceCents, priceCents: nextPrice };
}

export function signedPriceChangeBps(fromPriceCents: bigint, toPriceCents: bigint): bigint {
  return percentChangeBps(fromPriceCents, toPriceCents);
}
