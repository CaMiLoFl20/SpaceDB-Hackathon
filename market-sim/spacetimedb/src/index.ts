import { Identity, ScheduleAt } from 'spacetimedb';
import {
  schema,
  table,
  t,
  SenderError,
  type ProcedureCtx,
  type ReducerCtx,
} from 'spacetimedb/server';
import {
  buildAutoNewsLlmMessages,
  parseAutoNewsLlmResponse,
} from './ai_market_news';
import {
  buildSingleTraderLlmMessages,
  parseSingleTraderLlmResponse,
  type LlmTraderDecision,
} from './ai_trader_llm';
import {
  callChat,
  formatChatError,
  providers,
  type ChatMessage,
} from './llm';

const STARTING_BALANCE_CENTS = 1_000_000n;
const MAX_NAME_LENGTH = 20;
const MAX_U64 = (1n << 64n) - 1n;
const MIN_PRICE_CENTS = 100n;
const BASIS_POINTS_SCALE = 10_000n;
const LARGE_HUMAN_TRADE_SHARES = 500n;
const PROFIT_TAKING_MIN_BPS = 800n;
const TICK_BUY_CHANCE = 50n;
const TICK_SELL_CHANCE = 30n;
const TICK_RECENT_MOVE_BPS = 40n;
const TICK_MEAN_REVERSION_NUDGE = 14n;
const GLOBAL_AI_CONFIG_ID = 'global';
const AUTOMATIC_MARKET_MOVEMENT = false;
const AI_TRADER_BOTS_ENABLED = true;
const AI_TRADER_LLM_ENABLED = true;
const AI_AUTO_NEWS_ENABLED = true;
const MARKET_TICK_INTERVAL_MICROS = 30_000_000n;
const AI_NEWS_TRADE_BUMP_MICROS = 12_000_000n;
const AI_NEWS_MIN_CHECK_MICROS = 25_000_000n;
const AI_NEWS_MAX_CHECK_MICROS = 180_000_000n;
const AI_TRADER_MIN_CHECK_MICROS = 20_000_000n;
const AI_TRADER_MAX_CHECK_MICROS = 120_000_000n;
const AI_NOVA_INITIAL_DELAY_MICROS = 18_000_000n;
const AI_PULSE_INITIAL_DELAY_MICROS = 52_000_000n;
const AI_NEWS_INITIAL_DELAY_MICROS = 35_000_000n;
const MICROS_PER_DAY = 86_400_000_000n;
const HOUR_MICROS = 3_600_000_000n;
const PORTFOLIO_HISTORY_HOURS = 24n;

const AI_INSTITUTIONS = [
  'Titan Capital',
  'Northbridge Quant',
  'Atlas Pension',
  'Helios Market Making',
  'Sentinel Asset Management',
] as const;

const AI_TRADER_BOTS = [
  {
    name: 'Nova AI',
    nameKey: 'nova ai',
    personality: 'aggressive',
    styleLabel: 'Aggressive momentum chaser',
    identityHex:
      '0000000000000000000000000000000000000000000000000000000000000b01',
    actChance: 88n,
    minSpendPct: 10n,
    maxSpendPct: 28n,
    minTradeCap: 5n,
    maxTradeCap: 25n,
  },
  {
    name: 'Pulse AI',
    nameKey: 'pulse ai',
    personality: 'conservative',
    styleLabel: 'Conservative value trader',
    identityHex:
      '0000000000000000000000000000000000000000000000000000000000000b02',
    actChance: 52n,
    minSpendPct: 2n,
    maxSpendPct: 8n,
    minTradeCap: 1n,
    maxTradeCap: 8n,
  },
] as const;

type AiTraderBot = (typeof AI_TRADER_BOTS)[number];

// Top 5 US companies by market cap (June 2026). Prices are seed values in cents.
const SEED_STOCKS = [
  { symbol: 'NVDA', name: 'NVIDIA Corporation', priceCents: 20_570n },
  { symbol: 'AAPL', name: 'Apple Inc.', priceCents: 30_788n },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', priceCents: 36_632n },
  { symbol: 'MSFT', name: 'Microsoft Corporation', priceCents: 41_715n },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', priceCents: 24_603n },
] as const;

const llmConfigRow = {
  owner: t.identity().primaryKey(),
  provider: t.string(),
  apiKey: t.string(),
  model: t.string(),
  systemPrompt: t.string().optional(),
  updatedAt: t.timestamp(),
};

const globalAiConfigRow = {
  id: t.string().primaryKey(),
  provider: t.string(),
  apiKey: t.string(),
  model: t.string(),
  systemPrompt: t.string().optional(),
  updatedAt: t.timestamp(),
};

const tickTimerRow = {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
};

const stockRow = {
  symbol: t.string().primaryKey(),
  name: t.string(),
  priceCents: t.u64(),
  previousPriceCents: t.u64(),
  dayOpenPriceCents: t.u64(),
  tradingDayIndex: t.u64(),
  volume: t.u64(),
  updatedAt: t.timestamp().index('btree'),
};

const accountRow = {
  owner: t.identity().primaryKey(),
  balanceCents: t.u64(),
  updatedAt: t.timestamp(),
};

const holdingRow = {
  id: t.u64().primaryKey().autoInc(),
  owner: t.identity().index('btree'),
  symbol: t.string().index('btree'),
  shares: t.u64(),
  updatedAt: t.timestamp(),
};

const tradeLedgerRow = {
  id: t.u64().primaryKey().autoInc(),
  owner: t.identity().index('btree'),
  symbol: t.string(),
  side: t.string(),
  shares: t.u64(),
  priceCents: t.u64(),
  totalCents: t.u64(),
  createdAt: t.timestamp(),
};

const recentTradeRow = {
  id: t.u64().primaryKey().autoInc(),
  trader: t.identity(),
  symbol: t.string(),
  side: t.string(),
  shares: t.u64(),
  priceCents: t.u64(),
  totalCents: t.u64(),
  createdAt: t.timestamp(),
};

const marketNewsRow = {
  id: t.u64().primaryKey().autoInc(),
  headline: t.string(),
  body: t.string(),
  symbol: t.string().optional(),
  createdAt: t.timestamp().index('btree'),
  isAiGenerated: t.bool(),
};

const playerDirectoryRow = {
  owner: t.identity().primaryKey(),
  name: t.string().index('btree'),
  nameKey: t.string().unique(),
  updatedAt: t.timestamp(),
};

const RECENT_MARKET_NEWS_LIMIT = 20;

const portfolioSnapshotRow = {
  id: t.u64().primaryKey().autoInc(),
  owner: t.identity().index('btree'),
  hourStartMicros: t.i64(),
  portfolioValueCents: t.u64(),
  recordedAt: t.timestamp(),
};

const portfolioHistoryPointRow = t.object('PortfolioHistoryPoint', {
  hourStartMicros: t.i64(),
  portfolioValueCents: t.u64(),
});

const leaderboardRow = t.object('LeaderboardRow', {
  owner: t.identity(),
  name: t.string(),
  balanceCents: t.u64(),
  estimatedPortfolioValueCents: t.u64(),
});

const AI_TRADER_LOG_LIMIT = 50;

const aiTraderLogRow = t.object('AiTraderLogRow', {
  id: t.u64(),
  traderName: t.string(),
  traderStyle: t.string(),
  symbol: t.string(),
  side: t.string(),
  shares: t.u64(),
  priceCents: t.u64(),
  totalCents: t.u64(),
  createdAt: t.timestamp(),
});

const aiTraderMemoryRow = {
  owner: t.identity().primaryKey(),
  lastReasoning: t.string(),
  lastActionSummary: t.string(),
  lastDecisionSource: t.string(),
  updatedAt: t.timestamp(),
};

const aiTraderMindRow = t.object('AiTraderMindRow', {
  traderName: t.string(),
  traderStyle: t.string(),
  rank: t.u64(),
  portfolioValueCents: t.u64(),
  cashCents: t.u64(),
  lastReasoning: t.string(),
  lastActionSummary: t.string(),
  lastDecisionSource: t.string(),
  updatedAt: t.timestamp(),
});

const scheduledTimerRow = {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
};

const aiSchedulerStateRow = {
  key: t.string().primaryKey(),
  paused: t.bool(),
  lastError: t.string(),
  updatedAt: t.timestamp(),
};

const aiNewsStatusRow = t.object('AiNewsStatusRow', {
  active: t.bool(),
  paused: t.bool(),
  lastError: t.string(),
});

const llmConfig = table({ name: 'llm_config', public: false }, llmConfigRow);
const globalAiConfig = table(
  { name: 'global_ai_config', public: false },
  globalAiConfigRow
);
const tickTimer = table(
  {
    name: 'tick_timer',
    scheduled: (): any => market_tick,
  },
  tickTimerRow
);
const aiTraderNovaTimer = table(
  {
    name: 'ai_trader_nova_timer',
    scheduled: (): any => ai_trader_nova_tick,
  },
  scheduledTimerRow
);
const aiTraderPulseTimer = table(
  {
    name: 'ai_trader_pulse_timer',
    scheduled: (): any => ai_trader_pulse_tick,
  },
  scheduledTimerRow
);
const aiMarketNewsTimer = table(
  {
    name: 'ai_market_news_timer',
    scheduled: (): any => ai_market_news_tick,
  },
  scheduledTimerRow
);
const aiSchedulerState = table({ name: 'ai_scheduler_state' }, aiSchedulerStateRow);
const aiTraderMemory = table({ name: 'ai_trader_memory' }, aiTraderMemoryRow);
const stock = table({ name: 'stock', public: true }, stockRow);
const account = table({ name: 'account' }, accountRow);
const holding = table({ name: 'holding' }, holdingRow);
const tradeLedger = table({ name: 'trade_ledger' }, tradeLedgerRow);
const recentTrade = table({ name: 'recent_trade', public: true }, recentTradeRow);
const marketNews = table({ name: 'market_news', public: true }, marketNewsRow);
const playerDirectory = table(
  { name: 'player_directory', public: true },
  playerDirectoryRow
);
const portfolioSnapshot = table(
  {
    name: 'portfolio_snapshot',
    indexes: [
      {
        accessor: 'by_owner_hour',
        algorithm: 'btree',
        columns: ['owner', 'hourStartMicros'],
      },
    ],
  },
  portfolioSnapshotRow
);

const spacetimedb = schema({
  llmConfig,
  globalAiConfig,
  tickTimer,
  aiTraderNovaTimer,
  aiTraderPulseTimer,
  aiMarketNewsTimer,
  aiSchedulerState,
  aiTraderMemory,
  stock,
  account,
  holding,
  tradeLedger,
  recentTrade,
  marketNews,
  playerDirectory,
  portfolioSnapshot,
});
export default spacetimedb;

type ModuleCtx = ReducerCtx<typeof spacetimedb.schemaType>;

function senderError(message: string): never {
  throw new SenderError(message);
}

function validateProvider(provider: string): void {
  if (!Object.prototype.hasOwnProperty.call(providers, provider)) {
    senderError(`llm.unknown_provider:${provider}`);
  }
}

function validateConfig(provider: string, model: string): void {
  validateProvider(provider);
  if (model.trim().length === 0) senderError('llm.model_required');
}

function resolveApiKey(
  existingProvider: string | undefined,
  existingApiKey: string | undefined,
  provider: string,
  apiKey: string | undefined
): string {
  const nextApiKey = apiKey?.trim();
  if (nextApiKey && nextApiKey.length > 0) return nextApiKey;
  if (
    existingProvider === provider &&
    existingApiKey &&
    existingApiKey.length > 0
  ) {
    return existingApiKey;
  }
  senderError('llm.api_key_required');
}

