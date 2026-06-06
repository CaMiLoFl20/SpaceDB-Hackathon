import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Identity } from 'spacetimedb';
import { useProcedure, useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import './App.css';
import { procedures, reducers, tables } from './module_bindings';

const STARTING_CAPITAL_CENTS = 1_000_000n;
const GAIN_COLOR = '#15803d';
const LOSS_COLOR = '#b91c1c';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function defaultModel(provider: string) {
  return provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_OPENROUTER_MODEL;
}

const AI_INSTITUTIONS = [
  'Titan Capital',
  'Northbridge Quant',
  'Atlas Pension',
  'Helios Market Making',
  'Sentinel Asset Management',
] as const;

type LeaderboardEntry = {
  owner: Identity;
  name: string;
  balanceCents: bigint;
  estimatedPortfolioValueCents: bigint;
};

function formatMoney(cents: bigint) {
  const dollars = cents / 100n;
  const remainder = (cents % 100n).toString().padStart(2, '0');
  return `$${dollars.toLocaleString()}.${remainder}`;
}

function formatReturn(portfolioCents: bigint, startingCents: bigint) {
  const diff = portfolioCents - startingCents;
  const pct = Number((diff * 10000n) / startingCents) / 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function formatPriceChangePercent(current: bigint, previous: bigint) {
  if (previous === 0n) return '0.00%';
  const bps = Number(((current - previous) * 10000n) / previous) / 100;
  const sign = bps >= 0 ? '+' : '';
  return `${sign}${bps.toFixed(2)}%`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request failed.';
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'tag' in value) {
    const option = value as { tag: string; value?: string };
    return option.tag === 'some' ? option.value : undefined;
  }
  return undefined;
}

function parseShares(input: string): bigint | undefined {
  const value = input.trim();
  if (!/^\d+$/.test(value)) return undefined;
  const shares = BigInt(value);
  return shares > 0n ? shares : undefined;
}

function sortByTimeDesc<T extends { createdAt: { microsSinceUnixEpoch: bigint } }>(
  rows: readonly T[]
) {
  return [...rows].sort((left, right) =>
    Number(right.createdAt.microsSinceUnixEpoch - left.createdAt.microsSinceUnixEpoch)
  );
}

function sortLeaderboard(rows: readonly LeaderboardEntry[]) {
  return [...rows].sort((left, right) => {
    const valueDiff =
      right.estimatedPortfolioValueCents - left.estimatedPortfolioValueCents;
    if (valueDiff > 0n) return 1;
    if (valueDiff < 0n) return -1;
    return left.name.localeCompare(right.name);
  });
}

function computeHoldingsValue(
  holdings: readonly { symbol: string; shares: bigint }[],
  stocks: readonly { symbol: string; priceCents: bigint }[]
) {
  return holdings.reduce((sum, holding) => {
    const stock = stocks.find(row => row.symbol === holding.symbol);
    return sum + (stock ? holding.shares * stock.priceCents : 0n);
  }, 0n);
}

function findInstitution(text: string): string | undefined {
  return AI_INSTITUTIONS.find(institution => text.includes(institution));
}

function inferAiDirection(headline: string, body: string): string {
  const combined = `${headline} ${body}`.toLowerCase();
  if (combined.includes('profit-taking') || combined.includes('reduced exposure')) {
    return 'Profit-taking';
  }
  if (combined.includes('distributing') || combined.includes('selling pressure')) {
    return 'Distributing';
  }
  if (combined.includes('momentum') || combined.includes('follow-through')) {
    return 'Momentum buying';
  }
  if (combined.includes('accumulation') || combined.includes('accumulated')) {
    return 'Accumulating';
  }
  return 'Institutional activity';
}

function AiSettingsModal({
  apiKey,
  configured,
  error,
  loading,
  model,
  onApiKeyChange,
  onClose,
  onModelChange,
  onProviderChange,
  onSave,
  onSystemPromptChange,
  open,
  provider,
  saving,
  systemPrompt,
}: {
  apiKey: string;
  configured: boolean;
  error: string;
  loading: boolean;
  model: string;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onModelChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onSave: () => void;
  onSystemPromptChange: (value: string) => void;
  open: boolean;
  provider: string;
  saving: boolean;
  systemPrompt: string;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="config-modal"
        onClick={event => event.stopPropagation()}
      >
        <header>
          <h2>AI Settings</h2>
          <button onClick={onClose} type="button">
            Close
          </button>
        </header>
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          {configured
            ? 'Global AI configured for all players. Leave API key blank to keep the saved key.'
            : 'Set the global OpenAI or OpenRouter key once for everyone.'}
        </p>
        {error && <p style={{ color: LOSS_COLOR, margin: 0 }}>{error}</p>}
        <label>
          Provider
          <select
            disabled={loading || saving}
            onChange={event => onProviderChange(event.target.value)}
            value={provider}
          >
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </label>
        <label>
          API key
          <input
            autoComplete="off"
            disabled={loading || saving}
            onChange={event => onApiKeyChange(event.target.value)}
            placeholder={configured ? 'Leave blank to keep saved key' : 'sk-...'}
            type="password"
            value={apiKey}
          />
        </label>
        <label>
          Model
          <input
            disabled={loading || saving}
            onChange={event => onModelChange(event.target.value)}
            placeholder={defaultModel(provider)}
            value={model}
          />
        </label>
        <label>
          System prompt (optional)
          <textarea
            disabled={loading || saving}
            onChange={event => onSystemPromptChange(event.target.value)}
            rows={3}
            value={systemPrompt}
          />
        </label>
        <footer>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {loading ? 'Loading status...' : configured ? 'Configured' : 'Not configured'}
          </span>
          <button disabled={loading || saving} onClick={onSave} type="button">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function NameForm({
  initialName = '',
  onSubmit,
}: {
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit(name);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: '0.6rem' }}>
      <label htmlFor="display-name">Nickname</label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          autoFocus
          id="display-name"
          maxLength={20}
          onChange={event => setName(event.target.value)}
          placeholder="Choose a unique name"
          value={name}
        />
        <button disabled={!name.trim() || saving} type="submit">
          {saving ? 'Saving...' : 'Save name'}
        </button>
      </div>
    </form>
  );
}

function MetricTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div style={{ display: 'grid', gap: '0.2rem' }}>
      <span className="muted" style={{ fontSize: '0.8rem' }}>
        {label}
      </span>
      <strong style={{ fontSize: '1.1rem', color: accent }}>{value}</strong>
    </div>
  );
}

