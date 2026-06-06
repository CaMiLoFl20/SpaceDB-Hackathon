import { ScheduleAt } from 'spacetimedb';
import {
  schema,
  table,
  t,
  SenderError,
  type ReducerCtx,
} from 'spacetimedb/server';
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
const INSTITUTION_BULLISH_CHANCE = 70n;
const GLOBAL_AI_CONFIG_ID = 'global';
const MARKET_TICK_INTERVAL_MICROS = 30_000_000n;

const AI_INSTITUTIONS = [
  'Titan Capital',
  'Northbridge Quant',
  'Atlas Pension',
  'Helios Market Making',
  'Sentinel Asset Management',
] as const;

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
  volume: t.u64(),
  updatedAt: t.timestamp(),
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
  createdAt: t.timestamp(),
  isAiGenerated: t.bool(),
};

const playerDirectoryRow = {
  owner: t.identity().primaryKey(),
  name: t.string(),
  nameKey: t.string().unique(),
  updatedAt: t.timestamp(),
};

const leaderboardRow = t.object('LeaderboardRow', {
  owner: t.identity(),
  name: t.string(),
  balanceCents: t.u64(),
  estimatedPortfolioValueCents: t.u64(),
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

const spacetimedb = schema({
  llmConfig,
  globalAiConfig,
  tickTimer,
  stock,
  account,
  holding,
  tradeLedger,
  recentTrade,
  marketNews,
  playerDirectory,
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

function recordTrade(
  ctx: ModuleCtx,
  symbol: string,
  side: 'buy' | 'sell',
  shares: bigint,
  priceCents: bigint,
  totalCents: bigint
): void {
  ctx.db.tradeLedger.insert({
    id: 0n,
    owner: ctx.sender,
    symbol,
    side,
    shares,
    priceCents,
    totalCents,
    createdAt: ctx.timestamp,
  });
  ctx.db.recentTrade.insert({
    id: 0n,
    trader: ctx.sender,
    symbol,
    side,
    shares,
    priceCents,
    totalCents,
    createdAt: ctx.timestamp,
  });
}

type StockRow = {
  symbol: string;
  name: string;
  priceCents: bigint;
  previousPriceCents: bigint;
  volume: bigint;
  updatedAt: ModuleCtx['timestamp'];
};

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

function debugGenerateNews(message: string): void {
  console.log(`[generate_demo_news] ${message}`);
}

function executeInstitutionalBuy(
  ctx: ModuleCtx,
  stockRow: StockRow,
  institution: string,
  shares: bigint,
  behavior:
    | 'accumulation'
    | 'momentum_buying'
    | 'buy_the_dip'
    | 'sector_rotation'
): StockRow {
  const updated = applyMarketActivity(ctx, stockRow, 'buy', shares, shares);
  const copy = {
    accumulation: {
      headline: `${updated.symbol} Institutional Accumulation`,
      body: `${institution} expanded institutional accumulation in ${updated.symbol}, adding ${shares.toString()} shares as unusual volume builds and retail buying pressure continues.`,
    },
    momentum_buying: {
      headline: `${updated.symbol} Momentum Buying`,
      body: `${institution} joined momentum buying in ${updated.symbol}, lifting ${shares.toString()} shares as price action attracts systematic flows.`,
    },
    buy_the_dip: {
      headline: `${updated.symbol} Buy-The-Dip Support`,
      body: `${institution} stepped in to buy the dip in ${updated.symbol}, purchasing ${shares.toString()} shares after a brief pullback drew institutional attention.`,
    },
    sector_rotation: {
      headline: `${updated.symbol} Sector Rotation Inflow`,
      body: `${institution} rotated capital into ${updated.symbol}, acquiring ${shares.toString()} shares as sector leadership shifts toward the name.`,
    },
  }[behavior];
  insertAiNews(ctx, copy.headline, copy.body, updated.symbol);
  return updated;
}

function executeInstitutionalSell(
  ctx: ModuleCtx,
  stockRow: StockRow,
  institution: string,
  shares: bigint,
  behavior: 'profit_taking' | 'reduce_exposure' | 'risk_off_selling'
): StockRow {
  const updated = applyMarketActivity(ctx, stockRow, 'sell', shares, shares);
  const copy = {
    profit_taking: {
      headline: `${updated.symbol} Profit-Taking Wave`,
      body: `${institution} executed AI-driven profit-taking in ${updated.symbol}, distributing ${shares.toString()} shares after an extended rally above recent reference levels.`,
    },
    reduce_exposure: {
      headline: `${updated.symbol} Exposure Reduction`,
      body: `${institution} reduced exposure to ${updated.symbol}, selling ${shares.toString()} shares as desks rebalance risk after unusual volume.`,
    },
    risk_off_selling: {
      headline: `${updated.symbol} Risk-Off Selling`,
      body: `${institution} moved risk-off in ${updated.symbol}, unloading ${shares.toString()} shares amid heavier selling pressure across the tape.`,
    },
  }[behavior];
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
  if (stockRow.volume > MAX_U64 - volumeShares) {
    senderError('Stock volume is too large');
  }
  const { previousPriceCents, priceCents } = applyPriceImpact(
    stockRow.priceCents,
    direction,
    impactShares
  );
  const updated: StockRow = {
    ...stockRow,
    previousPriceCents,
    priceCents,
    volume: stockRow.volume + volumeShares,
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
  const behaviors = [
    'accumulation',
    'momentum_buying',
    'sector_rotation',
    'momentum_buying',
  ] as const;
  const behavior = behaviors[Number((seed / 8n) % BigInt(behaviors.length))]!;
  return executeInstitutionalBuy(ctx, stockRow, institution, aiShares, behavior);
}

function maybeInstitutionalProfitTaking(ctx: ModuleCtx, stockRow: StockRow): StockRow {
  if (!isStockUpAtLeastEightPercent(stockRow)) return stockRow;

  const seed = actionSeed(ctx, stockRow.symbol, stockRow.priceCents, 2n);
  if (!shouldAct(seed, 22n)) return stockRow;

  const institution = pickInstitution(seed + 3n);
  const aiShares = deterministicRange(seed / 16n, 2_000n, 8_000n);
  const behavior = seed % 3n === 0n ? 'reduce_exposure' : 'profit_taking';
  return executeInstitutionalSell(ctx, stockRow, institution, aiShares, behavior);
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
    return executeInstitutionalBuy(ctx, stockRow, institution, aiShares, 'buy_the_dip');
  }

  if (!isStockUpAtLeastEightPercent(stockRow)) {
    return executeInstitutionalBuy(ctx, stockRow, institution, aiShares, 'accumulation');
  }

  return executeInstitutionalSell(
    ctx,
    stockRow,
    institution,
    aiShares,
    seed % 2n === 0n ? 'reduce_exposure' : 'risk_off_selling'
  );
}

type SeedCtx = Pick<ModuleCtx, 'db' | 'timestamp'>;

function getGlobalAiConfig(ctx: ModuleCtx) {
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

function runInstitutionalMarketEvent(ctx: ModuleCtx): void {
  const stocks = [...ctx.db.stock.iter()];
  if (stocks.length === 0) return;

  const micros = ctx.timestamp.microsSinceUnixEpoch;
  const seed = actionSeed(ctx, 'MARKET_TICK', micros, 99n);
  const stockRow = stocks[Number(seed % BigInt(stocks.length))]!;
  const institution = pickInstitution(seed);
  const shares = deterministicRange(seed / 32n, 2_000n, 10_000n);
  const roll = seed % 100n;

  if (roll < INSTITUTION_BULLISH_CHANCE) {
    const behaviors = [
      'accumulation',
      'momentum_buying',
      'buy_the_dip',
      'sector_rotation',
    ] as const;
    const behavior = behaviors[Number((seed / 11n) % BigInt(behaviors.length))]!;
    executeInstitutionalBuy(ctx, stockRow, institution, shares, behavior);
    return;
  }

  if (isStockUpAtLeastEightPercent(stockRow) && roll < 88n) {
    const behavior = roll % 2n === 0n ? 'profit_taking' : 'reduce_exposure';
    executeInstitutionalSell(ctx, stockRow, institution, shares, behavior);
    return;
  }

  executeInstitutionalBuy(ctx, stockRow, institution, shares, 'accumulation');
}

function ensureMarketSeeded(ctx: SeedCtx): void {
  const now = ctx.timestamp;

  for (const seed of SEED_STOCKS) {
    if (ctx.db.stock.symbol.find(seed.symbol) != null) continue;
    ctx.db.stock.insert({
      symbol: seed.symbol,
      name: seed.name,
      priceCents: seed.priceCents,
      previousPriceCents: seed.priceCents,
      volume: 0n,
      updatedAt: now,
    });
  }

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
  ensureMarketTickScheduled(ctx);
});

export const market_tick = spacetimedb.reducer(
  { timer: tickTimer.rowType },
  (ctx, _args) => {
    runInstitutionalMarketEvent(ctx);
  }
);

export const onConnect = spacetimedb.clientConnected(ctx => {
  ensureMarketSeeded(ctx);
  ensureMarketTickScheduled(ctx);

  if (!ctx.db.account.owner.find(ctx.sender)) {
    ctx.db.account.insert({
      owner: ctx.sender,
      balanceCents: STARTING_BALANCE_CENTS,
      updatedAt: ctx.timestamp,
    });
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

export const my_account = spacetimedb.view(
  { name: 'my_account', public: true },
  account.rowType.optional(),
  ctx => ctx.db.account.owner.find(ctx.sender) ?? undefined
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
    validateShares(shares);

    const playerAccount = requireAccount(ctx);
    const stockRow = requireStock(ctx, symbol);
    const totalCents = tradeTotalCents(stockRow.priceCents, shares);

    if (playerAccount.balanceCents < totalCents) {
      senderError('Insufficient funds');
    }

    ctx.db.account.owner.update({
      ...playerAccount,
      balanceCents: playerAccount.balanceCents - totalCents,
      updatedAt: ctx.timestamp,
    });

    const existingHolding = findHolding(ctx, ctx.sender, stockRow.symbol);
    if (existingHolding) {
      if (existingHolding.shares > MAX_U64 - shares) {
        senderError('Share count is too large');
      }
      ctx.db.holding.id.update({
        ...existingHolding,
        shares: existingHolding.shares + shares,
        updatedAt: ctx.timestamp,
      });
    } else {
      ctx.db.holding.insert({
        id: 0n,
        owner: ctx.sender,
        symbol: stockRow.symbol,
        shares,
        updatedAt: ctx.timestamp,
      });
    }

    const priceAtStart = stockRow.priceCents;

    recordTrade(
      ctx,
      stockRow.symbol,
      'buy',
      shares,
      priceAtStart,
      totalCents
    );

    let currentStock = applyMarketActivity(ctx, stockRow, 'buy', shares, shares);
    currentStock = reactInstitutionalToHumanBuy(ctx, currentStock, shares);
    maybeInstitutionalProfitTaking(ctx, currentStock);
  }
);

export const sell_stock = spacetimedb.reducer(
  { symbol: t.string(), shares: t.u64() },
  (ctx, { symbol, shares }) => {
    validateShares(shares);

    const playerAccount = requireAccount(ctx);
    const stockRow = requireStock(ctx, symbol);
    const existingHolding = findHolding(ctx, ctx.sender, stockRow.symbol);
    if (!existingHolding || existingHolding.shares < shares) {
      senderError('Insufficient shares');
    }

    const totalCents = tradeTotalCents(stockRow.priceCents, shares);
    if (playerAccount.balanceCents > MAX_U64 - totalCents) {
      senderError('Balance is too large');
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

    recordTrade(
      ctx,
      stockRow.symbol,
      'sell',
      shares,
      executionPrice,
      totalCents
    );

    const currentStock = applyMarketActivity(ctx, stockRow, 'sell', shares, shares);
    reactInstitutionalToHumanSell(ctx, currentStock, shares);
  }
);

function formatCentsAsDollars(cents: bigint): string {
  const dollars = cents / 100n;
  const remainder = (cents % 100n).toString().padStart(2, '0');
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
    const change = formatSignedPercentChange(
      stockRow.priceCents,
      stockRow.previousPriceCents
    );
    return {
      headline: `Unusual volume detected in ${linkedSymbol}`,
      body: `Retail buying pressure has lifted ${linkedSymbol} to $${formatCentsAsDollars(stockRow.priceCents)} (${change}) on ${stockRow.volume.toString()} shares traded. Institutional observers are monitoring the move.`,
    };
  }

  return {
    headline: 'Broad market activity continues',
    body: 'Participants remain active across multiple sectors. Unusual volume and institutional flows are shaping price action across the tape.',
  };
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

    const fallback = buildFallbackNews(setup.linkedSymbol, setup.stockRow);
    const config = setup.globalConfig;

    debugGenerateNews(`llm_config found: ${setup.legacyUserConfig != null}`);
    debugGenerateNews(`global_ai_config found: ${config != null}`);

    if (!config) {
      debugGenerateNews('provider: (none)');
      debugGenerateNews('model: (none)');
      debugGenerateNews('callChat invoked: false');
      debugGenerateNews('using fallback news: true');
      ctx.withTx(tx => {
        insertMarketNewsRow(
          tx,
          fallback.headline,
          fallback.body,
          setup.linkedSymbol,
          false
        );
      });
      return {};
    }

    debugGenerateNews(`provider: ${config.provider}`);
    debugGenerateNews(`model: ${config.model}`);

    validateProvider(config.provider);
    const provider = providers[config.provider];
    if (!provider) senderError(`llm.unknown_provider:${config.provider}`);

    const messages = buildNewsPrompt(
      setup.linkedSymbol,
      setup.stockRow,
      setup.recentActivity,
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
      debugGenerateNews('callChat succeeded: false');
      debugGenerateNews(`callChat error: ${formatChatError(result.error)}`);
      debugGenerateNews('using fallback news: true');
      ctx.withTx(tx => {
        insertMarketNewsRow(
          tx,
          fallback.headline,
          fallback.body,
          setup.linkedSymbol,
          false
        );
      });
      return {};
    }

    debugGenerateNews('callChat succeeded: true');
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