function requireAccount(ctx: ModuleCtx) {
  const row = ctx.db.account.owner.find(ctx.sender);
  if (!row) senderError('Account is not ready yet');
  return row;
}

function requireStock(ctx: ModuleCtx, symbol: string) {
  const trimmed = symbol.trim().toUpperCase();
  if (trimmed.length === 0) senderError('Stock symbol is required');
  const row = ctx.db.stock.symbol.find(trimmed);
  if (!row) senderError(`Unknown stock symbol: ${trimmed}`);
  return row;
}

function validateShares(shares: bigint): void {
  if (shares === 0n) senderError('Shares must be greater than zero');
}

function tradeTotalCents(priceCents: bigint, shares: bigint): bigint {
  if (shares > 0n && priceCents > MAX_U64 / shares) {
    senderError('Trade total is too large');
  }
  return priceCents * shares;
}

function findHolding(ctx: ModuleCtx, owner: ModuleCtx['sender'], symbol: string) {
  for (const row of ctx.db.holding.owner.filter(owner)) {
    if (row.symbol === symbol) return row;
  }
  return undefined;
}

function hourStartMicros(micros: bigint): bigint {
  return (micros / HOUR_MICROS) * HOUR_MICROS;
}

function computePortfolioValueCents(
  ctx: Pick<ModuleCtx, 'db'>,
  owner: ModuleCtx['sender']
): bigint {
  const playerAccount = ctx.db.account.owner.find(owner);
  if (!playerAccount) return 0n;

  let holdingsValue = 0n;
  for (const position of ctx.db.holding.owner.filter(owner)) {
    const stockRow = ctx.db.stock.symbol.find(position.symbol);
    if (!stockRow) continue;
    holdingsValue += position.shares * stockRow.priceCents;
  }

  const total = playerAccount.balanceCents + holdingsValue;
  return total < 0n ? 0n : total;
}

function pruneOldPortfolioSnapshots(ctx: ModuleCtx, owner: ModuleCtx['sender']): void {
  const cutoff =
    ctx.timestamp.microsSinceUnixEpoch - (PORTFOLIO_HISTORY_HOURS + 1n) * HOUR_MICROS;
  for (const row of ctx.db.portfolioSnapshot.owner.filter(owner)) {
    if (row.hourStartMicros < cutoff) {
      ctx.db.portfolioSnapshot.id.delete(row.id);
    }
  }
}

function recordPortfolioSnapshot(ctx: ModuleCtx, owner: ModuleCtx['sender']): void {
  if (!ctx.db.account.owner.find(owner)) return;

  const hourStart = hourStartMicros(ctx.timestamp.microsSinceUnixEpoch);
  const portfolioValueCents = computePortfolioValueCents(ctx, owner);
  const existing = [
    ...ctx.db.portfolioSnapshot.by_owner_hour.filter([owner, hourStart]),
  ][0];

  if (existing) {
    ctx.db.portfolioSnapshot.id.update({
      ...existing,
      portfolioValueCents,
      recordedAt: ctx.timestamp,
    });
  } else {
    ctx.db.portfolioSnapshot.insert({
      id: 0n,
      owner,
      hourStartMicros: hourStart,
      portfolioValueCents,
      recordedAt: ctx.timestamp,
    });
  }

  pruneOldPortfolioSnapshots(ctx, owner);
}

function snapshotAllPortfolios(ctx: ModuleCtx): void {
  for (const playerAccount of ctx.db.account.iter()) {
    recordPortfolioSnapshot(ctx, playerAccount.owner);
  }
}

type PlayerIdentity = ModuleCtx['sender'];

function botIdentity(hex: string): PlayerIdentity {
  return new Identity(hex);
}

function isAiTraderIdentity(owner: PlayerIdentity): boolean {
  for (const bot of AI_TRADER_BOTS) {
    if (botIdentity(bot.identityHex).isEqual(owner)) return true;
  }
  return false;
}

function ensureAiTradersSeeded(ctx: TimeCtx): void {
  if (!AI_TRADER_BOTS_ENABLED) return;

  for (const bot of AI_TRADER_BOTS) {
    const owner = botIdentity(bot.identityHex);

    if (!ctx.db.account.owner.find(owner)) {
      ctx.db.account.insert({
        owner,
        balanceCents: STARTING_BALANCE_CENTS,
        updatedAt: ctx.timestamp,
      });
    }

    if (!ctx.db.playerDirectory.owner.find(owner)) {
      ctx.db.playerDirectory.insert({
        owner,
        name: bot.name,
        nameKey: bot.nameKey,
        updatedAt: ctx.timestamp,
      });
    }
  }
}

function recordTrade(
  ctx: ModuleCtx,
  owner: PlayerIdentity,
  symbol: string,
  side: 'buy' | 'sell',
  shares: bigint,
  priceCents: bigint,
  totalCents: bigint
): void {
  ctx.db.tradeLedger.insert({
    id: 0n,
    owner,
    symbol,
    side,
    shares,
    priceCents,
    totalCents,
    createdAt: ctx.timestamp,
  });
  ctx.db.recentTrade.insert({
    id: 0n,
    trader: owner,
    symbol,
    side,
    shares,
    priceCents,
    totalCents,
    createdAt: ctx.timestamp,
  });
}

function executeBuyForOwner(
  ctx: ModuleCtx,
  owner: PlayerIdentity,
  symbol: string,
  shares: bigint,
  strict: boolean
): boolean {
  validateShares(shares);

  const playerAccount = ctx.db.account.owner.find(owner);
  if (!playerAccount) {
    if (strict) senderError('Account is not ready yet');
    return false;
  }

  const stockRow = requireStock(ctx, symbol);
  const totalCents = tradeTotalCents(stockRow.priceCents, shares);

  if (playerAccount.balanceCents < totalCents) {
    if (strict) senderError('Insufficient funds');
    return false;
  }

  ctx.db.account.owner.update({
    ...playerAccount,
    balanceCents: playerAccount.balanceCents - totalCents,
    updatedAt: ctx.timestamp,
  });

  const existingHolding = findHolding(ctx, owner, stockRow.symbol);
  if (existingHolding) {
    if (existingHolding.shares > MAX_U64 - shares) {
      if (strict) senderError('Share count is too large');
      return false;
    }
    ctx.db.holding.id.update({
      ...existingHolding,
      shares: existingHolding.shares + shares,
      updatedAt: ctx.timestamp,
    });
  } else {
    ctx.db.holding.insert({
      id: 0n,
      owner,
      symbol: stockRow.symbol,
      shares,
      updatedAt: ctx.timestamp,
    });
  }

  const priceAtStart = stockRow.priceCents;
  recordTrade(ctx, owner, stockRow.symbol, 'buy', shares, priceAtStart, totalCents);

  let currentStock = applyMarketActivity(ctx, stockRow, 'buy', shares, shares);
  if (AUTOMATIC_MARKET_MOVEMENT) {
    currentStock = reactInstitutionalToHumanBuy(ctx, currentStock, shares);
    maybeInstitutionalProfitTaking(ctx, currentStock);
  }
  recordPortfolioSnapshot(ctx, owner);
  requestPromptNewsCheck(ctx);
  return true;
}

function executeSellForOwner(
  ctx: ModuleCtx,
  owner: PlayerIdentity,
  symbol: string,
  shares: bigint,
  strict: boolean
): boolean {
  validateShares(shares);

  const playerAccount = ctx.db.account.owner.find(owner);
  if (!playerAccount) {
    if (strict) senderError('Account is not ready yet');
    return false;
  }

  const stockRow = requireStock(ctx, symbol);
  const existingHolding = findHolding(ctx, owner, stockRow.symbol);
  if (!existingHolding || existingHolding.shares < shares) {
    if (strict) senderError('Insufficient shares');
    return false;
  }

  const totalCents = tradeTotalCents(stockRow.priceCents, shares);
  if (playerAccount.balanceCents > MAX_U64 - totalCents) {
    if (strict) senderError('Balance is too large');
    return false;
  }

  ctx.db.account.owner.update({
    ...playerAccount,
    balanceCents: playerAccount.balanceCents + totalCents,
    updatedAt: ctx.timestamp,
  });

  if (existingHolding.shares === shares) {
    ctx.db.holding.delete(existingHolding);
  } else {
    ctx.db.holding.id.update({
      ...existingHolding,
      shares: existingHolding.shares - shares,
      updatedAt: ctx.timestamp,
    });
  }

  const executionPrice = stockRow.priceCents;
  recordTrade(ctx, owner, stockRow.symbol, 'sell', shares, executionPrice, totalCents);

  const currentStock = applyMarketActivity(ctx, stockRow, 'sell', shares, shares);
  if (AUTOMATIC_MARKET_MOVEMENT) {
    reactInstitutionalToHumanSell(ctx, currentStock, shares);
  }
  recordPortfolioSnapshot(ctx, owner);
  requestPromptNewsCheck(ctx);
  return true;
}

function runAiTraderCompetition(ctx: ModuleCtx): void {
  const stocks = [...ctx.db.stock.iter()];
  if (stocks.length === 0) return;

  const botStates = AI_TRADER_BOTS.map(bot => {
    const owner = botIdentity(bot.identityHex);
    return {
      bot,
      owner,
      portfolioValue: computePortfolioValueCents(ctx, owner),
    };
  }).sort((left, right) => {
    if (right.portfolioValue > left.portfolioValue) return 1;
    if (right.portfolioValue < left.portfolioValue) return -1;
    return left.bot.name.localeCompare(right.bot.name);
  });

  const leaderValue = botStates[0]?.portfolioValue ?? STARTING_BALANCE_CENTS;
  const micros = ctx.timestamp.microsSinceUnixEpoch;

  for (let index = 0; index < botStates.length; index += 1) {
    const state = botStates[index]!;
    const bot = state.bot;
    const seed = actionSeed(ctx, bot.name, micros, BigInt(index + 71));
    if (!shouldAct(seed, bot.actChance)) continue;

    const account = ctx.db.account.owner.find(state.owner);
    if (!account) continue;

    const behindLeader = state.portfolioValue < leaderValue;
    const cheapestPrice = stocks.reduce(
      (min, stock) => (stock.priceCents < min ? stock.priceCents : min),
      stocks[0]!.priceCents
    );
    const canAffordBuy = account.balanceCents >= cheapestPrice;
    const preferBuy =
      canAffordBuy && shouldBotPreferBuy(bot, behindLeader, seed);

    if (preferBuy) {
      let bought = false;
      for (let attempt = 0; attempt < stocks.length; attempt += 1) {
        const stock = pickBotStock(bot, stocks, seed, attempt);
        const shares = pickBotBuyShares(
          bot,
          account.balanceCents,
          stock.priceCents,
          seed + BigInt(attempt * 3)
        );
        if (shares === 0n) continue;
        if (executeBuyForOwner(ctx, state.owner, stock.symbol, shares, false)) {
          bought = true;
          break;
        }
      }
      if (bought) continue;
    }

    const holdings = [...ctx.db.holding.owner.filter(state.owner)];
    if (holdings.length === 0) continue;

    const holding =
      holdings[Number((seed / 19n) % BigInt(holdings.length))]!;
    const sellShares = pickBotSellShares(bot, holding.shares, seed);
    if (sellShares > 0n && sellShares <= holding.shares) {
      executeSellForOwner(ctx, state.owner, holding.symbol, sellShares, false);
    }
  }
}

type StockRow = {
  symbol: string;
  name: string;
  priceCents: bigint;
  previousPriceCents: bigint;
  dayOpenPriceCents: bigint;
  tradingDayIndex: bigint;
  volume: bigint;
  updatedAt: ModuleCtx['timestamp'];
};

