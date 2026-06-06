import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Identity } from 'spacetimedb';
import { useProcedure, useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import './App.css';
import { procedures, reducers, tables } from './module_bindings';

const STARTING_CAPITAL_CENTS = 1_000_000n;
const SHOW_AI_SETTINGS = true;
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

const AI_TRADER_NAMES = ['Nova AI', 'Pulse AI'] as const;

const AI_TRADER_PERSONALITIES: Record<(typeof AI_TRADER_NAMES)[number], string> = {
  'Nova AI': 'Aggressive — chases momentum, trades bigger',
  'Pulse AI': 'Conservative — buys dips, takes profits early',
};
const BOT_TRADE_LOG_LIMIT = 50;

type LeaderboardEntry = {
  owner: Identity;
  name: string;
  balanceCents: bigint;
  estimatedPortfolioValueCents: bigint;
};

function clampNonNegativeCents(cents: bigint): bigint {
  return cents < 0n ? 0n : cents;
}

function formatMoney(cents: bigint) {
  const safeCents = clampNonNegativeCents(cents);
  const dollars = safeCents / 100n;
  const remainder = (safeCents % 100n).toString().padStart(2, '0');
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
  const pct = Number(((current - previous) * 10000n) / previous) / 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
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

function sortByTimeAsc<T extends { createdAt: { microsSinceUnixEpoch: bigint } }>(
  rows: readonly T[]
) {
  return [...rows].sort((left, right) =>
    Number(left.createdAt.microsSinceUnixEpoch - right.createdAt.microsSinceUnixEpoch)
  );
}

function formatBotTradeLine(trade: {
  traderName: string;
  traderStyle?: string;
  side: string;
  shares: bigint;
  symbol: string;
  priceCents: bigint;
  totalCents: bigint;
  createdAt: { toDate: () => Date };
}) {
  const time = trade.createdAt.toDate().toLocaleTimeString();
  const side = trade.side === 'buy' ? 'BUY ' : 'SELL';
  const trader = trade.traderName.padEnd(9, ' ');
  const shares = trade.shares.toLocaleString().padStart(6, ' ');
  const style = trade.traderStyle ? `  // ${trade.traderStyle}` : '';
  return `${time}  ${trader}  ${side}  ${shares} ${trade.symbol} @ ${formatMoney(trade.priceCents)}  (${formatMoney(trade.totalCents)})${style}`;
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

const HOUR_MICROS = 3_600_000_000n;
const PORTFOLIO_CHART_HOURS = 24;

type PortfolioSnapshot = {
  hourStartMicros: bigint;
  portfolioValueCents: bigint;
};

type PortfolioChartPoint = PortfolioSnapshot & {
  label: string;
};

function hourStartMicrosFromMs(ms: number): bigint {
  const micros = BigInt(ms) * 1000n;
  return (micros / HOUR_MICROS) * HOUR_MICROS;
}

function buildPortfolioChartSeries(
  snapshots: readonly PortfolioSnapshot[],
  livePortfolioCents: bigint,
  nowMs: number
): PortfolioChartPoint[] {
  const currentHourStart = hourStartMicrosFromMs(nowMs);
  const snapshotByHour = new Map<string, bigint>();

  for (const row of snapshots) {
    snapshotByHour.set(row.hourStartMicros.toString(), row.portfolioValueCents);
  }
  snapshotByHour.set(currentHourStart.toString(), livePortfolioCents);

  let lastValue = STARTING_CAPITAL_CENTS;
  const points: PortfolioChartPoint[] = [];

  for (let offset = PORTFOLIO_CHART_HOURS - 1; offset >= 0; offset -= 1) {
    const hourStart = currentHourStart - BigInt(offset) * HOUR_MICROS;
    const key = hourStart.toString();
    if (snapshotByHour.has(key)) {
      lastValue = snapshotByHour.get(key)!;
    }

    points.push({
      hourStartMicros: hourStart,
      portfolioValueCents: lastValue,
      label: new Date(Number(hourStart / 1000n)).toLocaleTimeString([], {
        hour: 'numeric',
      }),
    });
  }

  return points;
}

function niceChartStep(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;

  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;

  return niceFraction * 10 ** exponent;
}

function buildChartYAxis(values: number[], targetTicks = 5) {
  const safeValues = values.map(value => Math.max(0, value));
  let minValue = Math.min(...safeValues);
  let maxValue = Math.max(...safeValues);

  if (minValue === maxValue) {
    const pad = Math.max(minValue * 0.01, 1_000);
    minValue = Math.max(0, minValue - pad);
    maxValue += pad;
  } else {
    const pad = (maxValue - minValue) * 0.1;
    minValue = Math.max(0, minValue - pad);
    maxValue += pad;
  }

  const range = niceChartStep(Math.max(maxValue - minValue, 1), false);
  const tickSpacing = niceChartStep(range / Math.max(targetTicks - 1, 1), true);
  const axisMin = Math.max(0, Math.floor(minValue / tickSpacing) * tickSpacing);
  const axisMax = Math.max(axisMin + tickSpacing, Math.ceil(maxValue / tickSpacing) * tickSpacing);
  const ticks: number[] = [];

  for (let tick = axisMin; tick <= axisMax + tickSpacing * 0.001; tick += tickSpacing) {
    ticks.push(Math.max(0, tick));
  }

  return { axisMin, axisMax, ticks, tickSpacing };
}

function formatChartAxisLabel(cents: number, tickSpacingCents: number): string {
  const dollars = Math.max(0, cents) / 100;
  if (tickSpacingCents < 100) {
    return `$${dollars.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (tickSpacingCents < 100_000) {
    return `$${Math.round(dollars).toLocaleString()}`;
  }
  return `$${(dollars / 1_000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })}k`;
}

function PortfolioHistoryChart({ points }: { points: PortfolioChartPoint[] }) {
  const width = 640;
  const height = 200;
  const padRight = 12;
  const padTop = 18;
  const padBottom = 28;
  const innerH = height - padTop - padBottom;

  const values = points.map(point =>
    Math.max(0, Number(clampNonNegativeCents(point.portfolioValueCents)))
  );
  const { axisMin, axisMax, ticks, tickSpacing } = buildChartYAxis(values);
  const axisSpan = Math.max(axisMax - axisMin, 1);
  const yLabels = ticks.map(tick => ({
    value: tick,
    label: formatChartAxisLabel(tick, tickSpacing),
  }));
  const padLeft = Math.max(54, Math.max(...yLabels.map(label => label.label.length)) * 7 + 12);
  const innerW = width - padLeft - padRight;

  const scaleY = (value: number) =>
    padTop + innerH - ((value - axisMin) / axisSpan) * innerH;
  const scaleX = (index: number) =>
    padLeft + (index / Math.max(points.length - 1, 1)) * innerW;

  const linePoints = points
    .map(
      (point, index) =>
        `${scaleX(index)},${scaleY(Number(point.portfolioValueCents))}`
    )
    .join(' ');

  const areaPoints = [
    `${scaleX(0)},${padTop + innerH}`,
    ...points.map(
      (point, index) =>
        `${scaleX(index)},${scaleY(Number(point.portfolioValueCents))}`
    ),
    `${scaleX(points.length - 1)},${padTop + innerH}`,
  ].join(' ');

  const first = points[0]?.portfolioValueCents ?? STARTING_CAPITAL_CENTS;
  const last = points[points.length - 1]?.portfolioValueCents ?? STARTING_CAPITAL_CENTS;
  const changePositive = last >= first;
  const lineColor = changePositive ? '#86efac' : '#fca5a5';

  const xLabelStride = Math.max(1, Math.floor(points.length / 6));

  return (
    <div className="portfolio-chart">
      <div className="portfolio-chart__header">
        <p className="portfolio-chart__title">24-hour portfolio value</p>
        <p className="portfolio-chart__subtitle">
          {formatReturn(last, first)} vs 24h ago ({formatMoney(first)} → {formatMoney(last)})
        </p>
      </div>
      <svg
        aria-label="Portfolio value over the last 24 hours"
        className="portfolio-chart__svg"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {yLabels.map(label => (
          <g key={label.value}>
            <line
              className="portfolio-chart__grid"
              x1={padLeft}
              x2={width - padRight}
              y1={scaleY(label.value)}
              y2={scaleY(label.value)}
            />
            <text
              className="portfolio-chart__ylabel"
              textAnchor="end"
              x={padLeft - 6}
              y={scaleY(label.value) + 4}
            >
              {label.label}
            </text>
          </g>
        ))}
        <polygon
          fill={changePositive ? 'rgb(134 239 172 / 18%)' : 'rgb(252 165 165 / 18%)'}
          points={areaPoints}
        />
        <polyline
          fill="none"
          points={linePoints}
          stroke={lineColor}
          strokeWidth="2.5"
        />
        {points.map((point, index) =>
          index % xLabelStride === 0 || index === points.length - 1 ? (
            <text
              className="portfolio-chart__xlabel"
              key={point.hourStartMicros.toString()}
              textAnchor="middle"
              x={scaleX(index)}
              y={height - 6}
            >
              {point.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
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

type AiConnectionState = 'unknown' | 'checking' | 'connected' | 'failed' | 'not_configured';

function AiSettingsModal({
  apiKey,
  configured,
  connectionMessage,
  connectionState,
  error,
  loading,
  model,
  onApiKeyChange,
  onClose,
  onModelChange,
  onProviderChange,
  onSave,
  onSystemPromptChange,
  onTestConnection,
  open,
  provider,
  saving,
  systemPrompt,
  testingConnection,
}: {
  apiKey: string;
  configured: boolean;
  connectionMessage: string;
  connectionState: AiConnectionState;
  error: string;
  loading: boolean;
  model: string;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onModelChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onSave: () => void;
  onSystemPromptChange: (value: string) => void;
  onTestConnection: () => void;
  open: boolean;
  provider: string;
  saving: boolean;
  systemPrompt: string;
  testingConnection: boolean;
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
        <div
          style={{
            padding: '0.75rem 0.85rem',
            borderRadius: '0.55rem',
            fontSize: '0.88rem',
            background:
              connectionState === 'connected'
                ? '#ecfdf5'
                : connectionState === 'failed'
                  ? '#fef2f2'
                  : '#f8fafc',
            border: `1px solid ${
              connectionState === 'connected'
                ? '#86efac'
                : connectionState === 'failed'
                  ? '#fca5a5'
                  : '#e2e8f0'
            }`,
            color:
              connectionState === 'connected'
                ? GAIN_COLOR
                : connectionState === 'failed'
                  ? LOSS_COLOR
                  : '#475569',
          }}
        >
          {connectionState === 'checking' || testingConnection
            ? 'Testing OpenAI connection...'
            : connectionState === 'connected'
              ? connectionMessage || 'OpenAI connection successful.'
              : connectionState === 'failed'
                ? connectionMessage || 'Cannot connect to OpenAI.'
                : connectionState === 'not_configured'
                  ? 'No API key saved yet.'
                  : 'Connection status unknown.'}
        </div>
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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              disabled={loading || saving || testingConnection || !configured}
              onClick={onTestConnection}
              style={{ background: '#475569' }}
              type="button"
            >
              {testingConnection ? 'Testing...' : 'Test connection'}
            </button>
            <button disabled={loading || saving || testingConnection} onClick={onSave} type="button">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
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
  const [stocks, stocksReady] = useTable(tables.market_stocks);
  const [leaderboardRows] = useTable(tables.leaderboard);
  const [newsItems] = useTable(tables.recent_market_news);
  const [players] = useTable(tables.my_player);
  const [portfolioHistory] = useTable(tables.my_portfolio_history);
  const [aiTraderLog] = useTable(tables.ai_trader_log);
  const [aiTraderMinds] = useTable(tables.ai_trader_minds);
  const [aiNewsStatusRows] = useTable(tables.ai_news_status);

  const setName = useReducer(reducers.setName);
  const setGlobalAiConfig = useReducer(reducers.setGlobalAiConfig);
  const seedMarket = useReducer(reducers.seedMarket);
  const buyStock = useReducer(reducers.buyStock);
  const sellStock = useReducer(reducers.sellStock);
  const generateDemoNews = useProcedure(procedures.generateDemoNews);
  const getGlobalAiConfigStatus = useProcedure(procedures.getGlobalAiConfigStatus);
  const testGlobalAiConnection = useProcedure(procedures.testGlobalAiConnection);

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
  const [tradeError, setTradeError] = useState('');
  const [newsError, setNewsError] = useState('');
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [globalAiConfigured, setGlobalAiConfigured] = useState(false);
  const [aiConnectionState, setAiConnectionState] =
    useState<AiConnectionState>('unknown');
  const [aiConnectionMessage, setAiConnectionMessage] = useState('');
  const [aiSettingsLoading, setAiSettingsLoading] = useState(false);
  const [aiSettingsSaving, setAiSettingsSaving] = useState(false);
  const [aiSettingsTesting, setAiSettingsTesting] = useState(false);
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
  const me = players[0];

  const sortedStocks = useMemo(
    () => [...stocks].sort((left, right) => left.symbol.localeCompare(right.symbol)),
    [stocks, refreshTick]
  );

  const sortedLeaderboard = useMemo(
    () => sortLeaderboard(leaderboardRows),
    [leaderboardRows, refreshTick]
  );
  const topLeaderboard = useMemo(
    () => sortedLeaderboard.slice(0, 10),
    [sortedLeaderboard, refreshTick]
  );

  const sortedNews = useMemo(
    () => sortByTimeDesc(newsItems).slice(0, 5),
    [newsItems, refreshTick]
  );
  const sortedMyTrades = useMemo(
    () => sortByTimeDesc(myTrades).slice(0, 10),
    [myTrades, refreshTick]
  );
  const botTradeLog = useMemo(
    () => sortByTimeAsc(aiTraderLog).slice(-BOT_TRADE_LOG_LIMIT),
    [aiTraderLog, refreshTick]
  );
  const botStandings = useMemo(
    () =>
      sortedLeaderboard.filter(entry => AI_TRADER_NAMES.includes(entry.name as (typeof AI_TRADER_NAMES)[number])),
    [sortedLeaderboard, refreshTick]
  );
  const sortedBotMinds = useMemo(
    () =>
      [...aiTraderMinds].sort((left, right) =>
        left.traderName === 'Nova AI' ? -1 : right.traderName === 'Nova AI' ? 1 : 0
      ),
    [aiTraderMinds, refreshTick]
  );

  const botConsoleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const consoleEl = botConsoleRef.current;
    if (!consoleEl) return;
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }, [botTradeLog]);

  const portfolioStats = useMemo(() => {
    const cashBalance = clampNonNegativeCents(account?.balanceCents ?? 0n);
    const holdingsValue = clampNonNegativeCents(computeHoldingsValue(holdings, stocks));
    const portfolioValue = clampNonNegativeCents(cashBalance + holdingsValue);
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

  const portfolioChartPoints = useMemo(
    () => buildPortfolioChartSeries(portfolioHistory, portfolioValue, lastRefreshedAt),
    [portfolioHistory, portfolioValue, lastRefreshedAt, refreshTick]
  );

  const currentRank = useMemo(() => {
    if (!identity) return null;
    const index = sortedLeaderboard.findIndex(entry => identity.isEqual(entry.owner));
    return index >= 0 ? index + 1 : null;
  }, [identity, sortedLeaderboard, refreshTick]);

  const activeSymbol =
    selectedSymbol || (sortedStocks.length > 0 ? sortedStocks[0].symbol : '');

  const applyConnectionResult = (result: {
    ok: boolean;
    message: string;
  }) => {
    if (result.ok) {
      setAiConnectionState('connected');
      setAiConnectionMessage(result.message);
      return;
    }
    setAiConnectionState('failed');
    setAiConnectionMessage(result.message);
  };

  const runAiConnectionTest = useCallback(async () => {
    setAiSettingsTesting(true);
    setAiConnectionState('checking');
    setAiConnectionMessage('');
    try {
      const result = await testGlobalAiConnection();
      applyConnectionResult(result);
      return result;
    } catch (caught) {
      const message = errorMessage(caught);
      setAiConnectionState('failed');
      setAiConnectionMessage(message);
      return { ok: false, message };
    } finally {
      setAiSettingsTesting(false);
    }
  }, [testGlobalAiConnection]);

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
      if (status.configured) {
        await runAiConnectionTest();
      } else {
        setAiConnectionState('not_configured');
        setAiConnectionMessage('No API key saved yet.');
      }
    } catch (caught) {
      setAiSettingsError(errorMessage(caught));
    } finally {
      setAiSettingsLoading(false);
    }
  };

  useEffect(() => {
    if (!connected) return;
    getGlobalAiConfigStatus()
      .then(async status => {
        setGlobalAiConfigured(status.configured);
        if (status.configured) {
          await runAiConnectionTest();
        } else {
          setAiConnectionState('not_configured');
          setAiConnectionMessage('No API key saved yet.');
        }
      })
      .catch(() => {});
  }, [connected, getGlobalAiConfigStatus, runAiConnectionTest]);

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
      const connection = await runAiConnectionTest();
      if (!connection.ok) {
        setAiSettingsError(connection.message);
        return;
      }
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
      setTradeError('Choose a stock.');
      return;
    }
    if (!shareCount) {
      setTradeError('Enter a whole number of shares greater than zero.');
      return;
    }

    setTradeError('');
    setSubmitting(true);
    try {
      if (side === 'buy') {
        await buyStock({ symbol: activeSymbol, shares: shareCount });
      } else {
        await sellStock({ symbol: activeSymbol, shares: shareCount });
      }
    } catch (caught) {
      setTradeError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const postDemoNews = async () => {
    setNewsError('');
    setSubmitting(true);
    try {
      if (globalAiConfigured) {
        const connection = await runAiConnectionTest();
        if (!connection.ok) {
          setNewsError(`OpenAI cannot connect: ${connection.message}`);
        }
      }
      await generateDemoNews({ symbol: activeSymbol || undefined });
    } catch (caught) {
      setNewsError(errorMessage(caught));
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
          {SHOW_AI_SETTINGS && (
            <button onClick={() => setAiSettingsOpen(true)} type="button">
              AI Settings {globalAiConfigured ? '✓' : ''}
            </button>
          )}
          {SHOW_AI_SETTINGS && globalAiConfigured && (
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 650,
                color:
                  aiConnectionState === 'connected'
                    ? GAIN_COLOR
                    : aiConnectionState === 'failed'
                      ? LOSS_COLOR
                      : '#64748b',
              }}
            >
              {aiConnectionState === 'checking' || aiSettingsTesting
                ? 'OpenAI: checking...'
                : aiConnectionState === 'connected'
                  ? 'OpenAI: connected'
                  : aiConnectionState === 'failed'
                    ? 'OpenAI: cannot connect'
                    : ''}
            </span>
          )}
          {editingName ? (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {error && (
                <p style={{ color: LOSS_COLOR, margin: 0, fontSize: '0.9rem' }}>{error}</p>
              )}
              <NameForm initialName={me.name} onSubmit={saveName} />
            </div>
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

      {SHOW_AI_SETTINGS && (
        <AiSettingsModal
          apiKey={aiDraft.apiKey}
          configured={globalAiConfigured}
          connectionMessage={aiConnectionMessage}
          connectionState={aiConnectionState}
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
          onTestConnection={() => void runAiConnectionTest()}
          open={aiSettingsOpen}
          provider={aiDraft.provider}
          saving={aiSettingsSaving}
          systemPrompt={aiDraft.systemPrompt}
          testingConnection={aiSettingsTesting}
        />
      )}

      {SHOW_AI_SETTINGS && globalAiConfigured && aiConnectionState === 'failed' && (
        <p
          style={{
            margin: 0,
            padding: '0.75rem 1rem',
            borderRadius: '0.55rem',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            color: LOSS_COLOR,
            fontSize: '0.9rem',
          }}
        >
          OpenAI connection failed: {aiConnectionMessage}
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
          <MetricTile label="Open positions" value={holdings.length.toString()} />
          <MetricTile
            label="Leaderboard size"
            value={sortedLeaderboard.length.toString()}
          />
        </div>

        <PortfolioHistoryChart points={portfolioChartPoints} />
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
                  const up = stock.priceCents >= stock.dayOpenPriceCents;
                  const change = formatPriceChangePercent(
                    stock.priceCents,
                    stock.dayOpenPriceCents
                  );
                  return (
                    <tr key={stock.symbol}>
                      <td>
                        <strong>{stock.symbol}</strong>
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {stock.name}
                        </div>
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          Day open {formatMoney(stock.dayOpenPriceCents)}
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
                    const up = stock.priceCents >= stock.dayOpenPriceCents;
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
            {tradeError && (
              <p style={{ color: LOSS_COLOR, margin: 0, fontSize: '0.9rem' }}>{tradeError}</p>
            )}
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
          {topLeaderboard.length === 0 ? (
            <p className="muted">No ranked players yet.</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {topLeaderboard.map((entry, index) => {
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
            {globalAiConfigured && (
              <button
                disabled={submitting || aiConnectionState === 'failed'}
                onClick={postDemoNews}
                type="button"
              >
                Breaking headline
              </button>
            )}
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
            Live AI news reacts to retail trades, Nova AI, Pulse AI, and price moves — published
            on its own schedule, not a fixed timer. Human trades are never named here.
          </p>
          {newsError && (
            <p style={{ color: LOSS_COLOR, margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
              {newsError}
            </p>
          )}
          {!globalAiConfigured && (
            <p style={{ color: LOSS_COLOR, margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
              Auto news is off — add an OpenAI API key in AI Settings.
            </p>
          )}
          {globalAiConfigured && aiNewsStatusRows[0]?.paused && (
            <p style={{ color: LOSS_COLOR, margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
              Auto news paused — OpenAI connection lost.
              {aiNewsStatusRows[0].lastError ? ` ${aiNewsStatusRows[0].lastError}` : ''}
            </p>
          )}
          {globalAiConfigured &&
            aiConnectionState === 'connected' &&
            aiNewsStatusRows[0]?.active && (
              <p style={{ color: GAIN_COLOR, margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                Auto news active — headlines publish when the AI desk sees meaningful activity.
              </p>
            )}
          {globalAiConfigured && aiConnectionState === 'failed' && (
            <p style={{ color: LOSS_COLOR, margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
              OpenAI cannot connect. {aiConnectionMessage}
            </p>
          )}
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

      <section style={{ marginTop: '1rem' }}>
        <article className="bot-console">
          <div className="bot-console__header">
            <div>
              <h2 className="bot-console__title">AI trader log</h2>
              <p className="bot-console__subtitle">
                {globalAiConfigured && aiConnectionState === 'connected'
                  ? 'Nova and Pulse trade independently via OpenAI — each bot decides when to check the market again and whether to buy, sell, or hold.'
                  : 'Nova AI chases momentum with bigger bets. Pulse AI buys dips and locks in gains conservatively (rule-based until OpenAI connects).'}
              </p>
            </div>
            {botStandings.length > 0 && (
              <div className="bot-console__standings">
                {botStandings.map((entry, index) => {
                  const isNova = entry.name === 'Nova AI';
                  const personality =
                    entry.name in AI_TRADER_PERSONALITIES
                      ? AI_TRADER_PERSONALITIES[entry.name as (typeof AI_TRADER_NAMES)[number]]
                      : '';
                  return (
                    <span
                      className={`bot-console__badge ${isNova ? 'bot-console__badge--nova' : 'bot-console__badge--pulse'}`}
                      key={entry.owner.toHexString()}
                      title={personality}
                    >
                      #{index + 1} {entry.name} · {formatMoney(entry.estimatedPortfolioValueCents)}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          {sortedBotMinds.length > 0 && (
            <div className="bot-console__minds">
              {sortedBotMinds.map(mind => {
                const isNova = mind.traderName === 'Nova AI';
                return (
                  <div
                    className={`bot-console__mind ${isNova ? 'bot-console__mind--nova' : 'bot-console__mind--pulse'}`}
                    key={mind.traderName}
                  >
                    <strong>
                      {mind.traderName} · #{mind.rank.toString()} ·{' '}
                      {mind.lastDecisionSource === 'llm' ? 'LLM' : 'rules'}
                    </strong>
                    <div className="bot-console__mind-style">{mind.traderStyle}</div>
                    <div className="bot-console__mind-thought">
                      {mind.lastActionSummary !== 'none'
                        ? `Last: ${mind.lastActionSummary} — ${mind.lastReasoning}`
                        : mind.lastReasoning}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="bot-console__log" ref={botConsoleRef}>
            {botTradeLog.length === 0 ? (
              <p className="bot-console__empty">
                {'> waiting for Nova AI and Pulse AI to start trading...'}
              </p>
            ) : (
              botTradeLog.map(trade => {
                const isBuy = trade.side === 'buy';
                return (
                  <span
                    className={`bot-console__line ${isBuy ? 'bot-console__line--buy' : 'bot-console__line--sell'}`}
                    key={trade.id.toString()}
                  >
                    {formatBotTradeLine(trade)}
                    {'\n'}
                  </span>
                );
              })
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

export default App;
