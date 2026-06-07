import type { FundDefinition, FundRiskProfile } from './funds';

export type AiTraderBot = {
  name: string;
  nameKey: string;
  personality: FundRiskProfile;
  styleLabel: string;
  fundSymbol: string;
  identityHex: string;
  actChance: bigint;
  minSpendPct: bigint;
  maxSpendPct: bigint;
  minTradeCap: bigint;
  maxTradeCap: bigint;
};

export const AI_TRADER_BOTS = [
  {
    name: 'Cedar AI',
    nameKey: 'cedar ai',
    personality: 'conservative',
    styleLabel: 'Conservative value trader',
    fundSymbol: 'CEDR',
    identityHex:
      '0000000000000000000000000000000000000000000000000000000000000b01',
    actChance: 52n,
    minSpendPct: 2n,
    maxSpendPct: 8n,
    minTradeCap: 1n,
    maxTradeCap: 8n,
  },
  {
    name: 'Harbor AI',
    nameKey: 'harbor ai',
    personality: 'moderate',
    styleLabel: 'Balanced trend and value trader',
    fundSymbol: 'HARB',
    identityHex:
      '0000000000000000000000000000000000000000000000000000000000000b02',
    actChance: 68n,
    minSpendPct: 5n,
    maxSpendPct: 16n,
    minTradeCap: 2n,
    maxTradeCap: 14n,
  },
  {
    name: 'Apex AI',
    nameKey: 'apex ai',
    personality: 'aggressive',
    styleLabel: 'Aggressive momentum chaser',
    fundSymbol: 'APEX',
    identityHex:
      '0000000000000000000000000000000000000000000000000000000000000b03',
    actChance: 88n,
    minSpendPct: 10n,
    maxSpendPct: 28n,
    minTradeCap: 5n,
    maxTradeCap: 25n,
  },
] as const satisfies readonly AiTraderBot[];

export const AI_FUND_DEFINITIONS = AI_TRADER_BOTS.map(bot => ({
  symbol: bot.fundSymbol,
  internalName: bot.name,
  managerIdentityHex: bot.identityHex,
  kind: 'llm',
  riskProfile: bot.personality,
})) as readonly FundDefinition[];