function utcTradingDayIndex(micros: bigint): bigint {
  return micros / MICROS_PER_DAY;
}

type TimeCtx = Pick<ModuleCtx, 'db' | 'timestamp'>;

function rollStockTradingDay(ctx: TimeCtx, stockRow: StockRow): StockRow {
  const currentDay = utcTradingDayIndex(ctx.timestamp.microsSinceUnixEpoch);
  const needsInit = stockRow.tradingDayIndex === 0n;
  const dayChanged = stockRow.tradingDayIndex !== currentDay;

  if (!needsInit && !dayChanged) return stockRow;

  const rolled: StockRow = {
    ...stockRow,
    tradingDayIndex: currentDay,
    dayOpenPriceCents: stockRow.priceCents,
    updatedAt: ctx.timestamp,
  };
  ctx.db.stock.symbol.update(rolled);
  return rolled;
}

function rollAllStockTradingDays(ctx: TimeCtx): void {
  for (const stockRow of ctx.db.stock.iter()) {
    rollStockTradingDay(ctx, stockRow);
  }
}

function impactBasisPoints(shares: bigint): bigint {
  const raw = shares / 10n;
  if (raw < 5n) return 5n;
  if (raw > 1000n) return 1000n;
  return raw;
}

function applyPriceImpact(
  priceCents: bigint,
  direction: 'buy' | 'sell',
  shares: bigint
): { previousPriceCents: bigint; priceCents: bigint } {
  const bps = impactBasisPoints(shares);
  const previousPriceCents = priceCents;
  const factor =
    direction === 'buy'
      ? BASIS_POINTS_SCALE + bps
      : BASIS_POINTS_SCALE - bps;
  let nextPrice = (priceCents * factor) / BASIS_POINTS_SCALE;
  if (nextPrice < MIN_PRICE_CENTS) nextPrice = MIN_PRICE_CENTS;
  return { previousPriceCents, priceCents: nextPrice };
}

function priceIncreaseBps(fromPriceCents: bigint, toPriceCents: bigint): bigint {
  if (fromPriceCents === 0n) return 0n;
  return ((toPriceCents - fromPriceCents) * BASIS_POINTS_SCALE) / fromPriceCents;
}

function actionSeed(
  ctx: ModuleCtx,
  symbol: string,
  value: bigint,
  salt: bigint
): bigint {
  let symHash = 0n;
  for (let i = 0; i < symbol.length; i++) {
    symHash = symHash * 31n + BigInt(symbol.charCodeAt(i));
  }
  const micros = ctx.timestamp.microsSinceUnixEpoch;
  return (
    (micros ^ (value * 17n) ^ symHash ^ (salt * 1_000_003n)) &
    ((1n << 63n) - 1n)
  );
}

function shouldAct(seed: bigint, chanceOutOf100: bigint): boolean {
  return seed % 100n < chanceOutOf100;
}

function pickInstitution(seed: bigint): string {
  const index = Number(seed % BigInt(AI_INSTITUTIONS.length));
  return AI_INSTITUTIONS[index]!;
}

function deterministicRange(seed: bigint, min: bigint, max: bigint): bigint {
  const span = max - min + 1n;
  const offset = ((seed % span) + span) % span;
  return min + offset;
}

function pickBotBuyShares(
  bot: AiTraderBot,
  balanceCents: bigint,
  priceCents: bigint,
  seed: bigint
): bigint {
  if (priceCents === 0n || balanceCents < priceCents) return 0n;

  const maxAffordable = balanceCents / priceCents;
  const spendPct = deterministicRange(seed, bot.minSpendPct, bot.maxSpendPct);
  const budgetCents = (balanceCents * spendPct) / 100n;
  let shares = budgetCents / priceCents;
  if (shares < 1n) shares = 1n;
  if (shares > maxAffordable) shares = maxAffordable;

  const perTradeCap = deterministicRange(seed / 11n, bot.minTradeCap, bot.maxTradeCap);
  if (shares > perTradeCap) shares = perTradeCap;
  return shares > 0n ? shares : 0n;
}

function pickBotSellShares(
  bot: AiTraderBot,
  holdingShares: bigint,
  seed: bigint
): bigint {
  if (holdingShares === 0n) return 0n;
  if (holdingShares === 1n) return 1n;

  const maxSellCap = bot.personality === 'aggressive' ? 15n : 10n;
  const maxSell =
    holdingShares > maxSellCap ? maxSellCap : holdingShares;
  const minSell =
    bot.personality === 'conservative' ? 1n : maxSell > 4n ? 3n : 1n;
  return deterministicRange(seed / 17n, minSell, maxSell);
}

function shouldBotPreferBuy(
  bot: AiTraderBot,
  behindLeader: boolean,
  seed: bigint
): boolean {
  if (behindLeader) {
    if (bot.personality === 'aggressive') return true;
    return seed % 6n !== 0n;
  }

  if (bot.personality === 'aggressive') {
    return seed % 4n !== 0n;
  }

  return seed % 4n === 0n;
}

function pickBotStock(
  bot: AiTraderBot,
  stocks: StockRow[],
  seed: bigint,
  attempt: number
): StockRow {
  const index = Number((seed / 13n + BigInt(attempt)) % BigInt(stocks.length));

  if (bot.personality === 'aggressive') {
    const momentum = stocks.filter(row => row.priceCents >= row.dayOpenPriceCents);
    const pool = momentum.length > 0 ? momentum : stocks;
    return pool[index % pool.length]!;
  }

  const dips = stocks.filter(row => row.priceCents <= row.dayOpenPriceCents);
  const pool = dips.length > 0 ? dips : stocks;
  return pool[index % pool.length]!;
}

function insertAiNews(
  ctx: ModuleCtx,
  headline: string,
  body: string,
  symbol: string
): void {
  ctx.db.marketNews.insert({
    id: 0n,
    headline: `AI Market Mover: ${headline}`,
    body,
    symbol,
    createdAt: ctx.timestamp,
    isAiGenerated: true,
  });
}

function isStockUpAtLeastEightPercent(stockRow: StockRow): boolean {
  return (
    priceIncreaseBps(stockRow.previousPriceCents, stockRow.priceCents) >=
    PROFIT_TAKING_MIN_BPS
  );
}

function recentMoveBias(stockRow: StockRow): 'up' | 'down' | 'flat' {
  const bps = priceIncreaseBps(stockRow.previousPriceCents, stockRow.priceCents);
  if (bps >= TICK_RECENT_MOVE_BPS) return 'up';
  if (bps <= -TICK_RECENT_MOVE_BPS) return 'down';
  return 'flat';
}

function pickAmbientTickShares(seed: bigint): bigint {
  const sizeRoll = (seed / 32n) % 10n;
  if (sizeRoll < 3n) {
    return deterministicRange(seed / 64n, 400n, 2_000n);
  }
  if (sizeRoll < 8n) {
    return deterministicRange(seed / 32n, 2_000n, 8_000n);
  }
  return deterministicRange(seed / 16n, 6_000n, 14_000n);
}

type BullishNewsBehavior =
  | 'accumulation'
  | 'momentum_breakout'
  | 'momentum_surge'
  | 'buy_the_dip'
  | 'sector_rotation'
  | 'volume_spike'
  | 'analyst_alert'
  | 'short_squeeze_watch';

type BearishNewsBehavior = 'profit_taking' | 'reduce_exposure' | 'risk_off_selling';

const BULLISH_NEWS_BEHAVIORS = [
  'accumulation',
  'momentum_breakout',
  'momentum_surge',
  'buy_the_dip',
  'sector_rotation',
  'volume_spike',
  'analyst_alert',
  'short_squeeze_watch',
] as const satisfies readonly BullishNewsBehavior[];

function pickBullishNewsBehavior(seed: bigint): BullishNewsBehavior {
  return BULLISH_NEWS_BEHAVIORS[Number((seed / 11n) % BigInt(BULLISH_NEWS_BEHAVIORS.length))]!;
}

function pickAmbientSellBehavior(
  stockRow: StockRow,
  seed: bigint
): BearishNewsBehavior {
  if (!isStockUpAtLeastEightPercent(stockRow)) {
    return 'reduce_exposure';
  }

  const roll = seed % 10n;
  if (roll <= 1n) return 'risk_off_selling';
  if (roll <= 5n) return 'profit_taking';
  return 'reduce_exposure';
}

function buildBullishNewsCopy(
  symbol: string,
  institution: string,
  shares: bigint,
  behavior: BullishNewsBehavior,
  seed: bigint
): { headline: string; body: string } {
  const variant = Number((seed / 3n) % 3n);
  const shareText = shares.toString();

  const templates: Record<BullishNewsBehavior, { headline: string; body: string }[]> = {
    accumulation: [
      {
        headline: `BREAKING: ${institution} Builds Position in ${symbol}`,
        body: `${institution} is steadily accumulating ${symbol}, lifting ${shareText} shares as institutional desks add exposure and volume builds across the tape.`,
      },
      {
        headline: `${symbol} Draws Institutional Accumulation`,
        body: `Block activity points to sustained accumulation in ${symbol}. ${institution} added ${shareText} shares while systematic buyers keep pressing the offer.`,
      },
      {
        headline: `${institution} Expands ${symbol} Holdings`,
        body: `Institutional accumulation accelerated in ${symbol} with ${shareText} shares changing hands. Flow data suggests larger funds are building a longer-term position.`,
      },
    ],
    momentum_breakout: [
      {
        headline: `${symbol} Breaks Out on Heavy Momentum`,
        body: `${symbol} is pushing through resistance as ${institution} chases momentum with ${shareText} shares. Breakout traders are adding fuel to the move.`,
      },
      {
        headline: `Momentum Breakout: ${symbol} Rips Higher`,
        body: `Price action turned urgent in ${symbol}. ${institution} joined the breakout with ${shareText} shares as momentum funds lean into strength.`,
      },
      {
        headline: `${symbol} Surges Through Key Level`,
        body: `A momentum breakout in ${symbol} drew fast follow-through. ${institution} lifted ${shareText} shares while volume expands above recent averages.`,
      },
    ],
    momentum_surge: [
      {
        headline: `${symbol} Rips Higher as AI Funds Chase Momentum`,
        body: `Systematic and AI-driven desks are pressing ${symbol}. ${institution} bought ${shareText} shares as momentum signals flash across the tape.`,
      },
      {
        headline: `AI Momentum Surge Hits ${symbol}`,
        body: `${symbol} is catching a momentum surge. ${institution} added ${shareText} shares while quant and AI-linked flows accelerate into the close.`,
      },
      {
        headline: `${symbol} Accelerates on Quant Buying`,
        body: `Momentum models turned aggressively bullish on ${symbol}. ${institution} lifted ${shareText} shares as funds chase price strength.`,
      },
    ],
    buy_the_dip: [
      {
        headline: `${symbol} Stabilizes After Institutional Dip-Buying`,
        body: `After a brief pullback, ${institution} stepped in to buy ${shareText} shares of ${symbol}. Dip buyers are helping stabilize the tape.`,
      },
      {
        headline: `Institutions Buy the Dip in ${symbol}`,
        body: `${institution} used weakness to accumulate ${shareText} shares of ${symbol}. Support buyers are absorbing selling pressure near recent lows.`,
      },
      {
        headline: `${symbol} Finds Support on Dip-Buying`,
        body: `Institutional dip-buying emerged in ${symbol} as ${institution} picked up ${shareText} shares. The move is helping calm short-term volatility.`,
      },
    ],
    sector_rotation: [
      {
        headline: `Sector Rotation Inflow Lifts ${symbol}`,
        body: `Capital is rotating toward ${symbol}. ${institution} acquired ${shareText} shares as sector leadership shifts and allocators rebalance.`,
      },
      {
        headline: `${symbol} Benefits From Rotation Flows`,
        body: `Rotation desks are favoring ${symbol}. ${institution} added ${shareText} shares while inflows build against weaker sector peers.`,
      },
      {
        headline: `${institution} Rotates Into ${symbol}`,
        body: `Sector rotation models flagged ${symbol}. ${institution} lifted ${shareText} shares as funds move from laggards into relative strength.`,
      },
    ],
    volume_spike: [
      {
        headline: `Unusual Volume Detected in ${symbol}`,
        body: `Trading desks flagged a volume spike in ${symbol}. ${institution} was active for ${shareText} shares as participation jumps above recent norms.`,
      },
      {
        headline: `${symbol} Volume Spikes Across the Tape`,
        body: `Unusual volume hit ${symbol} with ${shareText} shares traded in the latest burst. ${institution} activity is drawing attention from floor brokers.`,
      },
      {
        headline: `Volume Alert: ${symbol} Activity Surges`,
        body: `A sharp volume spike in ${symbol} caught traders off guard. ${institution} moved ${shareText} shares while liquidity providers widen then tighten.`,
      },
    ],
    analyst_alert: [
      {
        headline: `Analyst Desk Alert: ${symbol} Flows Turn Active`,
        body: `Trading desk notes show rising interest in ${symbol}. ${institution} executed ${shareText} shares while strategists monitor positioning and liquidity.`,
      },
      {
        headline: `${symbol} on Desk Radar After Flow Pickup`,
        body: `Analyst desks flagged firmer flow in ${symbol}. ${institution} added ${shareText} shares as the name moves onto short-term watchlists.`,
      },
      {
        headline: `Desk Alert: ${symbol} Participation Improves`,
        body: `Flow screens turned constructive on ${symbol}. ${institution} lifted ${shareText} shares while desks track whether follow-through broadens.`,
      },
    ],
    short_squeeze_watch: [
      {
        headline: `Short Squeeze Watch: ${symbol} Pressure Builds`,
        body: `Borrow desks report tightening supply in ${symbol}. ${institution} bought ${shareText} shares as a squeeze watch intensifies and shorts cover.`,
      },
      {
        headline: `${symbol} Enters Short Squeeze Watch`,
        body: `Rising price and thin liquidity put ${symbol} on squeeze watch. ${institution} lifted ${shareText} shares while bearish positioning looks crowded.`,
      },
      {
        headline: `Squeeze Risk Rises in ${symbol}`,
        body: `Traders are watching squeeze risk in ${symbol}. ${institution} added ${shareText} shares as upward pressure forces defensive covering.`,
      },
    ],
  };

  return templates[behavior][variant]!;
}

