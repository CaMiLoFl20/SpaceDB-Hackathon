export const FUND_TOTAL_SHARES = 1_000_000n;
export const FUND_PUBLIC_FLOAT_SHARES = 250_000n;
export const FUND_STARTING_NAV_CENTS = 10_000n;

export type FundKind = 'llm' | 'scripted';
export type FundRiskProfile = 'conservative' | 'moderate' | 'aggressive';

export type FundDefinition = {
  symbol: string;
  internalName: string;
  managerIdentityHex: string;
  kind: FundKind;
  riskProfile: FundRiskProfile;
};

export const FUND_ALIAS_POOL = [
  'Vanguard Strategic Growth',
  'Fidelity Capital Reserve',
  'BlackRock Horizon Fund',
  'T. Rowe Signal Trust',
  'PIMCO Dynamic Alpha',
  'Invesco Meridian Fund',
  'Capital Group Apex Trust',
  'Franklin Templeton Core',
  'Janus Henderson Vector',
  'State Street Summit Fund',
] as const;

export const SCRIPTED_FUND_DEFINITIONS = [
  {
    symbol: 'MKT1',
    internalName: 'Market Rotation Desk',
    managerIdentityHex:
      '0000000000000000000000000000000000000000000000000000000000000c01',
    kind: 'scripted',
    riskProfile: 'moderate',
  },
  {
    symbol: 'MKT2',
    internalName: 'Momentum Liquidity Desk',
    managerIdentityHex:
      '0000000000000000000000000000000000000000000000000000000000000c02',
    kind: 'scripted',
    riskProfile: 'aggressive',
  },
] as const satisfies readonly FundDefinition[];

export function fundAliasFor(symbol: string, sessionSeed: bigint): string {
  let symbolHash = 0n;
  for (let i = 0; i < symbol.length; i += 1) {
    symbolHash = symbolHash * 37n + BigInt(symbol.charCodeAt(i));
  }
  const index = Number((symbolHash + sessionSeed) % BigInt(FUND_ALIAS_POOL.length));
  return FUND_ALIAS_POOL[index]!;
}

export function computeFundSharePriceCents(
  portfolioValueCents: bigint,
  totalShares: bigint
): bigint {
  if (totalShares <= 0n) return FUND_STARTING_NAV_CENTS;
  const price = portfolioValueCents / totalShares;
  return price > 0n ? price : 1n;
}

export function computeConstituentWeightBps(
  positionValueCents: bigint,
  fundNavCents: bigint
): bigint {
  if (positionValueCents <= 0n || fundNavCents <= 0n) return 0n;
  return (positionValueCents * 10_000n) / fundNavCents;
}