function App() {
  const { identity, isActive: connected } = useSpacetimeDB();
  const [accounts] = useTable(tables.my_account);
  const [holdings] = useTable(tables.my_holdings);
  const [myTrades] = useTable(tables.my_trades);
  const [stocks, stocksReady] = useTable(tables.stock);
  const [leaderboardRows] = useTable(tables.leaderboard);
  const [newsItems] = useTable(tables.marketNews);
  const [directory] = useTable(tables.playerDirectory);

  const setName = useReducer(reducers.setName);
  const setGlobalAiConfig = useReducer(reducers.setGlobalAiConfig);
  const seedMarket = useReducer(reducers.seedMarket);
  const buyStock = useReducer(reducers.buyStock);
  const sellStock = useReducer(reducers.sellStock);
  const generateDemoNews = useProcedure(procedures.generateDemoNews);
  const getGlobalAiConfigStatus = useProcedure(procedures.getGlobalAiConfigStatus);

  const seedAttempted = useRef(false);

  useEffect(() => {
    if (!connected || !stocksReady || stocks.length > 0) return;
    if (seedAttempted.current) return;
    seedAttempted.current = true;
    seedMarket().catch(() => {
      seedAttempted.current = false;
    });
  }, [connected, stocksReady, stocks.length, seedMarket]);

  const [editingName, setEditingName] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [shares, setShares] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [globalAiConfigured, setGlobalAiConfigured] = useState(false);
  const [aiSettingsLoading, setAiSettingsLoading] = useState(false);
  const [aiSettingsSaving, setAiSettingsSaving] = useState(false);
  const [aiSettingsError, setAiSettingsError] = useState('');
  const [aiDraft, setAiDraft] = useState({
    provider: 'openai',
    apiKey: '',
    model: DEFAULT_OPENAI_MODEL,
    systemPrompt: '',
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      setRefreshTick(tick => tick + 1);
      setLastRefreshedAt(Date.now());
    }, 5000);
    return () => window.clearInterval(timer);
  }, [connected]);

  const account = accounts[0];

  useEffect(() => {
    if (!connected) return;
    setRefreshTick(tick => tick + 1);
    setLastRefreshedAt(Date.now());
  }, [connected, account, holdings, stocks]);
  const me = directory.find(row => identity?.isEqual(row.owner));

  const sortedStocks = useMemo(
    () => [...stocks].sort((left, right) => left.symbol.localeCompare(right.symbol)),
    [stocks, refreshTick]
  );

  const sortedLeaderboard = useMemo(
    () => sortLeaderboard(leaderboardRows),
    [leaderboardRows, refreshTick]
  );

  const sortedNews = useMemo(() => sortByTimeDesc(newsItems), [newsItems, refreshTick]);
  const sortedMyTrades = useMemo(() => sortByTimeDesc(myTrades), [myTrades, refreshTick]);

  const portfolioStats = useMemo(() => {
    const cashBalance = account?.balanceCents ?? 0n;
    const holdingsValue = computeHoldingsValue(holdings, stocks);
    const portfolioValue = cashBalance + holdingsValue;
    return {
      cashBalance,
      holdingsValue,
      portfolioValue,
      returnLabel: formatReturn(portfolioValue, STARTING_CAPITAL_CENTS),
      returnPositive: portfolioValue >= STARTING_CAPITAL_CENTS,
    };
  }, [account, holdings, stocks, refreshTick]);

  const {
    cashBalance,
    holdingsValue,
    portfolioValue,
    returnLabel,
    returnPositive,
  } = portfolioStats;

  const currentRank = useMemo(() => {
    if (!identity) return null;
    const index = sortedLeaderboard.findIndex(entry => identity.isEqual(entry.owner));
    return index >= 0 ? index + 1 : null;
  }, [identity, sortedLeaderboard, refreshTick]);

  const activeSymbol =
    selectedSymbol || (sortedStocks.length > 0 ? sortedStocks[0].symbol : '');

  const loadAiSettings = async () => {
    setAiSettingsLoading(true);
    setAiSettingsError('');
    try {
      const status = await getGlobalAiConfigStatus();
      const provider = optionalString(status.provider) ?? 'openai';
      setGlobalAiConfigured(status.configured);
      setAiDraft({
        provider,
        apiKey: '',
        model: optionalString(status.model) ?? defaultModel(provider),
        systemPrompt: optionalString(status.systemPrompt) ?? '',
      });
    } catch (caught) {
      setAiSettingsError(errorMessage(caught));
    } finally {
      setAiSettingsLoading(false);
    }
  };

  useEffect(() => {
    if (!connected) return;
    getGlobalAiConfigStatus()
      .then(status => setGlobalAiConfigured(status.configured))
      .catch(() => {});
  }, [connected, getGlobalAiConfigStatus]);

  useEffect(() => {
    if (!connected || !aiSettingsOpen) return;
    void loadAiSettings();
  }, [connected, aiSettingsOpen]);

  const saveGlobalAiConfig = async () => {
    const trimmedKey = aiDraft.apiKey.trim();
    if (!globalAiConfigured && trimmedKey.length === 0) {
      setAiSettingsError('API key is required.');
      return;
    }
    if (aiDraft.model.trim().length === 0) {
      setAiSettingsError('Model is required.');
      return;
    }

    setAiSettingsSaving(true);
    setAiSettingsError('');
    try {
      await setGlobalAiConfig({
        provider: aiDraft.provider,
        apiKey: trimmedKey.length > 0 ? trimmedKey : undefined,
        model: aiDraft.model.trim(),
        systemPrompt:
          aiDraft.systemPrompt.trim().length > 0
            ? aiDraft.systemPrompt.trim()
            : undefined,
      });
      setGlobalAiConfigured(true);
      setAiDraft(draft => ({ ...draft, apiKey: '' }));
      setAiSettingsOpen(false);
    } catch (caught) {
      setAiSettingsError(errorMessage(caught));
    } finally {
      setAiSettingsSaving(false);
    }
  };

  const saveName = async (name: string) => {
    setError('');
    try {
      await setName({ name });
      setEditingName(false);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const runTrade = async (side: 'buy' | 'sell') => {
    const shareCount = parseShares(shares);
    if (!activeSymbol) {
      setError('Choose a stock.');
      return;
    }
    if (!shareCount) {
      setError('Enter a whole number of shares greater than zero.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      if (side === 'buy') {
        await buyStock({ symbol: activeSymbol, shares: shareCount });
      } else {
        await sellStock({ symbol: activeSymbol, shares: shareCount });
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const postDemoNews = async () => {
    setError('');
    setSubmitting(true);
    try {
      await generateDemoNews({ symbol: activeSymbol || undefined });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected || !identity || !account) {
    return (
      <main className="empty-state" style={{ minHeight: '100vh' }}>
        <h1>Market Sim</h1>
        <p>Connecting and opening your account...</p>
      </main>
    );
  }

  if (!me) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '1.5rem',
        }}
      >
        <section
          style={{
            width: 'min(100%, 480px)',
            display: 'grid',
            gap: '1rem',
            padding: '2rem',
            border: '1px solid #d8dee9',
            borderRadius: '1rem',
            background: '#fff',
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            SpacetimeDB Market Sim
          </p>
          <h1 style={{ margin: 0 }}>Welcome</h1>
          <p style={{ margin: 0 }}>
            You start with <strong>{formatMoney(STARTING_CAPITAL_CENTS)}</strong> in play
            money. Pick a nickname to join the market.
          </p>
          {error && <p style={{ color: LOSS_COLOR, margin: 0 }}>{error}</p>}
          <NameForm onSubmit={saveName} />
        </section>
      </main>
    );
  }

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '1.5rem',
        display: 'grid',
        gap: '1rem',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p className="muted" style={{ margin: 0 }}>
            SpacetimeDB Market Sim
          </p>
          <h1 style={{ margin: '0.25rem 0 0' }}>Trading Floor</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className={`status ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <button onClick={() => setAiSettingsOpen(true)} type="button">
            AI Settings {globalAiConfigured ? '✓' : ''}
          </button>
          {editingName ? (
            <NameForm initialName={me.name} onSubmit={saveName} />
          ) : (
            <>
              <strong>{me.name}</strong>
              <button onClick={() => setEditingName(true)} type="button">
                Rename
              </button>
            </>
          )}
        </div>
      </header>

      <AiSettingsModal
        apiKey={aiDraft.apiKey}
        configured={globalAiConfigured}
        error={aiSettingsError}
        loading={aiSettingsLoading}
        model={aiDraft.model}
        onApiKeyChange={value => setAiDraft(draft => ({ ...draft, apiKey: value }))}
        onClose={() => setAiSettingsOpen(false)}
        onModelChange={value => setAiDraft(draft => ({ ...draft, model: value }))}
        onProviderChange={value =>
          setAiDraft(draft => ({
            ...draft,
            provider: value,
            model: defaultModel(value),
          }))
        }
        onSave={() => void saveGlobalAiConfig()}
        onSystemPromptChange={value =>
          setAiDraft(draft => ({ ...draft, systemPrompt: value }))
        }
        open={aiSettingsOpen}
        provider={aiDraft.provider}
        saving={aiSettingsSaving}
        systemPrompt={aiDraft.systemPrompt}
      />

      {error && (
        <p
          style={{
            margin: 0,
            color: LOSS_COLOR,
            background: '#fef2f2',
            padding: '0.75rem',
            borderRadius: '0.5rem',
          }}
        >
          {error}
        </p>
      )}

      <section
        style={{
          padding: '1.5rem',
          borderRadius: '0.85rem',
          background: 'linear-gradient(135deg, #111827 0%, #1e3a5f 100%)',
          color: '#f9fafb',
          display: 'grid',
          gap: '1.25rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <p className="muted" style={{ margin: 0, color: '#9ca3af' }}>
              Player performance
            </p>
            <h2 style={{ margin: '0.25rem 0 0', fontSize: '1.5rem' }}>{me.name}</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#9ca3af' }}>
              Metrics refresh every 5s · Last updated{' '}
              {new Date(lastRefreshedAt).toLocaleTimeString()}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="muted" style={{ margin: 0, color: '#9ca3af' }}>
              Current rank
            </p>
            <strong style={{ fontSize: '2rem' }}>
              {currentRank ? `#${currentRank}` : 'Unranked'}
            </strong>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '1rem',
          }}
        >
          <MetricTile label="Portfolio value" value={formatMoney(portfolioValue)} />
          <MetricTile
            accent={returnPositive ? '#86efac' : '#fca5a5'}
            label="Total return"
            value={returnLabel}
          />
          <MetricTile label="Cash balance" value={formatMoney(cashBalance)} />
          <MetricTile label="Holdings value" value={formatMoney(holdingsValue)} />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '1rem',
            paddingTop: '0.5rem',
            borderTop: '1px solid rgb(255 255 255 / 15%)',
          }}
        >
          <MetricTile
            label="Starting capital"
            value={formatMoney(STARTING_CAPITAL_CENTS)}
          />
          <MetricTile label="Open positions" value={holdings.length.toString()} />
          <MetricTile
            label="Leaderboard size"
            value={sortedLeaderboard.length.toString()}
          />
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
        }}
      >
        <article
          style={{
            padding: '1.25rem',
            border: '1px solid #d8dee9',
            borderRadius: '0.75rem',
            background: '#fff',
            gridColumn: '1 / -1',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Portfolio summary</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1rem',
            }}
          >
            <MetricTile label="Cash balance" value={formatMoney(cashBalance)} />
            <MetricTile label="Holdings value" value={formatMoney(holdingsValue)} />
            <MetricTile label="Total portfolio value" value={formatMoney(portfolioValue)} />
            <MetricTile
              label="Starting capital"
              value={formatMoney(STARTING_CAPITAL_CENTS)}
            />
            <MetricTile
              accent={returnPositive ? GAIN_COLOR : LOSS_COLOR}
              label="Total return"
              value={returnLabel}
            />
            <MetricTile
              label="Current rank"
              value={currentRank ? `#${currentRank}` : 'Unranked'}
            />
          </div>
          {holdings.length > 0 && (
            <ul style={{ margin: '1rem 0 0', paddingLeft: '1.1rem' }}>
              {[...holdings]
                .sort((left, right) => left.symbol.localeCompare(right.symbol))
                .map(holding => {
                  const stock = stocks.find(row => row.symbol === holding.symbol);
                  const value = stock ? holding.shares * stock.priceCents : 0n;
                  return (
                    <li key={holding.id.toString()}>
                      <strong>{holding.symbol}</strong> — {holding.shares.toString()} shares
                      {stock ? ` · ${formatMoney(value)}` : ''}
                    </li>
                  );
                })}
            </ul>
          )}
        </article>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '1rem',
        }}
      >
        <article
          style={{
            padding: '1.25rem',
            border: '1px solid #d8dee9',
            borderRadius: '0.75rem',
            background: '#fff',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Stocks</h2>
          {sortedStocks.length === 0 ? (
            <p className="muted">No stocks listed yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">Symbol</th>
                  <th align="right">Price</th>
                  <th align="right">Change</th>
                  <th align="right">Volume</th>
                </tr>
              </thead>
              <tbody>
                {sortedStocks.map(stock => {
                  const up = stock.priceCents >= stock.previousPriceCents;
                  const change = formatPriceChangePercent(
                    stock.priceCents,
                    stock.previousPriceCents
                  );
                  return (
                    <tr key={stock.symbol}>
                      <td>
                        <strong>{stock.symbol}</strong>
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {stock.name}
                        </div>
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          Prev {formatMoney(stock.previousPriceCents)}
                        </div>
                      </td>
                      <td align="right" style={{ color: up ? GAIN_COLOR : LOSS_COLOR }}>
                        {formatMoney(stock.priceCents)}
                      </td>
                      <td align="right" style={{ color: up ? GAIN_COLOR : LOSS_COLOR }}>
                        {up ? '▲' : '▼'} {change}
                      </td>
                      <td align="right">{stock.volume.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </article>

        <article
          style={{
            padding: '1.25rem',
            border: '1px solid #d8dee9',
            borderRadius: '0.75rem',
            background: '#fff',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Trade</h2>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <label>
              Stock
              <select
                onChange={event => setSelectedSymbol(event.target.value)}
                value={activeSymbol}
              >
                {sortedStocks.length === 0 ? (
                  <option value="">No stocks available</option>
                ) : (
                  sortedStocks.map(stock => {
                    const up = stock.priceCents >= stock.previousPriceCents;
                    return (
                      <option key={stock.symbol} value={stock.symbol}>
                        {up ? '▲' : '▼'} {stock.symbol} — {formatMoney(stock.priceCents)}
                      </option>
                    );
                  })
                )}
              </select>
            </label>
            <label>
              Shares
              <input
                inputMode="numeric"
                onChange={event => setShares(event.target.value)}
                value={shares}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button disabled={submitting} onClick={() => runTrade('buy')} type="button">
                Buy
              </button>
              <button
                disabled={submitting}
                onClick={() => runTrade('sell')}
                style={{ background: LOSS_COLOR }}
                type="button"
              >
                Sell
              </button>
            </div>
          </div>
        </article>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '1rem',
        }}
      >
        <article
          style={{
            padding: '1.25rem',
            border: '1px solid #d8dee9',
            borderRadius: '0.75rem',
            background: '#fff',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Leaderboard</h2>
          {sortedLeaderboard.length === 0 ? (
            <p className="muted">No ranked players yet.</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {sortedLeaderboard.map((entry, index) => {
                const rank = index + 1;
                const isMe = identity?.isEqual(entry.owner);
                return (
                  <li key={entry.owner.toHexString()} style={{ marginBottom: '0.6rem' }}>
                    <strong>
                      #{rank} {entry.name}
                    </strong>
                    {isMe ? ' (you)' : ''} —{' '}
                    {formatMoney(entry.estimatedPortfolioValueCents)}
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      Cash {formatMoney(entry.balanceCents)}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </article>

        <article
          style={{
            padding: '1.25rem',
            border: '1px solid #d8dee9',
            borderRadius: '0.75rem',
            background: '#fff',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <h2 style={{ margin: 0 }}>Market activity</h2>
            <button disabled={submitting} onClick={postDemoNews} type="button">
              {globalAiConfigured ? 'Generate news' : 'Demo headline'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
            Public feed of news, institutional flow, and anonymized market pressure. Human
            trades are never shown here.
          </p>
          {sortedNews.length === 0 ? (
            <p className="muted">No market activity yet.</p>
          ) : (
            <ul style={{ margin: '1rem 0 0', paddingLeft: 0, listStyle: 'none' }}>
              {sortedNews.map(item => {
                const symbol = optionalString(item.symbol);
                const institution = findInstitution(`${item.headline} ${item.body}`);
                const direction = item.isAiGenerated
                  ? inferAiDirection(item.headline, item.body)
                  : undefined;

                return (
                  <li
                    key={item.id.toString()}
                    style={{
                      marginBottom: '0.85rem',
                      padding: '0.85rem',
                      borderRadius: '0.6rem',
                      background: item.isAiGenerated ? '#f0f9ff' : '#f9fafb',
                      border: `1px solid ${item.isAiGenerated ? '#bae6fd' : '#e5e7eb'}`,
                    }}
                  >
                    {item.isAiGenerated ? (
                      <>
                        <div
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: '#0369a1',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                          }}
                        >
                          AI Market Mover
                        </div>
                        <strong style={{ display: 'block', marginTop: '0.25rem' }}>
                          {item.headline.replace(/^AI Market Mover:\s*/i, '')}
                        </strong>
                        {institution && (
                          <div style={{ marginTop: '0.35rem', fontSize: '0.9rem' }}>
                            <strong>{institution}</strong>
                            {symbol ? ` · ${symbol}` : ''}
                            {direction ? ` · ${direction}` : ''}
                          </div>
                        )}
                      </>
                    ) : (
                      <strong>{item.headline}</strong>
                    )}
                    <p style={{ margin: '0.4rem 0' }}>{item.body}</p>
                    <time className="muted" style={{ fontSize: '0.8rem' }}>
                      {item.createdAt.toDate().toLocaleString()}
                      {symbol ? ` · ${symbol}` : ''}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article
          style={{
            padding: '1.25rem',
            border: '1px solid #d8dee9',
            borderRadius: '0.75rem',
            background: '#fff',
          }}
        >
          <h2 style={{ marginTop: 0 }}>My trades</h2>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            Private history — only you can see these executions.
          </p>
          {sortedMyTrades.length === 0 ? (
            <p className="muted">No trades yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {sortedMyTrades.map(trade => {
                const isBuy = trade.side === 'buy';
                return (
                  <li key={trade.id.toString()} style={{ marginBottom: '0.65rem' }}>
                    <strong style={{ color: isBuy ? GAIN_COLOR : LOSS_COLOR }}>
                      {isBuy ? 'Buy' : 'Sell'}
                    </strong>{' '}
                    {trade.shares.toString()} {trade.symbol} @{' '}
                    {formatMoney(trade.priceCents)}
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      Total {formatMoney(trade.totalCents)} ·{' '}
                      {trade.createdAt.toDate().toLocaleString()}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </section>
    </main>
  );
}

export default App;