function buildBearishNewsCopy(
  symbol: string,
  institution: string,
  shares: bigint,
  behavior: BearishNewsBehavior,
  seed: bigint
): { headline: string; body: string } {
  const variant = Number((seed / 7n) % 3n);
  const shareText = shares.toString();

  const templates: Record<BearishNewsBehavior, { headline: string; body: string }[]> = {
    profit_taking: [
      {
        headline: `${symbol} Faces Profit-Taking After Rally`,
        body: `After an extended run, ${institution} distributed ${shareText} shares of ${symbol}. Profit-taking is modest but enough to cool momentum near recent highs.`,
      },
      {
        headline: `Institutions Take Profits in ${symbol}`,
        body: `${institution} trimmed gains in ${symbol}, selling ${shareText} shares as desks lock in performance after a strong advance.`,
      },
      {
        headline: `${symbol} Pulls Back on Profit-Taking`,
        body: `Profit-taking surfaced in ${symbol} with ${shareText} shares offered by ${institution}. The move looks tactical rather than a broad risk unwind.`,
      },
    ],
    reduce_exposure: [
      {
        headline: `${symbol} Softens as Desks Reduce Exposure`,
        body: `${institution} reduced exposure to ${symbol}, selling ${shareText} shares while portfolio managers rebalance risk after heavy volume.`,
      },
      {
        headline: `Exposure Cuts Weigh on ${symbol}`,
        body: `Allocators eased up on ${symbol}. ${institution} moved ${shareText} shares to the offer side as exposure limits tighten.`,
      },
      {
        headline: `${institution} Trims ${symbol} Position`,
        body: `A measured exposure reduction hit ${symbol}. ${institution} sold ${shareText} shares as desks rebalance without signaling broad capitulation.`,
      },
    ],
    risk_off_selling: [
      {
        headline: `Cautionary Tone Hits ${symbol} as Funds De-Risk`,
        body: `A cautious risk backdrop pressured ${symbol}. ${institution} sold ${shareText} shares while macro desks reduce beta into uncertainty.`,
      },
      {
        headline: `${symbol} Slips on Defensive Positioning`,
        body: `Defensive flows nicked ${symbol}. ${institution} unloaded ${shareText} shares in a contained de-risking move across institutional books.`,
      },
      {
        headline: `Risk Caution Emerges in ${symbol}`,
        body: `Traders turned more defensive in ${symbol}. ${institution} cut ${shareText} shares as a brief risk-off pulse moves through the tape.`,
      },
    ],
  };

  return templates[behavior][variant]!;
}

function debugGenerateNews(message: string): void {
  console.log(`[generate_demo_news] ${message}`);
}

function debugAiConnection(message: string): void {
  console.log(`[ai_connection] ${message}`);
}

function debugAiTraderLlm(message: string): void {
  console.log(`[ai_trader_llm] ${message}`);
}

function executeInstitutionalBuy(
  ctx: ModuleCtx,
  stockRow: StockRow,
  institution: string,
  shares: bigint,
  behavior: BullishNewsBehavior,
  seed: bigint
): StockRow {
  const updated = applyMarketActivity(ctx, stockRow, 'buy', shares, shares);
  const copy = buildBullishNewsCopy(updated.symbol, institution, shares, behavior, seed);
  insertAiNews(ctx, copy.headline, copy.body, updated.symbol);
  return updated;
}

function executeInstitutionalSell(
  ctx: ModuleCtx,
  stockRow: StockRow,
  institution: string,
  shares: bigint,
  behavior: BearishNewsBehavior,
  seed: bigint
): StockRow {
  const updated = applyMarketActivity(ctx, stockRow, 'sell', shares, shares);
  const copy = buildBearishNewsCopy(updated.symbol, institution, shares, behavior, seed);
  insertAiNews(ctx, copy.headline, copy.body, updated.symbol);
  return updated;
}

function applyMarketActivity(
  ctx: ModuleCtx,
  stockRow: StockRow,
  direction: 'buy' | 'sell',
  impactShares: bigint,
  volumeShares: bigint
): StockRow {
  const currentStock = rollStockTradingDay(ctx, stockRow);

  if (currentStock.volume > MAX_U64 - volumeShares) {
    senderError('Stock volume is too large');
  }
  const { previousPriceCents, priceCents } = applyPriceImpact(
    currentStock.priceCents,
    direction,
    impactShares
  );
  const updated: StockRow = {
    ...currentStock,
    previousPriceCents,
    priceCents,
    volume: currentStock.volume + volumeShares,
    updatedAt: ctx.timestamp,
  };
  ctx.db.stock.symbol.update(updated);
  return updated;
}

function reactInstitutionalToHumanBuy(
  ctx: ModuleCtx,
  stockRow: StockRow,
  humanShares: bigint
): StockRow {
  const seed = actionSeed(ctx, stockRow.symbol, humanShares, 1n);
  const reacts =
    humanShares >= LARGE_HUMAN_TRADE_SHARES ? shouldAct(seed, 78n) : shouldAct(seed, 52n);
  if (!reacts) return stockRow;

  const institution = pickInstitution(seed);
  const aiShares = deterministicRange(seed / 256n, 3_000n, 12_000n);
  const behavior = pickBullishNewsBehavior(seed + 8n);
  return executeInstitutionalBuy(ctx, stockRow, institution, aiShares, behavior, seed);
}

function maybeInstitutionalProfitTaking(ctx: ModuleCtx, stockRow: StockRow): StockRow {
  if (!isStockUpAtLeastEightPercent(stockRow)) return stockRow;

  const seed = actionSeed(ctx, stockRow.symbol, stockRow.priceCents, 2n);
  if (!shouldAct(seed, 22n)) return stockRow;

  const institution = pickInstitution(seed + 3n);
  const aiShares = deterministicRange(seed / 16n, 2_000n, 8_000n);
  const behavior = seed % 4n === 0n ? 'reduce_exposure' : 'profit_taking';
  return executeInstitutionalSell(ctx, stockRow, institution, aiShares, behavior, seed);
}

function reactInstitutionalToHumanSell(
  ctx: ModuleCtx,
  stockRow: StockRow,
  humanShares: bigint
): StockRow {
  const seed = actionSeed(ctx, stockRow.symbol, humanShares, 3n);
  const reacts =
    humanShares >= LARGE_HUMAN_TRADE_SHARES ? shouldAct(seed, 72n) : shouldAct(seed, 45n);
  if (!reacts) return stockRow;

  const institution = pickInstitution(seed);
  const aiShares = deterministicRange(seed / 64n, 2_500n, 10_000n);
  const buyTheDip = shouldAct(seed + 1n, 68n);

  if (buyTheDip) {
    return executeInstitutionalBuy(
      ctx,
      stockRow,
      institution,
      aiShares,
      'buy_the_dip',
      seed
    );
  }

  if (!isStockUpAtLeastEightPercent(stockRow)) {
    const behavior = seed % 2n === 0n ? 'analyst_alert' : 'accumulation';
    return executeInstitutionalBuy(ctx, stockRow, institution, aiShares, behavior, seed);
  }

  if (!shouldAct(seed + 2n, 35n)) {
    return executeInstitutionalBuy(
      ctx,
      stockRow,
      institution,
      aiShares,
      'volume_spike',
      seed
    );
  }

  const behavior = seed % 3n === 0n ? 'profit_taking' : 'reduce_exposure';
  return executeInstitutionalSell(ctx, stockRow, institution, aiShares, behavior, seed);
}

type SeedCtx = Pick<ModuleCtx, 'db' | 'timestamp'>;

function getGlobalAiConfig(ctx: SeedCtx) {
  return ctx.db.globalAiConfig.id.find(GLOBAL_AI_CONFIG_ID);
}

function ensureMarketTickScheduled(ctx: SeedCtx): void {
  const hasTimer = [...ctx.db.tickTimer.iter()].length > 0;
  if (hasTimer) return;
  ctx.db.tickTimer.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.interval(MARKET_TICK_INTERVAL_MICROS),
  });
}

function clampDelayMicros(
  seconds: bigint,
  minMicros: bigint,
  maxMicros: bigint
): bigint {
  const micros = seconds * 1_000_000n;
  if (micros < minMicros) return minMicros;
  if (micros > maxMicros) return maxMicros;
  return micros;
}

function scheduleTimerAt(ctx: SeedCtx, dueMicros: bigint, target: 'nova' | 'pulse' | 'news'): void {
  const row = {
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(dueMicros),
  };
  if (target === 'nova') ctx.db.aiTraderNovaTimer.insert(row);
  else if (target === 'pulse') ctx.db.aiTraderPulseTimer.insert(row);
  else ctx.db.aiMarketNewsTimer.insert(row);
}

function scheduleTimerAfter(
  ctx: SeedCtx,
  delayMicros: bigint,
  target: 'nova' | 'pulse' | 'news'
): void {
  scheduleTimerAt(ctx, ctx.timestamp.microsSinceUnixEpoch + delayMicros, target);
}

