import type { ChatMessage } from './llm';
import { centsToDollarString } from './utils/money';

/** Max share price before a split is scheduled (~$500 — $10k starter buys ≥20 shares). */
export const FUND_SPLIT_TRIGGER_PRICE_CENTS = 50_000n;
/** Target post-split price (~$100). */
export const FUND_SPLIT_TARGET_PRICE_CENTS = 10_000n;
/** Real seconds between AI announcement and split execution. */
export const FUND_SPLIT_LEAD_MICROS = 45_000_000n;

const NICE_SPLIT_RATIOS = [2n, 5n, 10n, 20n, 50n, 100n] as const;

export function computeFundSplitRatio(priceCents: bigint): bigint {
  if (priceCents <= FUND_SPLIT_TARGET_PRICE_CENTS) return 1n;
  const raw = (priceCents + FUND_SPLIT_TARGET_PRICE_CENTS - 1n) / FUND_SPLIT_TARGET_PRICE_CENTS;
  for (const ratio of NICE_SPLIT_RATIOS) {
    if (raw <= ratio) return ratio;
  }
  return 100n;
}

export function projectedPriceAfterSplit(priceCents: bigint, ratio: bigint): bigint {
  if (ratio <= 1n) return priceCents;
  const next = priceCents / ratio;
  return next > 0n ? next : 1n;
}

export function buildFundSplitAnnouncementMessages(input: {
  fundSymbol: string;
  fundName: string;
  splitRatio: bigint;
  currentPriceCents: bigint;
  projectedPriceCents: bigint;
  secondsUntilEffective: bigint;
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the live market news desk for a multiplayer fund-trading game.',
        'Write a breaking headline announcing an upcoming fund share split.',
        'The split has NOT happened yet — say it is scheduled / pending / effective shortly.',
        'Do not reveal whether the fund is AI-managed or scripted.',
        'Respond with JSON only:',
        '{"publish":true,"headline":"...","body":"...","symbol":"","next_check_seconds":45,"reasoning":"one sentence"}',
        'symbol must be an empty string for fund corporate actions.',
        'publish must be true.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Corporate action pending: ${input.fundName} (${input.fundSymbol}) will execute a ${input.splitRatio.toString()}-for-1 share split`,
        `in about ${input.secondsUntilEffective.toString()} seconds.`,
        `Current fund share price: $${centsToDollarString(input.currentPriceCents)}.`,
        `Expected price after split: ~$${centsToDollarString(input.projectedPriceCents)} per share.`,
        'Existing holders receive additional shares; total portfolio value is unchanged.',
        'Announce this now so traders can prepare.',
      ].join('\n'),
    },
  ];
}

export function templateFundSplitAnnouncement(input: {
  fundSymbol: string;
  fundName: string;
  splitRatio: bigint;
  projectedPriceCents: bigint;
}): { headline: string; body: string } {
  return {
    headline: `${input.fundName} (${input.fundSymbol}) announces ${input.splitRatio.toString()}-for-1 share split`,
    body: `${input.fundName} will execute a ${input.splitRatio.toString()}-for-1 share split shortly. Each share will become ${input.splitRatio.toString()} shares at an expected price near $${centsToDollarString(input.projectedPriceCents)}. Holdings value is unchanged; the split improves accessibility for new investors.`,
  };
}
