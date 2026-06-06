import {
  schema,
  table,
  t,
  SenderError,
  type ReducerCtx,
} from 'spacetimedb/server';
import { providers } from './llm';

const STARTING_BALANCE_CENTS = 1_000_000n;
const MAX_NAME_LENGTH = 20;
const MAX_U64 = (1n << 64n) - 1n;
const MIN_PRICE_CENTS = 100n;
const BASIS_POINTS_SCALE = 10_000n;
const LARGE_HUMAN_BUY_SHARES = 500n;
const LARGE_PRICE_INCREASE_BPS = 150n;

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

function maybeAiMomentumFollow(
  ctx: ModuleCtx,
  stockRow: StockRow,
  humanShares: bigint
): StockRow {
  if (humanShares < LARGE_HUMAN_BUY_SHARES) return stockRow;

  const seed = actionSeed(ctx, stockRow.symbol, humanShares, 1n);
  if (!shouldAct(seed, 45n)) return stockRow;

  const institution = pickInstitution(seed);
  const aiShares = deterministicRange(seed / 256n, 5_000n, 15_000n);
  const updated = applyMarketActivity(ctx, stockRow, 'buy', aiShares, aiShares);

  insertAiNews(
    ctx,
    `${updated.symbol} Institutional Follow-Through`,
    `Unusual volume in ${updated.symbol} after retail buying pressure prompted ${institution} to join institutional accumulation with ${aiShares.toString()} shares.`,
    updated.symbol
  );

  return updated;
}

function maybeAiProfitTaking(
  ctx: ModuleCtx,
  stockRow: StockRow,
  priceAtStart: bigint
): StockRow {
  const increaseBps = priceIncreaseBps(priceAtStart, stockRow.priceCents);
  if (increaseBps < LARGE_PRICE_INCREASE_BPS) return stockRow;

  const seed = actionSeed(ctx, stockRow.symbol, stockRow.priceCents, 2n);
  if (!shouldAct(seed, 40n)) return stockRow;

  const institution = pickInstitution(seed + 3n);
  const aiShares = deterministicRange(seed / 16n, 3_000n, 12_000n);
  const updated = applyMarketActivity(ctx, stockRow, 'sell', aiShares, aiShares);

  insertAiNews(
    ctx,
    `${updated.symbol} Profit-Taking Wave`,
    `${institution} executed AI-driven profit-taking, selling ${aiShares.toString()} shares of ${updated.symbol} after a sharp rally and unusual volume.`,
    updated.symbol
  );

  return updated;
}

type SeedCtx = Pick<ModuleCtx, 'db' | 'timestamp'>;

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
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  ensureMarketSeeded(ctx);

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
    currentStock = maybeAiMomentumFollow(ctx, currentStock, shares);
    maybeAiProfitTaking(ctx, currentStock, priceAtStart);
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

    applyMarketActivity(ctx, stockRow, 'sell', shares, shares);
  }
);

export const generate_demo_news = spacetimedb.reducer(
  { symbol: t.string().optional() },
  (ctx, { symbol }) => {
    const trimmed = symbol?.trim().toUpperCase();
    const linkedSymbol =
      trimmed && trimmed.length > 0 ? requireStock(ctx, trimmed).symbol : undefined;

    const headline = linkedSymbol
      ? `${linkedSymbol} draws trader attention`
      : 'Broad market activity continues';
    const body = linkedSymbol
      ? `Traders are watching ${linkedSymbol} after a burst of activity on the exchange floor.`
      : 'Participants are active across multiple sectors as the session continues.';

    ctx.db.marketNews.insert({
      id: 0n,
      headline,
      body,
      symbol: linkedSymbol,
      createdAt: ctx.timestamp,
      isAiGenerated: false,
    });
  }
);