function hasPendingTimer(ctx: SeedCtx, target: 'nova' | 'pulse' | 'news'): boolean {
  if (target === 'nova') return [...ctx.db.aiTraderNovaTimer.iter()].length > 0;
  if (target === 'pulse') return [...ctx.db.aiTraderPulseTimer.iter()].length > 0;
  return [...ctx.db.aiMarketNewsTimer.iter()].length > 0;
}

function getSchedulerState(ctx: SeedCtx, key: string) {
  return ctx.db.aiSchedulerState.key.find(key);
}

function setSchedulerState(
  ctx: SeedCtx,
  key: string,
  paused: boolean,
  lastError: string
): void {
  const row = {
    key,
    paused,
    lastError,
    updatedAt: ctx.timestamp,
  };
  const existing = ctx.db.aiSchedulerState.key.find(key);
  if (existing) ctx.db.aiSchedulerState.key.update(row);
  else ctx.db.aiSchedulerState.insert(row);
}

function ensureAiTraderTimersSeeded(ctx: SeedCtx): void {
  if (!AI_TRADER_BOTS_ENABLED || !AI_TRADER_LLM_ENABLED) return;
  if (!getGlobalAiConfig(ctx)) return;
  if (!hasPendingTimer(ctx, 'nova') && !getSchedulerState(ctx, 'nova_trader')?.paused) {
    scheduleTimerAfter(ctx, AI_NOVA_INITIAL_DELAY_MICROS, 'nova');
  }
  if (!hasPendingTimer(ctx, 'pulse') && !getSchedulerState(ctx, 'pulse_trader')?.paused) {
    scheduleTimerAfter(ctx, AI_PULSE_INITIAL_DELAY_MICROS, 'pulse');
  }
}

function ensureAutoNewsTimerSeeded(ctx: SeedCtx): void {
  if (!AI_AUTO_NEWS_ENABLED) return;
  if (getSchedulerState(ctx, 'auto_news')?.paused) return;
  if (!getGlobalAiConfig(ctx)) return;
  if (hasPendingTimer(ctx, 'news')) return;
  scheduleTimerAfter(ctx, AI_NEWS_INITIAL_DELAY_MICROS, 'news');
}

function resumeAutoNewsScheduler(ctx: ModuleCtx): void {
  setSchedulerState(ctx, 'auto_news', false, '');
  if (!hasPendingTimer(ctx, 'news')) {
    scheduleTimerAfter(ctx, AI_NEWS_INITIAL_DELAY_MICROS, 'news');
  }
}

function requestPromptNewsCheck(ctx: SeedCtx): void {
  if (!AI_AUTO_NEWS_ENABLED) return;
  if (getSchedulerState(ctx, 'auto_news')?.paused) return;
  if (!getGlobalAiConfig(ctx)) return;
  if (hasPendingTimer(ctx, 'news')) return;
  scheduleTimerAfter(ctx, AI_NEWS_TRADE_BUMP_MICROS, 'news');
}

function tradeActorLabel(ctx: ModuleCtx, trader: PlayerIdentity): string {
  for (const bot of AI_TRADER_BOTS) {
    if (botIdentity(bot.identityHex).isEqual(trader)) return bot.name;
  }
  return 'Retail trader';
}

function collectRecentTapeActivity(ctx: ModuleCtx, limit: number): string[] {
  return [...ctx.db.recentTrade.iter()]
    .sort((left, right) => {
      const diff =
        right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch;
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    })
    .slice(0, limit)
    .map(trade => {
      const actor = tradeActorLabel(ctx, trade.trader);
      return `${actor} ${trade.side} ${trade.shares.toString()} ${trade.symbol} @ $${centsToDollarString(trade.priceCents)}`;
    });
}

function buildAutoNewsContext(ctx: ModuleCtx): string {
  const stockLines = [...ctx.db.stock.iter()]
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .map(row => {
      const dayDelta = row.priceCents - row.dayOpenPriceCents;
      const sign = dayDelta >= 0n ? '+' : '';
      return `${row.symbol}: $${centsToDollarString(row.priceCents)} (${sign}$${centsToDollarString(dayDelta < 0n ? -dayDelta : dayDelta)} vs open, vol ${row.volume})`;
    });

  const tape = collectRecentTapeActivity(ctx, 12);
  const lastNews = [...ctx.db.marketNews.iter()]
    .sort((left, right) => {
      const diff =
        right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch;
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    })
    .slice(0, 3)
    .map(row => `${row.isAiGenerated ? 'AI' : 'Desk'}: ${row.headline}`);

  const lines = [
    'Live market tape — decide if a news headline is warranted right now.',
    '',
    'Stocks:',
    ...stockLines,
    '',
    'Recent trades (retail + Nova AI + Pulse AI):',
    ...(tape.length > 0 ? tape : ['(no recent trades)']),
    '',
    'Recent headlines already published:',
    ...(lastNews.length > 0 ? lastNews : ['(none yet)']),
  ];
  return lines.join('\n');
}

function centsToDollarString(cents: bigint): string {
  const safe = cents < 0n ? 0n : cents;
  const dollars = safe / 100n;
  const remainder = (safe % 100n).toString().padStart(2, '0');
  return `${dollars}.${remainder}`;
}

function clampBuyShares(
  bot: AiTraderBot,
  balanceCents: bigint,
  priceCents: bigint,
  requested: bigint
): bigint {
  if (requested === 0n || priceCents === 0n || balanceCents < priceCents) return 0n;
  const maxAffordable = balanceCents / priceCents;
  let shares = requested;
  if (shares > maxAffordable) shares = maxAffordable;
  if (shares > bot.maxTradeCap) shares = bot.maxTradeCap;
  return shares > 0n ? shares : 0n;
}

function clampSellShares(holdingShares: bigint, requested: bigint): bigint {
  if (requested === 0n || holdingShares === 0n) return 0n;
  return requested <= holdingShares ? requested : holdingShares;
}

function recordAiTraderMemory(
  ctx: ModuleCtx,
  owner: PlayerIdentity,
  reasoning: string,
  actionSummary: string,
  source: 'llm' | 'rules'
): void {
  const row = {
    owner,
    lastReasoning: reasoning,
    lastActionSummary: actionSummary,
    lastDecisionSource: source,
    updatedAt: ctx.timestamp,
  };
  const existing = ctx.db.aiTraderMemory.owner.find(owner);
  if (existing) {
    ctx.db.aiTraderMemory.owner.update(row);
  } else {
    ctx.db.aiTraderMemory.insert(row);
  }
}

function buildSingleBotLlmContext(ctx: ModuleCtx, focusBot: AiTraderBot): string {
  const leaderboard = [...ctx.db.playerDirectory.iter()]
    .map(player => ({
      name: player.name,
      portfolioValue: computePortfolioValueCents(ctx, player.owner),
      cashCents: ctx.db.account.owner.find(player.owner)?.balanceCents ?? 0n,
      owner: player.owner,
    }))
    .sort((left, right) => {
      if (right.portfolioValue > left.portfolioValue) return 1;
      if (right.portfolioValue < left.portfolioValue) return -1;
      return left.name.localeCompare(right.name);
    });

  const stockLines = [...ctx.db.stock.iter()]
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .map(row => {
      const dayDelta = row.priceCents - row.dayOpenPriceCents;
      const sign = dayDelta >= 0n ? '+' : '';
      return `${row.symbol}: $${centsToDollarString(row.priceCents)} (${sign}$${centsToDollarString(dayDelta < 0n ? -dayDelta : dayDelta)} vs open, vol ${row.volume})`;
    });

  const lines: string[] = [
    'Market snapshot:',
    ...stockLines,
    '',
    'Leaderboard (portfolio value):',
  ];

  leaderboard.forEach((entry, index) => {
    lines.push(
      `#${index + 1} ${entry.name}: $${centsToDollarString(entry.portfolioValue)} (cash $${centsToDollarString(entry.cashCents)})`
    );
  });

  const stockPrices = [...ctx.db.stock.iter()].map(row => row.priceCents);
  const cheapestStockCents =
    stockPrices.length > 0 ? stockPrices.reduce((min, price) => (price < min ? price : min)) : 0n;

  const tape = collectRecentTapeActivity(ctx, 8);
  lines.push('', 'Recent market tape:', ...(tape.length > 0 ? tape : ['(quiet)']));

  for (const bot of AI_TRADER_BOTS) {
    const owner = botIdentity(bot.identityHex);
    const memory = ctx.db.aiTraderMemory.owner.find(owner);
    const cashCents = ctx.db.account.owner.find(owner)?.balanceCents ?? 0n;
    const holdings = [...ctx.db.holding.owner.filter(owner)].map(position => {
      const stockRow = ctx.db.stock.symbol.find(position.symbol);
      const mark = stockRow ? position.shares * stockRow.priceCents : 0n;
      return `${position.shares} ${position.symbol} (mark $${centsToDollarString(mark)})`;
    });
    const canAffordAnyStock =
      cheapestStockCents > 0n && cashCents >= cheapestStockCents;
    const recentTrades = [...ctx.db.tradeLedger.owner.filter(owner)]
      .sort((left, right) => {
        const diff =
          right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch;
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      })
      .slice(0, 5)
      .map(
        trade =>
          `${trade.side} ${trade.shares} ${trade.symbol} @ $${centsToDollarString(trade.priceCents)}`
      );

    lines.push(
      '',
      `${bot.name} (${bot.styleLabel}):`,
      `Cash: $${centsToDollarString(cashCents)}${canAffordAnyStock ? '' : ' — CANNOT BUY (sell holdings first)'}`,
      `Holdings: ${holdings.length > 0 ? holdings.join(', ') : 'none'}`,
      `Recent trades: ${recentTrades.length > 0 ? recentTrades.join('; ') : 'none'}`,
      `Last thought (${memory?.lastDecisionSource ?? 'none'}): ${memory?.lastReasoning ?? 'n/a'}`,
      `Last action: ${memory?.lastActionSummary ?? 'n/a'}`
    );
  }

  lines.push(
    '',
    `You are deciding ONLY for ${focusBot.name}. Choose when to trade next independently of the other AI.`
  );
  return lines.join('\n');
}

function runSingleBotLlmTick(ctx: ProcedureCtx<typeof spacetimedb.schemaType>, bot: AiTraderBot): void {
  if (!AI_TRADER_BOTS_ENABLED || !AI_TRADER_LLM_ENABLED) return;

  const schedulerKey = bot.name === 'Nova AI' ? 'nova_trader' : 'pulse_trader';
  const setup = ctx.withTx(tx => {
    ensureAiTradersSeeded(tx);
    return {
      context: buildSingleBotLlmContext(tx, bot),
      globalConfig: getGlobalAiConfig(tx),
    };
  });

  if (!setup.globalConfig) {
    debugAiTraderLlm(`${bot.name}: no OpenAI config — idle`);
    return;
  }

  const config = setup.globalConfig;
  validateProvider(config.provider);
  const provider = providers[config.provider];
  if (!provider) return;

  debugAiTraderLlm(`${bot.name}: llm tick provider=${config.provider}`);
  const result = callChat(ctx.http, provider, {
    apiKey: config.apiKey,
    model: config.model,
    messages: buildSingleTraderLlmMessages(bot.name, bot.styleLabel, setup.context),
  });

  if (!result.ok) {
    const err = formatChatError(result.error);
    debugAiTraderLlm(`${bot.name}: llm failed — ${err}`);
    ctx.withTx(tx => setSchedulerState(tx, schedulerKey, true, err));
    return;
  }

  const decision = parseSingleTraderLlmResponse(result.response.text, bot.name);
  if (!decision) {
    debugAiTraderLlm(`${bot.name}: parse failed — reschedule`);
    ctx.withTx(tx => {
      setSchedulerState(tx, schedulerKey, false, '');
      scheduleTimerAfter(tx, clampDelayMicros(40n, AI_TRADER_MIN_CHECK_MICROS, AI_TRADER_MAX_CHECK_MICROS), bot.name === 'Nova AI' ? 'nova' : 'pulse');
    });
    return;
  }

  ctx.withTx(tx => {
    setSchedulerState(tx, schedulerKey, false, '');
    applyLlmTraderDecision(tx, decision);
    snapshotAllPortfolios(tx);
    const delay = clampDelayMicros(
      decision.nextCheckSeconds,
      AI_TRADER_MIN_CHECK_MICROS,
      AI_TRADER_MAX_CHECK_MICROS
    );
    scheduleTimerAfter(tx, delay, bot.name === 'Nova AI' ? 'nova' : 'pulse');
  });
  debugAiTraderLlm(`${bot.name}: next check in ${decision.nextCheckSeconds.toString()}s`);
}

