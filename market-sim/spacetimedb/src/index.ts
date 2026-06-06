import {
  schema,
  table,
  t,
  SenderError,
  type ReducerCtx,
} from 'spacetimedb/server';
import { providers } from './llm';

const STARTING_BALANCE_CENTS = 10_000_000n;
const MAX_NAME_LENGTH = 20;
const MAX_U64 = (1n << 64n) - 1n;

const SEED_STOCKS = [
  { symbol: 'ACME', name: 'Acme Corp', priceCents: 12_500n },
  { symbol: 'NEBX', name: 'Nebula Exchange', priceCents: 34_250n },
  { symbol: 'ORB', name: 'Orbital Logistics', priceCents: 5_875n },
  { symbol: 'SAGE', name: 'Sage Analytics', priceCents: 20_100n },
  { symbol: 'VOLT', name: 'Volt Energy', priceCents: 4_420n },
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

function bumpStockVolume(
  ctx: ModuleCtx,
  stockRow: StockRow,
  shares: bigint
): void {
  if (stockRow.volume > MAX_U64 - shares) {
    senderError('Stock volume is too large');
  }
  ctx.db.stock.symbol.update({
    ...stockRow,
    volume: stockRow.volume + shares,
    updatedAt: ctx.timestamp,
  });
}

export const init = spacetimedb.init(ctx => {
  const now = ctx.timestamp;

  for (const seed of SEED_STOCKS) {
    ctx.db.stock.insert({
      symbol: seed.symbol,
      name: seed.name,
      priceCents: seed.priceCents,
      previousPriceCents: seed.priceCents,
      volume: 0n,
      updatedAt: now,
    });
  }

  ctx.db.marketNews.insert({
    id: 0n,
    headline: 'Welcome to Market Sim',
    body: 'Trade fictional stocks in real time with other players. Prices update as the market moves — good luck!',
    symbol: undefined,
    createdAt: now,
    isAiGenerated: false,
  });
});

export const onConnect = spacetimedb.clientConnected(ctx => {
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

    recordTrade(
      ctx,
      stockRow.symbol,
      'buy',
      shares,
      stockRow.priceCents,
      totalCents
    );
    bumpStockVolume(ctx, stockRow, shares);
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

    recordTrade(
      ctx,
      stockRow.symbol,
      'sell',
      shares,
      stockRow.priceCents,
      totalCents
    );
    bumpStockVolume(ctx, stockRow, shares);
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
