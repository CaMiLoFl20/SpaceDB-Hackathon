import type { ChatMessage } from './llm';
import { centsToDollarString } from './utils/money';

/** Matches player starting cash ($10,000). */
export const STARTING_BALANCE_CENTS = 1_000_000n;
/** New players should afford at least this many shares in a fund. */
export const MIN_AFFORDABLE_SHARES = 3n;
/** Keep at least this many funds buyable for newcomers at any time. */
export const MIN_AFFORDABLE_FUND_COUNT = 2n;
/** Real seconds between AI announcement and split execution. */
export const FUND_SPLIT_LEAD_MICROS = 45_000_000n;

export type FundSplitPlan = {
  splitRatio: bigint;
  targetPriceCents: bigint;
};

function hashSeed(fundSymbol: string, seed: bigint): bigint {
  let hash = seed;
  for (let i = 0; i < fundSymbol.length; i += 1) {
    hash = hash * 37n + BigInt(fundSymbol.charCodeAt(i));
  }
  return hash < 0n ? -hash : hash;
}

export function maxAffordablePriceCents(): bigint {
  return STARTING_BALANCE_CENTS / MIN_AFFORDABLE_SHARES;
}

export function affordableShareCount(balanceCents: bigint, priceCents: bigint): bigint {
  if (priceCents <= 0n) return 0n;
  return balanceCents / priceCents;
}

/** Each fund gets its own post-split price target in this band (before affordability cap). */
export function computeVariedTargetPriceCents(fundSymbol: string, seed: bigint): bigint {
  const hash = hashSeed(fundSymbol, seed);
  const min = 8_500n;
  const max = 290_000n;
  const span = max - min;
  const varied = min + (hash % (span + 1n));
  const cap = maxAffordablePriceCents();
  if (varied <= cap) return varied;
  const slack = hash % 40_000n;
  return cap > slack ? cap - slack : cap;
}

export function planFundSplit(
  fundSymbol: string,
  priceCents: bigint,
  seed: bigint
): FundSplitPlan | undefined {
  if (priceCents <= 0n) return undefined;

  const maxPrice = maxAffordablePriceCents();
  if (affordableShareCount(STARTING_BALANCE_CENTS, priceCents) >= MIN_AFFORDABLE_SHARES) {
    return undefined;
  }

  const target = computeVariedTargetPriceCents(fundSymbol, seed);
  const hash = hashSeed(fundSymbol, seed ^ 0x5_011_47n);

  let ratio = (priceCents + target - 1n) / target;
  ratio += (hash % 13n) + 1n;
  if (ratio < 2n) ratio = 2n;
  if (ratio > 750n) ratio = 750n;

  let projected = priceCents / ratio;
  while (projected > maxPrice && ratio < 750n) {
    ratio += 1n;
    projected = priceCents / ratio;
  }

  if (projected <= 0n) projected = 1n;
  return { splitRatio: ratio, targetPriceCents: projected };
}

export function projectedPriceAfterSplit(priceCents: bigint, ratio: bigint): bigint {
  if (ratio <= 1n) return priceCents;
  const next = priceCents / ratio;
  return next > 0n ? next : 1n;
}

export function shouldScheduleFundSplit(
  priceCents: bigint,
  affordableFundCount: number,
  expensiveRank: number
): boolean {
  if (priceCents <= 0n) return false;
  if (affordableShareCount(STARTING_BALANCE_CENTS, priceCents) < MIN_AFFORDABLE_SHARES) {
    return true;
  }
  return affordableFundCount < MIN_AFFORDABLE_FUND_COUNT && expensiveRank < 3;
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
        `Expected price after split: about $${centsToDollarString(input.projectedPriceCents)} per share (each fund settles at its own level).`,
        'All existing fund shareholders receive additional shares; total portfolio value is unchanged.',
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
    body: `${input.fundName} will execute a ${input.splitRatio.toString()}-for-1 share split shortly. Existing shareholders receive ${input.splitRatio.toString()} shares for every share held, with an expected post-split price near $${centsToDollarString(input.projectedPriceCents)} per share. Holdings value is unchanged.`,
  };
}