function executeBotSellForCash(
  ctx: ModuleCtx,
  bot: AiTraderBot,
  owner: PlayerIdentity,
  reason: string
): boolean {
  const holdings = [...ctx.db.holding.owner.filter(owner)];
  if (holdings.length === 0) return false;

  const ranked = holdings
    .map(holding => {
      const stockRow = ctx.db.stock.symbol.find(holding.symbol);
      return {
        holding,
        mark: stockRow ? holding.shares * stockRow.priceCents : 0n,
      };
    })
    .sort((left, right) => {
      if (right.mark > left.mark) return 1;
      if (right.mark < left.mark) return -1;
      return left.holding.symbol.localeCompare(right.holding.symbol);
    });

  const target = ranked[0]!.holding;
  const sellShares = target.shares > 2n ? 2n : target.shares;
  if (
    executeSellForOwner(ctx, owner, target.symbol, sellShares, false)
  ) {
    debugAiTraderLlm(
      `${bot.name}: sell ${sellShares.toString()} ${target.symbol} (cash rescue) — ${reason}`
    );
    recordAiTraderMemory(ctx, owner, reason, `sell ${sellShares.toString()} ${target.symbol}`, 'llm');
    return true;
  }
  return false;
}

function applyLlmTraderDecision(
  ctx: ModuleCtx,
  decision: LlmTraderDecision
): boolean {
  const bot = AI_TRADER_BOTS.find(entry => entry.name === decision.botName);
  if (!bot) return false;

  const owner = botIdentity(bot.identityHex);
  const actionSummary =
    decision.action === 'hold'
      ? 'hold'
      : `${decision.action} ${decision.shares.toString()} ${decision.symbol}`;

  recordAiTraderMemory(ctx, owner, decision.reasoning, actionSummary, 'llm');

  if (decision.action === 'hold') {
    debugAiTraderLlm(`${bot.name}: hold — ${decision.reasoning}`);
    return false;
  }

  if (decision.action === 'buy') {
    const account = ctx.db.account.owner.find(owner);
    const stockRow = ctx.db.stock.symbol.find(decision.symbol);
    if (!account || !stockRow) {
      debugAiTraderLlm(`${bot.name}: buy skipped — missing account or stock`);
      return false;
    }
    const shares = clampBuyShares(
      bot,
      account.balanceCents,
      stockRow.priceCents,
      decision.shares
    );
    if (shares === 0n) {
      debugAiTraderLlm(
        `${bot.name}: buy skipped — insufficient cash ($${centsToDollarString(account.balanceCents)} for ${decision.symbol})`
      );
      return executeBotSellForCash(
        ctx,
        bot,
        owner,
        `Sold to raise cash after buy ${decision.symbol} was unaffordable.`
      );
    }
    if (executeBuyForOwner(ctx, owner, decision.symbol, shares, false)) {
      debugAiTraderLlm(
        `${bot.name}: buy ${shares.toString()} ${decision.symbol} — ${decision.reasoning}`
      );
      return true;
    }
    debugAiTraderLlm(`${bot.name}: buy failed execution for ${decision.symbol}`);
    return false;
  }

  const holding = findHolding(ctx, owner, decision.symbol);
  if (!holding) {
    debugAiTraderLlm(`${bot.name}: sell skipped — no ${decision.symbol} holdings`);
    return false;
  }
  const sellShares = clampSellShares(holding.shares, decision.shares);
  if (sellShares === 0n) {
    debugAiTraderLlm(`${bot.name}: sell skipped — invalid share count`);
    return false;
  }
  if (executeSellForOwner(ctx, owner, decision.symbol, sellShares, false)) {
    debugAiTraderLlm(
      `${bot.name}: sell ${sellShares.toString()} ${decision.symbol} — ${decision.reasoning}`
    );
    return true;
  }
  debugAiTraderLlm(`${bot.name}: sell failed execution for ${decision.symbol}`);
  return false;
}

function runInstitutionalMarketEvent(ctx: ModuleCtx): void {
  const stocks = [...ctx.db.stock.iter()];
  if (stocks.length === 0) return;

  const micros = ctx.timestamp.microsSinceUnixEpoch;
  const seed = actionSeed(ctx, 'MARKET_TICK', micros, 99n);
  const roll = seed % 100n;
  const stockIndex = Number((seed / 7n) % BigInt(stocks.length));
  const stockRow = stocks[stockIndex]!;

  let buyCutoff = TICK_BUY_CHANCE;
  let sellCutoff = TICK_BUY_CHANCE + TICK_SELL_CHANCE;
  const bias = recentMoveBias(stockRow);
  if (bias === 'up') {
    buyCutoff -= TICK_MEAN_REVERSION_NUDGE;
    sellCutoff -= TICK_MEAN_REVERSION_NUDGE;
  } else if (bias === 'down') {
    buyCutoff += TICK_MEAN_REVERSION_NUDGE;
    sellCutoff += TICK_MEAN_REVERSION_NUDGE;
  }

  if (roll >= sellCutoff) {
    return;
  }
  const institution = pickInstitution(seed + BigInt(stockIndex));
  const shares = pickAmbientTickShares(seed);

  if (roll < buyCutoff) {
    const behavior = pickBullishNewsBehavior(seed);
    executeInstitutionalBuy(ctx, stockRow, institution, shares, behavior, seed);
    return;
  }

  const sellBehavior = pickAmbientSellBehavior(stockRow, seed);
  executeInstitutionalSell(ctx, stockRow, institution, shares, sellBehavior, seed);
}

function ensureMarketSeeded(ctx: SeedCtx): void {
  const now = ctx.timestamp;

  const tradingDayIndex = utcTradingDayIndex(now.microsSinceUnixEpoch);

  for (const seed of SEED_STOCKS) {
    if (ctx.db.stock.symbol.find(seed.symbol) != null) continue;
    ctx.db.stock.insert({
      symbol: seed.symbol,
      name: seed.name,
      priceCents: seed.priceCents,
      previousPriceCents: seed.priceCents,
      dayOpenPriceCents: seed.priceCents,
      tradingDayIndex,
      volume: 0n,
      updatedAt: now,
    });
  }

  rollAllStockTradingDays(ctx);

  const hasNews = [...ctx.db.marketNews.iter()].length > 0;
  if (!hasNews) {
    ctx.db.marketNews.insert({
      id: 0n,
      headline: 'Welcome to Market Sim',
      body: 'Trade NVDA, AAPL, GOOGL, MSFT, and AMZN in real time with other players. Prices update as the market moves — good luck!',
      symbol: undefined,
      createdAt: now,
      isAiGenerated: false,
    });
  }
}

export const init = spacetimedb.init(ctx => {
  ensureMarketSeeded(ctx);
  ensureAiTradersSeeded(ctx);
  ensureMarketTickScheduled(ctx);
  ensureAiTraderTimersSeeded(ctx);
  ensureAutoNewsTimerSeeded(ctx);
});

export const market_tick = spacetimedb.reducer(
  { timer: tickTimer.rowType },
  (ctx, _args) => {
    ensureAiTraderTimersSeeded(ctx);
    ensureAutoNewsTimerSeeded(ctx);
    rollAllStockTradingDays(ctx);
    if (AUTOMATIC_MARKET_MOVEMENT) {
      runInstitutionalMarketEvent(ctx);
    } else if (AI_TRADER_BOTS_ENABLED && !AI_TRADER_LLM_ENABLED) {
      ensureAiTradersSeeded(ctx);
      runAiTraderCompetition(ctx);
    }
    snapshotAllPortfolios(ctx);
  }
);

export const ai_trader_nova_tick = spacetimedb.procedure(
  { timer: aiTraderNovaTimer.rowType },
  t.unit(),
  (ctx, _args) => {
    runSingleBotLlmTick(ctx, AI_TRADER_BOTS[0]!);
    return {};
  }
);

export const ai_trader_pulse_tick = spacetimedb.procedure(
  { timer: aiTraderPulseTimer.rowType },
  t.unit(),
  (ctx, _args) => {
    runSingleBotLlmTick(ctx, AI_TRADER_BOTS[1]!);
    return {};
  }
);

export const ai_market_news_tick = spacetimedb.procedure(
  { timer: aiMarketNewsTimer.rowType },
  t.unit(),
  (ctx, _args) => {
    if (!AI_AUTO_NEWS_ENABLED) return {};

    const setup = ctx.withTx(tx => ({
      context: buildAutoNewsContext(tx),
      globalConfig: getGlobalAiConfig(tx),
    }));

    if (!setup.globalConfig) {
      debugGenerateNews('auto news: no config — stopped');
      return {};
    }

    const config = setup.globalConfig;
    validateProvider(config.provider);
    const provider = providers[config.provider];
    if (!provider) return {};

    debugGenerateNews(`auto news tick provider=${config.provider}`);
    const result = callChat(ctx.http, provider, {
      apiKey: config.apiKey,
      model: config.model,
      messages: buildAutoNewsLlmMessages(setup.context),
    });

    if (!result.ok) {
      const err = formatChatError(result.error);
      debugGenerateNews(`auto news failed: ${err}`);
      debugAiConnection(`auto news stopped: ${err}`);
      ctx.withTx(tx => setSchedulerState(tx, 'auto_news', true, err));
      return {};
    }

    const decision = parseAutoNewsLlmResponse(result.response.text);
    if (!decision) {
      debugGenerateNews('auto news: parse failed — reschedule');
      ctx.withTx(tx => {
        setSchedulerState(tx, 'auto_news', false, '');
        scheduleTimerAfter(
          tx,
          clampDelayMicros(50n, AI_NEWS_MIN_CHECK_MICROS, AI_NEWS_MAX_CHECK_MICROS),
          'news'
        );
      });
      return {};
    }

    ctx.withTx(tx => {
      setSchedulerState(tx, 'auto_news', false, '');
      if (decision.publish) {
        insertMarketNewsRow(tx, decision.headline, decision.body, decision.symbol, true);
        debugGenerateNews(`auto news published: ${decision.headline}`);
        debugAiConnection(`auto news published via ${config.provider}`);
      } else {
        debugGenerateNews(`auto news skipped: ${decision.reasoning}`);
      }
      const delay = clampDelayMicros(
        decision.nextCheckSeconds,
        AI_NEWS_MIN_CHECK_MICROS,
        AI_NEWS_MAX_CHECK_MICROS
      );
      scheduleTimerAfter(tx, delay, 'news');
    });
    return {};
  }
);

