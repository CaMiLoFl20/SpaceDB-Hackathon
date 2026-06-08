import type { ChatMessage } from './llm';
import { centsToDollarString } from './utils/money';

/** Matches player starting cash ($10,000). */
export const STARTING_BALANCE_CENTS = 1_000_000n;
/** New players should afford at least this many shares. */
export const MIN_AFFORDABLE_SHARES = 3n;
/** Keep at least this many instruments buyable for newcomers. */
export const MIN_AFFORDABLE_INSTRUMENT_COUNT = 2n;
/** Real seconds between AI announcement and split execution. */
export const SPLIT_LEAD_MICROS = 45_000_000n;

export type SplitPlan = {
  splitRatio: bigint;
  targetPriceCents: bigint;
};

export type SplitInstrumentKind = 'fund' | 'stock';

function hashSeed(symbol: string, seed: bigint): bigint {
  let hash = seed;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = hash * 37n + BigInt(symbol.charCodeAt(i));
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

/** Each symbol gets its own post-split price target in this band (before affordability cap). */
export function computeVariedTargetPriceCents(symbol: string, seed: bigint): bigint {
  const hash = hashSeed(symbol, seed);
  const min = 8_500n;
  const max = 290_000n;
  const span = max - min;
  const varied = min + (hash % (span + 1n));
  const cap = maxAffordablePriceCents();
  if (varied <= cap) return varied;
  const slack = hash % 40_000n;
  return cap > slack ? cap - slack : cap;
}

export function planShareSplit(
  symbol: string,
  priceCents: bigint,
  seed: bigint
): SplitPlan | undefined {
  if (priceCents <= 0n) return undefined;

  const maxPrice = maxAffordablePriceCents();
  if (affordableShareCount(STARTING_BALANCE_CENTS, priceCents) >= MIN_AFFORDABLE_SHARES) {
    return undefined;
  }

  const target = computeVariedTargetPriceCents(symbol, seed);
  const hash = hashSeed(symbol, seed ^ 0x5_011_47n);

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

export function shouldScheduleShareSplit(
  priceCents: bigint,
  affordableInstrumentCount: number,
  expensiveRank: number
): boolean {
  if (priceCents <= 0n) return false;
  if (affordableShareCount(STARTING_BALANCE_CENTS, priceCents) < MIN_AFFORDABLE_SHARES) {
    return true;
  }
  return affordableInstrumentCount < MIN_AFFORDABLE_INSTRUMENT_COUNT && expensiveRank < 3;
}

function instrumentLabel(kind: SplitInstrumentKind): string {
  return kind === 'fund' ? 'fund share' : 'stock';
}

export function buildSplitAnnouncementMessages(input: {
  kind: SplitInstrumentKind;
  symbol: string;
  displayName: string;
  splitRatio: bigint;
  currentPriceCents: bigint;
  projectedPriceCents: bigint;
  secondsUntilEffective: bigint;
}): ChatMessage[] {
  const label = instrumentLabel(input.kind);
  const jsonSymbolHint =
    input.kind === 'stock'
      ? `symbol may be ${input.symbol} for stock splits.`
      : 'symbol must be an empty string for fund corporate actions.';

  return [
    {
      role: 'system',
      content: [
        'You are the live market news desk for a multiplayer fund-trading game.',
        `Write a breaking headline announcing an upcoming ${label} split.`,
        'The split has NOT happened yet — say it is scheduled / pending / effective shortly.',
        'Do not reveal whether a fund is AI-managed or scripted.',
        'Respond with JSON only:',
        '{"publish":true,"headline":"...","body":"...","symbol":"TICKER or empty","next_check_seconds":45,"reasoning":"one sentence"}',
        jsonSymbolHint,
        'publish must be true.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Corporate action pending: ${input.displayName} (${input.symbol}) will execute a ${input.splitRatio.toString()}-for-1 ${label} split`,
        `in about ${input.secondsUntilEffective.toString()} seconds.`,
        `Current share price: $${centsToDollarString(input.currentPriceCents)}.`,
        `Expected price after split: about $${centsToDollarString(input.projectedPriceCents)} per share.`,
        'All existing shareholders receive additional shares; total position value is unchanged.',
        'Announce this now so traders can prepare.',
      ].join('\n'),
    },
  ];
}

export function templateSplitAnnouncement(input: {
  kind: SplitInstrumentKind;
  symbol: string;
  displayName: string;
  splitRatio: bigint;
  projectedPriceCents: bigint;
}): { headline: string; body: string } {
  const label = input.kind === 'fund' ? 'fund share' : 'stock';
  return {
    headline: `${input.displayName} (${input.symbol}) announces ${input.splitRatio.toString()}-for-1 ${label} split`,
    body: `${input.displayName} will execute a ${input.splitRatio.toString()}-for-1 ${label} split shortly. Existing shareholders receive ${input.splitRatio.toString()} shares for every share held, with an expected post-split price near $${centsToDollarString(input.projectedPriceCents)} per share. Holdings value is unchanged.`,
  };
}

export function splitCompletionHeadline(input: {
  kind: SplitInstrumentKind;
  symbol: string;
  displayName: string;
  splitRatio: bigint;
  newPriceCents: bigint;
}): { headline: string; body: string } {
  const label = input.kind === 'fund' ? 'fund share' : 'stock';
  return {
    headline: `${input.displayName} (${input.symbol}) completes ${input.splitRatio.toString()}-for-1 ${label} split`,
    body: `The split is now effective at $${centsToDollarString(input.newPriceCents)} per share. All shareholders received ${input.splitRatio.toString()} shares for every share held; portfolio value is unchanged.`,
  };
}