export const onConnect = spacetimedb.clientConnected(ctx => {
  ensureMarketSeeded(ctx);
  ensureAiTradersSeeded(ctx);
  ensureMarketTickScheduled(ctx);
  ensureAiTraderTimersSeeded(ctx);
  ensureAutoNewsTimerSeeded(ctx);

  if (!ctx.db.account.owner.find(ctx.sender)) {
    ctx.db.account.insert({
      owner: ctx.sender,
      balanceCents: STARTING_BALANCE_CENTS,
      updatedAt: ctx.timestamp,
    });
  }

  recordPortfolioSnapshot(ctx, ctx.sender);
});

export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

export const my_account = spacetimedb.view(
  { name: 'my_account', public: true },
  account.rowType.optional(),
  ctx => ctx.db.account.owner.find(ctx.sender) ?? undefined
);

export const my_player = spacetimedb.view(
  { name: 'my_player', public: true },
  playerDirectory.rowType.optional(),
  ctx => ctx.db.playerDirectory.owner.find(ctx.sender) ?? undefined
);

export const recent_market_news = spacetimedb.view(
  { name: 'recent_market_news', public: true },
  t.array(marketNews.rowType),
  ctx =>
    [...ctx.db.marketNews.iter()]
      .sort((left, right) => {
        const diff =
          right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch;
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      })
      .slice(0, RECENT_MARKET_NEWS_LIMIT)
);

export const ai_news_status = spacetimedb.view(
  { name: 'ai_news_status', public: true },
  t.array(aiNewsStatusRow),
  ctx => {
    const config = ctx.db.globalAiConfig.id.find(GLOBAL_AI_CONFIG_ID);
    const state = ctx.db.aiSchedulerState.key.find('auto_news');
    const paused = state?.paused ?? false;
    const lastError = state?.lastError ?? '';
    return [
      {
        active: config != null && !paused && AI_AUTO_NEWS_ENABLED,
        paused,
        lastError,
      },
    ];
  }
);

export const market_stocks = spacetimedb.anonymousView(
  { name: 'market_stocks', public: true },
  t.array(stock.rowType),
  ctx =>
    [...ctx.db.stock.iter()].sort((left, right) => left.symbol.localeCompare(right.symbol))
);

export const my_holdings = spacetimedb.view(
  { name: 'my_holdings', public: true },
  t.array(holding.rowType),
  ctx => [...ctx.db.holding.owner.filter(ctx.sender)]
);

export const my_trades = spacetimedb.view(
  { name: 'my_trades', public: true },
  t.array(tradeLedger.rowType),
  ctx => [...ctx.db.tradeLedger.owner.filter(ctx.sender)]
);

export const my_portfolio_history = spacetimedb.view(
  { name: 'my_portfolio_history', public: true },
  t.array(portfolioHistoryPointRow),
  ctx =>
    [...ctx.db.portfolioSnapshot.owner.filter(ctx.sender)]
      .sort((left, right) => {
        if (left.hourStartMicros < right.hourStartMicros) return -1;
        if (left.hourStartMicros > right.hourStartMicros) return 1;
        return 0;
      })
      .map(row => ({
        hourStartMicros: row.hourStartMicros,
        portfolioValueCents: row.portfolioValueCents,
      }))
);

function portfolioValueForOwner(
  db: ModuleCtx['db'],
  owner: PlayerIdentity
): bigint {
  const playerAccount = db.account.owner.find(owner);
  if (!playerAccount) return 0n;

  let holdingsValue = 0n;
  for (const position of db.holding.owner.filter(owner)) {
    const stockRow = db.stock.symbol.find(position.symbol);
    if (!stockRow) continue;
    holdingsValue += position.shares * stockRow.priceCents;
  }

  const total = playerAccount.balanceCents + holdingsValue;
  return total < 0n ? 0n : total;
}

export const ai_trader_minds = spacetimedb.view(
  { name: 'ai_trader_minds', public: true },
  t.array(aiTraderMindRow),
  ctx => {
    const leaderboard = [...ctx.db.playerDirectory.iter()]
      .map(player => ({
        owner: player.owner,
        name: player.name,
        portfolioValue: portfolioValueForOwner(ctx.db as ModuleCtx['db'], player.owner),
        cashCents: ctx.db.account.owner.find(player.owner)?.balanceCents ?? 0n,
      }))
      .sort((left, right) => {
        if (right.portfolioValue > left.portfolioValue) return 1;
        if (right.portfolioValue < left.portfolioValue) return -1;
        return left.name.localeCompare(right.name);
      });

    return AI_TRADER_BOTS.map(bot => {
      const owner = botIdentity(bot.identityHex);
      const memory = ctx.db.aiTraderMemory.owner.find(owner);
      const player = ctx.db.playerDirectory.owner.find(owner);
      const portfolioValue = portfolioValueForOwner(ctx.db as ModuleCtx['db'], owner);
      const cashCents = ctx.db.account.owner.find(owner)?.balanceCents ?? 0n;
      const rankIndex = leaderboard.findIndex(entry => entry.owner.isEqual(owner));

      return {
        traderName: player?.name ?? bot.name,
        traderStyle: bot.styleLabel,
        rank: rankIndex >= 0 ? BigInt(rankIndex + 1) : 0n,
        portfolioValueCents: portfolioValue,
        cashCents,
        lastReasoning: memory?.lastReasoning ?? 'Waiting for first LLM decision...',
        lastActionSummary: memory?.lastActionSummary ?? 'none',
        lastDecisionSource: memory?.lastDecisionSource ?? 'none',
        updatedAt: memory?.updatedAt ?? player!.updatedAt,
      };
    });
  }
);

export const ai_trader_log = spacetimedb.view(
  { name: 'ai_trader_log', public: true },
  t.array(aiTraderLogRow),
  ctx =>
    [...ctx.db.recentTrade.iter()]
      .filter(trade => isAiTraderIdentity(trade.trader))
      .sort((left, right) => {
        const diff =
          right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch;
        if (diff > 0n) return 1;
        if (diff < 0n) return -1;
        return 0;
      })
      .slice(0, AI_TRADER_LOG_LIMIT)
      .map(trade => {
        const player = ctx.db.playerDirectory.owner.find(trade.trader);
        const bot = AI_TRADER_BOTS.find(entry =>
          botIdentity(entry.identityHex).isEqual(trade.trader)
        );
        return {
          id: trade.id,
          traderName: player?.name ?? bot?.name ?? 'AI Trader',
          traderStyle: bot?.styleLabel ?? 'AI trader',
          symbol: trade.symbol,
          side: trade.side,
          shares: trade.shares,
          priceCents: trade.priceCents,
          totalCents: trade.totalCents,
          createdAt: trade.createdAt,
        };
      })
);

export const leaderboard = spacetimedb.view(
  { name: 'leaderboard', public: true },
  t.array(leaderboardRow),
  ctx => {
    const rows = [...ctx.db.playerDirectory.iter()].map(player => {
      const playerAccount = ctx.db.account.owner.find(player.owner);
      const balanceCents = playerAccount?.balanceCents ?? 0n;
      let holdingsValue = 0n;

      for (const position of ctx.db.holding.owner.filter(player.owner)) {
        const stockRow = ctx.db.stock.symbol.find(position.symbol);
        if (!stockRow) continue;
        const positionValue = position.shares * stockRow.priceCents;
        holdingsValue += positionValue;
      }

      return {
        owner: player.owner,
        name: player.name,
        balanceCents,
        estimatedPortfolioValueCents: balanceCents + holdingsValue,
      };
    });

    return rows.sort((left, right) => {
      if (right.estimatedPortfolioValueCents > left.estimatedPortfolioValueCents) {
        return 1;
      }
      if (right.estimatedPortfolioValueCents < left.estimatedPortfolioValueCents) {
        return -1;
      }
      return left.name.localeCompare(right.name);
    });
  }
);

export const set_llm_config = spacetimedb.reducer(
  {
    provider: t.string(),
    apiKey: t.string().optional(),
    model: t.string(),
    systemPrompt: t.string().optional(),
  },
  (ctx, { provider, apiKey, model, systemPrompt }) => {
    validateConfig(provider, model);

    const existing = ctx.db.llmConfig.owner.find(ctx.sender);
    const nextApiKey = resolveApiKey(
      existing?.provider,
      existing?.apiKey,
      provider,
      apiKey
    );

    const row = {
      owner: ctx.sender,
      provider,
      apiKey: nextApiKey,
      model,
      systemPrompt,
      updatedAt: ctx.timestamp,
    };

    if (existing) {
      ctx.db.llmConfig.owner.update(row);
    } else {
      ctx.db.llmConfig.insert(row);
    }
  }
);

export const get_llm_config_status = spacetimedb.procedure(
  {},
  t.object('LlmConfigStatus', {
    configured: t.bool(),
    provider: t.string().optional(),
    model: t.string().optional(),
    systemPrompt: t.string().optional(),
  }),
  ctx =>
    ctx.withTx(tx => {
      const config = tx.db.llmConfig.owner.find(tx.sender);
      return {
        configured: config != null,
        provider: config?.provider,
        model: config?.model,
        systemPrompt: config?.systemPrompt,
      };
    })
);

export const set_global_ai_config = spacetimedb.reducer(
  {
    provider: t.string(),
    apiKey: t.string().optional(),
    model: t.string(),
    systemPrompt: t.string().optional(),
  },
  (ctx, { provider, apiKey, model, systemPrompt }) => {
    validateConfig(provider, model);

    const existing = getGlobalAiConfig(ctx);
    const nextApiKey = resolveApiKey(
      existing?.provider,
      existing?.apiKey,
      provider,
      apiKey
    );

    const row = {
      id: GLOBAL_AI_CONFIG_ID,
      provider,
      apiKey: nextApiKey,
      model,
      systemPrompt,
      updatedAt: ctx.timestamp,
    };

    if (existing) {
      ctx.db.globalAiConfig.id.update(row);
    } else {
      ctx.db.globalAiConfig.insert(row);
    }

    resumeAutoNewsScheduler(ctx);
    setSchedulerState(ctx, 'nova_trader', false, '');
    setSchedulerState(ctx, 'pulse_trader', false, '');
    ensureAiTraderTimersSeeded(ctx);
  }
);

export const get_global_ai_config_status = spacetimedb.procedure(
  {},
  t.object('GlobalAiConfigStatus', {
    configured: t.bool(),
    provider: t.string().optional(),
    model: t.string().optional(),
    systemPrompt: t.string().optional(),
  }),
  ctx =>
    ctx.withTx(tx => {
      const config = tx.db.globalAiConfig.id.find(GLOBAL_AI_CONFIG_ID);
      return {
        configured: config != null,
        provider: config?.provider,
        model: config?.model,
        systemPrompt: config?.systemPrompt,
      };
    })
);

export const test_global_ai_connection = spacetimedb.procedure(
  {},
  t.object('AiConnectionStatus', {
    ok: t.bool(),
    message: t.string(),
    provider: t.string().optional(),
    model: t.string().optional(),
  }),
  ctx => {
    const config = ctx.withTx(tx => tx.db.globalAiConfig.id.find(GLOBAL_AI_CONFIG_ID));

    if (!config) {
      debugAiConnection('configured: false');
      return {
        ok: false,
        message: 'No global API key configured.',
        provider: undefined,
        model: undefined,
      };
    }

    debugAiConnection(
      `configured: true provider=${config.provider} model=${config.model}`
    );

    validateProvider(config.provider);
    const provider = providers[config.provider];
    if (!provider) {
      const message = `Unknown provider: ${config.provider}`;
      debugAiConnection(message);
      return { ok: false, message, provider: config.provider, model: config.model };
    }

    debugAiConnection('test call invoked');
    const result = callChat(ctx.http, provider, {
      apiKey: config.apiKey,
      model: config.model,
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    });

    if (!result.ok) {
      const message = formatChatError(result.error);
      debugAiConnection(`test call failed: ${message}`);
      return {
        ok: false,
        message,
        provider: config.provider,
        model: config.model,
      };
    }

    const message = `Connected to ${config.provider} (${config.model}).`;
    debugAiConnection('test call succeeded');
    return {
      ok: true,
      message,
      provider: config.provider,
      model: config.model,
    };
  }
);

export const seed_market = spacetimedb.reducer({}, ctx => {
  ensureMarketSeeded(ctx);
});

export const set_name = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    requireAccount(ctx);

    const displayName = name.trim();
    if (displayName.length === 0 || displayName.length > MAX_NAME_LENGTH) {
      senderError('Names must be between 1 and 20 characters');
    }

    const nameKey = displayName.toLowerCase();
    const taken = ctx.db.playerDirectory.nameKey.find(nameKey);
    if (taken && !taken.owner.isEqual(ctx.sender)) {
      senderError('That name is already in use');
    }

    const existing = ctx.db.playerDirectory.owner.find(ctx.sender);
    const row = {
      owner: ctx.sender,
      name: displayName,
      nameKey,
      updatedAt: ctx.timestamp,
    };

    if (existing) {
      ctx.db.playerDirectory.owner.update(row);
    } else {
      ctx.db.playerDirectory.insert(row);
    }
  }
);

export const buy_stock = spacetimedb.reducer(
  { symbol: t.string(), shares: t.u64() },
  (ctx, { symbol, shares }) => {
    executeBuyForOwner(ctx, ctx.sender, symbol, shares, true);
  }
);

export const sell_stock = spacetimedb.reducer(
  { symbol: t.string(), shares: t.u64() },
  (ctx, { symbol, shares }) => {
    executeSellForOwner(ctx, ctx.sender, symbol, shares, true);
  }
);

function formatCentsAsDollars(cents: bigint): string {
  const safeCents = cents < 0n ? 0n : cents;
  const dollars = safeCents / 100n;
  const remainder = (safeCents % 100n).toString().padStart(2, '0');
  return `${dollars.toLocaleString()}.${remainder}`;
}

function formatSignedPercentChange(current: bigint, previous: bigint): string {
  if (previous === 0n) return '0.00%';
  const bps = priceIncreaseBps(previous, current);
  const pct = Number(bps) / 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function resolveOptionalSymbol(symbol: string | undefined): string | undefined {
  const trimmed = symbol?.trim().toUpperCase();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function buildFallbackNews(
  linkedSymbol: string | undefined,
  stockRow: StockRow | undefined
): { headline: string; body: string } {
  if (linkedSymbol && stockRow) {
    const dayChange = formatSignedPercentChange(
      stockRow.priceCents,
      stockRow.dayOpenPriceCents
    );
    const price = formatCentsAsDollars(stockRow.priceCents);
    const volume = stockRow.volume.toString();
    const symbol = linkedSymbol;
    const templates = [
      {
        headline: `Unusual Volume Detected in ${symbol}`,
        body: `Trading desks flagged a volume spike in ${symbol} at $${price} (${dayChange} on the session). ${volume} shares have changed hands as institutional observers track the move.`,
      },
      {
        headline: `${symbol} on Momentum Watch`,
        body: `${symbol} is holding trader attention at $${price} (${dayChange} today) with ${volume} shares traded. Flow screens show a mix of systematic buying and cautious two-way action.`,
      },
      {
        headline: `Desk Alert: ${symbol} Flows Turn Mixed`,
        body: `Analyst desks note active but mixed flow in ${symbol}. The stock sits at $${price} (${dayChange} vs the open) on volume of ${volume} shares as the tape balances momentum and consolidation.`,
      },
      {
        headline: `BREAKING: ${symbol} Moves on Heavy Tape`,
        body: `${symbol} is moving on heavier-than-usual participation at $${price} (${dayChange} on the day). ${volume} shares have traded while institutional and retail pressure shape the session.`,
      },
    ];
    const index = Number(stockRow.volume % BigInt(templates.length));
    return templates[index]!;
  }

  const marketTemplates = [
    {
      headline: 'Cross-Sector Flows Stay Active',
      body: 'Participation remains broad across large-cap tech and growth names. Desks report a blend of momentum chasing, dip-buying, and selective profit-taking.',
    },
    {
      headline: 'Tape Watch: Institutional Flows Mixed',
      body: 'Institutional activity is shaping the session with rotation, accumulation, and measured exposure cuts across the market. No single narrative dominates the tape.',
    },
    {
      headline: 'BREAKING: Market Desk Roundup',
      body: 'Trading floors report urgent bursts of volume alongside quieter consolidation. Bullish momentum, neutral desk alerts, and occasional profit-taking are all in play.',
    },
  ];
  return marketTemplates[0]!;
}

function insertMarketNewsRow(
  ctx: ModuleCtx,
  headline: string,
  body: string,
  symbol: string | undefined,
  isAiGenerated: boolean
): void {
  ctx.db.marketNews.insert({
    id: 0n,
    headline,
    body,
    symbol,
    createdAt: ctx.timestamp,
    isAiGenerated,
  });
}

function collectRecentMarketActivity(ctx: ModuleCtx, limit: number): string[] {
  const rows = [...ctx.db.marketNews.iter()]
    .sort((left, right) => {
      const diff =
        right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch;
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    })
    .slice(0, limit);

  return rows.map(row => {
    const symbol = row.symbol ?? 'MARKET';
    return `${symbol}: ${row.headline}`;
  });
}

function collectInstitutionalContext(ctx: ModuleCtx, limit: number): string[] {
  const rows = [...ctx.db.marketNews.iter()]
    .filter(row => row.headline.startsWith('AI Market Mover:'))
    .sort((left, right) => {
      const diff =
        right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch;
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    })
    .slice(0, limit);

  return rows.map(row => row.body);
}

function buildNewsPrompt(
  linkedSymbol: string | undefined,
  stockRow: StockRow | undefined,
  recentActivity: string[],
  institutionalContext: string[],
  systemPrompt: string | undefined
): ChatMessage[] {
  const lines = [
    'Write one realistic market news item for a multiplayer stock simulator.',
    'Return JSON only with keys "headline" and "body".',
    'Never name individual retail traders.',
    'Use anonymized market language such as retail buying pressure, unusual volume, institutional accumulation, or AI-driven profit-taking.',
  ];

  if (linkedSymbol && stockRow) {
    lines.push(
      '',
      `Symbol: ${linkedSymbol}`,
      `Company: ${stockRow.name}`,
      `Current price: $${formatCentsAsDollars(stockRow.priceCents)}`,
      `Previous price: $${formatCentsAsDollars(stockRow.previousPriceCents)}`,
      `Price change: ${formatSignedPercentChange(stockRow.priceCents, stockRow.previousPriceCents)}`,
      `Volume: ${stockRow.volume.toString()} shares`
    );
  } else {
    lines.push('', 'Scope: broad market overview across all listed stocks.');
  }

  if (recentActivity.length > 0) {
    lines.push('', 'Recent market activity:', ...recentActivity.map(item => `- ${item}`));
  }

  if (institutionalContext.length > 0) {
    lines.push(
      '',
      'Institutional AI market mover context:',
      ...institutionalContext.map(item => `- ${item}`)
    );
  }

  const messages: ChatMessage[] = [];
  if (systemPrompt && systemPrompt.trim().length > 0) {
    messages.push({ role: 'system', content: systemPrompt });
  } else {
    messages.push({
      role: 'system',
      content:
        'You are a financial news desk writing concise, realistic market headlines for a simulated exchange.',
    });
  }
  messages.push({ role: 'user', content: lines.join('\n') });
  return messages;
}

function unwrapOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'tag' in value) {
    const option = value as { tag: string; value?: string };
    return option.tag === 'some' ? option.value : undefined;
  }
  return undefined;
}

function parseLlmNewsResponse(text: string): { headline: string; body: string } {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    const parsed = JSON.parse(candidate) as { headline?: unknown; body?: unknown };
    if (
      typeof parsed.headline === 'string' &&
      typeof parsed.body === 'string' &&
      parsed.headline.trim().length > 0 &&
      parsed.body.trim().length > 0
    ) {
      return {
        headline: parsed.headline.trim(),
        body: parsed.body.trim(),
      };
    }
  } catch {
    // Fall through to line-based parsing.
  }

  const headlineMatch = candidate.match(/"headline"\s*:\s*"([^"]+)"/i);
  const bodyMatch = candidate.match(/"body"\s*:\s*"([^"]+)"/i);
  if (headlineMatch && bodyMatch) {
    return {
      headline: headlineMatch[1]!.trim(),
      body: bodyMatch[1]!.trim(),
    };
  }

  const lines = candidate
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (lines.length >= 2) {
    return {
      headline: lines[0]!.replace(/^#+\s*/, ''),
      body: lines.slice(1).join('\n'),
    };
  }

  return {
    headline: 'Market bulletin',
    body: candidate,
  };
}

export const generate_demo_news = spacetimedb.procedure(
  { symbol: t.string().optional() },
  t.unit(),
  (ctx, { symbol }) => {
    const setup = ctx.withTx(tx => {
      const linkedSymbol = resolveOptionalSymbol(symbol);
      const stockRow = linkedSymbol
        ? tx.db.stock.symbol.find(linkedSymbol) ?? undefined
        : undefined;

      if (linkedSymbol && !stockRow) {
        senderError(`Unknown stock symbol: ${linkedSymbol}`);
      }

      const globalConfig = tx.db.globalAiConfig.id.find(GLOBAL_AI_CONFIG_ID);
      const legacyUserConfig = tx.db.llmConfig.owner.find(tx.sender);
      const recentActivity = collectRecentMarketActivity(tx, 5);
      const institutionalContext = collectInstitutionalContext(tx, 3);

      return {
        linkedSymbol,
        stockRow,
        globalConfig,
        legacyUserConfig,
        recentActivity,
        institutionalContext,
      };
    });

    const config = setup.globalConfig;

    debugGenerateNews(`llm_config found: ${setup.legacyUserConfig != null}`);
    debugGenerateNews(`global_ai_config found: ${config != null}`);

    if (!config) {
      debugGenerateNews('provider: (none) — manual news skipped');
      senderError('OpenAI is not configured. Add an API key in AI Settings.');
    }

    debugGenerateNews(`provider: ${config.provider}`);
    debugGenerateNews(`model: ${config.model}`);

    validateProvider(config.provider);
    const provider = providers[config.provider];
    if (!provider) senderError(`llm.unknown_provider:${config.provider}`);

    const tapeActivity = ctx.withTx(tx => collectRecentTapeActivity(tx, 10));
    const messages = buildNewsPrompt(
      setup.linkedSymbol,
      setup.stockRow,
      [...tapeActivity, ...setup.recentActivity],
      setup.institutionalContext,
      unwrapOptionalString(config.systemPrompt)
    );

    debugGenerateNews('callChat invoked: true');
    const result = callChat(ctx.http, provider, {
      apiKey: config.apiKey,
      model: config.model,
      messages,
    });

    if (!result.ok) {
      const err = formatChatError(result.error);
      debugGenerateNews('callChat succeeded: false');
      debugGenerateNews(`callChat error: ${err}`);
      debugAiConnection(`news generation failed: ${err}`);
      senderError(`OpenAI connection failed: ${err}`);
    }

    debugGenerateNews('callChat succeeded: true');
    debugAiConnection(`news generation succeeded via ${config.provider}`);
    debugGenerateNews('using fallback news: false');
    const parsed = parseLlmNewsResponse(result.response.text);

    ctx.withTx(tx => {
      insertMarketNewsRow(
        tx,
        parsed.headline,
        parsed.body,
        setup.linkedSymbol,
        true
      );
    });

    return {};
  }
);
