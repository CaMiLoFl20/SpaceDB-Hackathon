import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProcedure, useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import './App.css';
import {
  AiSettingsModal,
  defaultModel,
  type AiConnectionState,
} from './components/AiSettingsModal';
import {
  FundConstituentsPanel,
  type FundConstituentItem,
} from './components/FundConstituentsPanel';
import { FundMarketTable, type FundMarketItem } from './components/FundMarketTable';
import { LeaderboardPanel, sortLeaderboard } from './components/LeaderboardPanel';
import { InstitutionalFlow } from './components/InstitutionalFlow';
import { ManagerActivity } from './components/ManagerActivity';
import { MarketClockBanner } from './components/MarketClockBanner';
import {
  MarketPulseStrip,
  type KeyArticleItem,
  type StockMarketItem,
} from './components/MarketPulseStrip';
import { MetricTile } from './components/MetricTile';
import { NameForm } from './components/NameForm';
import { NewsFeed } from './components/NewsFeed';
import { PortfolioHistoryChart } from './components/PortfolioHistoryChart';
import { PortfolioSummary } from './components/PortfolioSummary';
import { PredictionCard } from './components/PredictionCard';
import { PredictionResultPopup } from './components/PredictionResultPopup';
import { ToastStack, type ToastItem } from './components/ToastStack';
import { TradeTicket } from './components/TradeTicket';
import { buildPortfolioChartSeries, gameTimelineMinuteFromClock, type PortfolioChartRange } from './utils/chart';
import { playGameCue, type GameCue } from './utils/audio';
import {
  GAIN_COLOR,
  LOSS_COLOR,
  STARTING_CAPITAL_CENTS,
  clampNonNegativeCents,
  computeFundHoldingsValue,
  errorMessage,
  formatMoney,
  formatReturn,
  optionalString,
  parseShares,
  sortByTimeDesc,
} from './utils/finance';
import { affectedFundNames } from './utils/gamification';
import { procedures, reducers, tables } from './module_bindings';

type ThemeMode = 'light' | 'dark';
const THEME_STORAGE_KEY = 'fund-floor-theme';
const SOUND_STORAGE_KEY = 'fund-floor-sound';

function readStoredTheme(): ThemeMode {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: ThemeMode): void {
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function readStoredSoundEnabled(): boolean {
  return localStorage.getItem(SOUND_STORAGE_KEY) === 'on';
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: ThemeMode;
  onToggle: () => void;
}) {
  return (
    <button className="secondary-button" onClick={onToggle} type="button">
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}

function App() {
  const { identity, isActive: connected, connectionError } = useSpacetimeDB();
  const [accounts] = useTable(tables.my_account);
  const [players] = useTable(tables.my_player);
  const [funds, fundsReady] = useTable(tables.market_funds);
  const [fundConstituents] = useTable(tables.fund_constituents);
  const [stocks] = useTable(tables.market_stocks);
  const [keyArticles] = useTable(tables.keyArticle);
  const [fundHoldings] = useTable(tables.my_fund_holdings);
  const [fundTrades] = useTable(tables.my_fund_trades);
  const [leaderboardRows] = useTable(tables.leaderboard);
  const [newsItems] = useTable(tables.recent_market_news);
  const [portfolioHistory] = useTable(tables.my_portfolio_history);
  const [managerTrades] = useTable(tables.ai_trader_log);
  const [institutionalFlows] = useTable(tables.institutional_flow_log);
  const [managerMinds] = useTable(tables.ai_trader_minds);
  const [marketClockRows] = useTable(tables.market_clock);
  const [dailyPredictions] = useTable(tables.my_daily_prediction);
  const [daySummaries] = useTable(tables.latest_day_summary);
  const [predictionResults] = useTable(tables.prediction_results);
  const [predictionLeaderboard] = useTable(tables.prediction_leaderboard);

  const seedMarket = useReducer(reducers.seedMarket);
  const setName = useReducer(reducers.setName);
  const buyFund = useReducer(reducers.buyFund);
  const sellFund = useReducer(reducers.sellFund);
  const submitPrediction = useReducer(reducers.submitPrediction);
  const setGlobalAiConfig = useReducer(reducers.setGlobalAiConfig);
  const generateDemoNews = useProcedure(procedures.generateDemoNews);
  const getGlobalAiConfigStatus = useProcedure(procedures.getGlobalAiConfigStatus);
  const testGlobalAiConnection = useProcedure(procedures.testGlobalAiConnection);

  const account = accounts[0];
  const me = players[0];
  const seedAttempted = useRef(false);

  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [shares, setShares] = useState('1');
  const [tradeError, setTradeError] = useState('');
  const [predictionError, setPredictionError] = useState('');
  const [nameError, setNameError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => Date.now());
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [globalAiConfigured, setGlobalAiConfigured] = useState(false);
  const [aiConnectionState, setAiConnectionState] = useState<AiConnectionState>('unknown');
  const [aiConnectionMessage, setAiConnectionMessage] = useState('');
  const [aiSettingsLoading, setAiSettingsLoading] = useState(false);
  const [aiSettingsSaving, setAiSettingsSaving] = useState(false);
  const [aiSettingsTesting, setAiSettingsTesting] = useState(false);
  const [aiSettingsError, setAiSettingsError] = useState('');
  const [aiDraft, setAiDraft] = useState({
    provider: 'openai',
    apiKey: '',
    model: defaultModel('openai'),
    systemPrompt: '',
  });
  const [predictionPopupDismissed, setPredictionPopupDismissed] = useState(false);
  const prevPhaseRef = useRef('');
  const previousRankRef = useRef<number | null>(null);
  const previousKeyArticleIdRef = useRef<bigint | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
  const [soundEnabled, setSoundEnabled] = useState(() => readStoredSoundEnabled());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [portfolioChartRange, setPortfolioChartRange] =
    useState<PortfolioChartRange>('day');

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(current => (current === 'dark' ? 'light' : 'dark'));
  };

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(current => [...current.slice(-2), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts(current => current.filter(item => item.id !== id));
    }, 3200);
  }, []);

  const playCue = useCallback(
    (cue: GameCue) => {
      if (soundEnabled) playGameCue(cue);
    },
    [soundEnabled]
  );

  const toggleSound = () => {
    setSoundEnabled(current => {
      const next = !current;
      localStorage.setItem(SOUND_STORAGE_KEY, next ? 'on' : 'off');
      if (next) playGameCue('trade-success', 0.12);
      return next;
    });
  };

  useEffect(() => {
    if (!connected || !fundsReady || funds.length > 0 || seedAttempted.current) return;
    seedAttempted.current = true;
    seedMarket().catch(() => {
      seedAttempted.current = false;
    });
  }, [connected, fundsReady, funds.length, seedMarket]);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => setLastRefreshedAt(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, [connected]);

  const sortedFunds = useMemo(
    () => [...funds].sort((left, right) => left.name.localeCompare(right.name)) as FundMarketItem[],
    [funds, lastRefreshedAt]
  );
  const sortedFundConstituents = useMemo(
    () =>
      [...fundConstituents].sort((left, right) => {
        const fundOrder = left.fundName.localeCompare(right.fundName);
        if (fundOrder !== 0) return fundOrder;
        if (right.valueCents > left.valueCents) return 1;
        if (right.valueCents < left.valueCents) return -1;
        return left.symbol.localeCompare(right.symbol);
      }) as FundConstituentItem[],
    [fundConstituents, lastRefreshedAt]
  );
  const sortedStocks = useMemo(
    () =>
      [...stocks].sort((left, right) => left.symbol.localeCompare(right.symbol)) as StockMarketItem[],
    [stocks, lastRefreshedAt]
  );
  const latestKeyArticle = useMemo(() => {
    const latest = sortByTimeDesc(keyArticles)[0];
    return latest as KeyArticleItem | undefined;
  }, [keyArticles, lastRefreshedAt]);
  const latestAffectedFunds = useMemo(
    () => affectedFundNames(latestKeyArticle?.symbol, sortedFundConstituents, 3),
    [latestKeyArticle?.symbol, sortedFundConstituents]
  );

  // Reset prediction popup when entering results phase
  const currentPhase = marketClockRows[0]?.phase ?? '';
  useEffect(() => {
    if (currentPhase === 'results' && prevPhaseRef.current !== 'results') {
      setPredictionPopupDismissed(false);
    }
    if (currentPhase === 'open' && prevPhaseRef.current && prevPhaseRef.current !== 'open') {
      playCue('market-open');
    }
    if (currentPhase === 'closing_warning' && prevPhaseRef.current !== 'closing_warning') {
      playCue('closing-warning');
    }
    prevPhaseRef.current = currentPhase;
  }, [currentPhase, playCue]);

  const activeSymbol =
    selectedSymbol || (sortedFunds.length > 0 ? sortedFunds[0].symbol : '');
  const activeFund = sortedFunds.find(row => row.symbol === activeSymbol);
  const marketClock = marketClockRows[0];
  const dailyPrediction = dailyPredictions[0];

  const cashBalance = clampNonNegativeCents(account?.balanceCents ?? 0n);
  const fundHoldingsValue = clampNonNegativeCents(
    computeFundHoldingsValue(fundHoldings, sortedFunds)
  );
  const portfolioValue = clampNonNegativeCents(cashBalance + fundHoldingsValue);
  const sortedLeaderboard = useMemo(
    () => sortLeaderboard(leaderboardRows),
    [leaderboardRows, lastRefreshedAt]
  );
  const currentRank = useMemo(() => {
    if (!identity) return null;
    const index = sortedLeaderboard.findIndex(entry => identity.isEqual(entry.owner));
    return index >= 0 ? index + 1 : null;
  }, [identity, sortedLeaderboard]);
  useEffect(() => {
    if (currentRank == null) return;
    if (previousRankRef.current != null && currentRank < previousRankRef.current) {
      playCue('rank-up');
      addToast({
        title: 'Rank up',
        detail: `You moved to #${currentRank}.`,
        tone: 'success',
      });
    }
    previousRankRef.current = currentRank;
  }, [addToast, currentRank, playCue]);
  useEffect(() => {
    if (!latestKeyArticle) return;
    if (previousKeyArticleIdRef.current == null) {
      previousKeyArticleIdRef.current = latestKeyArticle.id;
      return;
    }
    if (latestKeyArticle.id !== previousKeyArticleIdRef.current) {
      previousKeyArticleIdRef.current = latestKeyArticle.id;
      playCue('key-article');
      addToast({
        title: 'Key article',
        detail: `${latestKeyArticle.symbol} ${latestKeyArticle.sentiment}. Watch affected funds.`,
        tone: 'alert',
      });
    }
  }, [addToast, latestKeyArticle, playCue]);
  const portfolioChartPoints = useMemo(() => {
    const dayIndex = marketClock?.dayIndex ?? 1n;
    const currentGameMinute = marketClock?.currentGameMinute ?? 570n;
    const nowTimelineMinute = gameTimelineMinuteFromClock(dayIndex, currentGameMinute);
    return buildPortfolioChartSeries(
      portfolioHistory,
      portfolioValue,
      nowTimelineMinute,
      portfolioChartRange
    );
  }, [
    portfolioHistory,
    portfolioValue,
    marketClock?.dayIndex,
    marketClock?.currentGameMinute,
    portfolioChartRange,
  ]);
  const recentNews = useMemo(
    () => sortByTimeDesc(newsItems).slice(0, 6),
    [newsItems, lastRefreshedAt]
  );
  const recentFundTrades = useMemo(
    () => sortByTimeDesc(fundTrades).slice(0, 8),
    [fundTrades, lastRefreshedAt]
  );

  const applyConnectionResult = (result: { ok: boolean; message: string }) => {
    if (result.ok) {
      setAiConnectionState('connected');
      setAiConnectionMessage(result.message);
    } else {
      setAiConnectionState('failed');
      setAiConnectionMessage(result.message);
    }
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
      if (status.configured) await runAiConnectionTest();
      else setAiConnectionState('not_configured');
    } catch (caught) {
      setAiSettingsError(errorMessage(caught));
    } finally {
      setAiSettingsLoading(false);
    }
  };

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
        systemPrompt: aiDraft.systemPrompt.trim() || undefined,
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
    setNameError('');
    try {
      await setName({ name });
    } catch (caught) {
      setNameError(errorMessage(caught));
    }
  };

  const runTrade = async (side: 'buy' | 'sell') => {
    if (marketClock && !marketClock.tradesAllowed) {
      setTradeError('Trading is frozen until the next day starts.');
      playCue('trade-error');
      return;
    }
    const shareCount = parseShares(shares);
    if (!activeFund) {
      setTradeError('Choose a fund.');
      playCue('trade-error');
      return;
    }
    if (!shareCount) {
      setTradeError('Enter a whole number of shares greater than zero.');
      playCue('trade-error');
      return;
    }

    setTradeError('');
    setSubmitting(true);
    try {
      if (side === 'buy') await buyFund({ symbol: activeFund.symbol, shares: shareCount });
      else await sellFund({ symbol: activeFund.symbol, shares: shareCount });
      playCue('trade-success');
      addToast({
        title: side === 'buy' ? 'Buy executed' : 'Sell executed',
        detail: `${shareCount.toString()} ${activeFund.name} shares @ ${formatMoney(activeFund.priceCents)}`,
        tone: 'success',
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setTradeError(message);
      playCue('trade-error');
      addToast({
        title: 'Trade rejected',
        detail: message,
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitDailyPrediction = async (bestFundSymbol: string, worstFundSymbol: string) => {
    setPredictionError('');
    setSubmitting(true);
    try {
      await submitPrediction({ bestFundSymbol, worstFundSymbol });
    } catch (caught) {
      setPredictionError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const postDemoNews = async () => {
    setNewsError('');
    setSubmitting(true);
    try {
      await generateDemoNews({ symbol: undefined });
    } catch (caught) {
      setNewsError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected || !identity || !account) {
    const spacetimeHost =
      import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
    const spacetimeDb =
      import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'llm-chat-ts';

    return (
      <main className="empty-state full-height">
        <div style={{ display: 'grid', gap: '1rem', justifyItems: 'center' }}>
          <ThemeToggle onToggle={toggleTheme} theme={theme} />
          <h1>Fund Floor</h1>
          {connectionError ? (
            <>
              <p className="error-text">
                Could not connect to SpacetimeDB: {connectionError.message}
              </p>
              <p className="muted">
                Server: {spacetimeHost} · Database: {spacetimeDb}
              </p>
            </>
          ) : (
            <p>Connecting and opening your account...</p>
          )}
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="welcome-screen">
        <section className="welcome-card">
          <div className="top-actions" style={{ justifyContent: 'flex-end' }}>
            <ThemeToggle onToggle={toggleTheme} theme={theme} />
          </div>
          <p className="muted">Fund Floor</p>
          <h1>Welcome</h1>
          <p>Welcome to Fund Floor. Multiple funds compete in the market — some managed by AI, some by algorithms, all anonymous. Trade fund shares, predict daily winners, and grow your <strong>{formatMoney(STARTING_CAPITAL_CENTS)}</strong> portfolio.</p>

          <p className="muted">Pick a nickname to join the leaderboard alongside the demo traders.</p>

          {nameError && <p className="error-text">{nameError}</p>}
          <NameForm onSubmit={saveName} />
        </section>
      </main>
    );
  }

  return (
    <main className="app-page">
      <ToastStack toasts={toasts} />
      <header className="top-bar">
        <div>
          <p className="muted">Fund Floor</p>
          <h1>Trading desk</h1>
        </div>
        <div className="top-actions">
          <ThemeToggle onToggle={toggleTheme} theme={theme} />
          <span className={`status ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <button onClick={() => setAiSettingsOpen(true)} type="button">
            AI Settings {globalAiConfigured ? '✓' : ''}
          </button>
          <strong>{me.name}</strong>
        </div>
      </header>

      <MarketPulseStrip
        affectedFunds={latestAffectedFunds}
        clock={marketClock}
        keyArticle={latestKeyArticle}
        onToggleSound={toggleSound}
        soundEnabled={soundEnabled}
        stocks={sortedStocks}
      />

      {marketClock?.phase === 'results' &&
        !predictionPopupDismissed &&
        dailyPrediction?.settledAt != null && (
          <PredictionResultPopup
            bestFundSymbol={dailyPrediction.bestFundSymbol}
            worstFundSymbol={dailyPrediction.worstFundSymbol}
            bestCorrect={dailyPrediction.bestCorrect}
            worstCorrect={dailyPrediction.worstCorrect}
            bonusCents={dailyPrediction.bonusCents}
            onClose={() => setPredictionPopupDismissed(true)}
          />
        )}

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
        onProviderChange={value => setAiDraft(draft => ({ ...draft, provider: value, model: defaultModel(value) }))}
        onSave={() => void saveGlobalAiConfig()}
        onSystemPromptChange={value => setAiDraft(draft => ({ ...draft, systemPrompt: value }))}
        onTestConnection={() => void runAiConnectionTest()}
        open={aiSettingsOpen}
        provider={aiDraft.provider}
        saving={aiSettingsSaving}
        systemPrompt={aiDraft.systemPrompt}
        testingConnection={aiSettingsTesting}
      />

      <MarketClockBanner clock={marketClock} daySummary={daySummaries[0]} funds={sortedFunds} />

      <section className="hero-panel">
        <div className="hero-header">
          <div>
            <p className="muted">Player performance</p>
            <h2>{me.name}</h2>
            <p className="muted">Metrics refresh every 5s · Last updated {new Date(lastRefreshedAt).toLocaleTimeString()}</p>
          </div>
          <div className="rank-block">
            <span className="muted">Current rank</span>
            <strong>{currentRank ? `#${currentRank}` : 'Unranked'}</strong>
          </div>
        </div>
        <div className="metric-grid">
          <MetricTile label="Portfolio value" value={formatMoney(portfolioValue)} />
          <MetricTile accent={portfolioValue >= STARTING_CAPITAL_CENTS ? '#86efac' : '#fca5a5'} label="Total return" value={formatReturn(portfolioValue)} />
          <MetricTile label="Cash balance" value={formatMoney(cashBalance)} />
          <MetricTile label="Fund holdings" value={formatMoney(fundHoldingsValue)} />
        </div>
        <PortfolioHistoryChart
          onRangeChange={setPortfolioChartRange}
          points={portfolioChartPoints}
          range={portfolioChartRange}
        />
      </section>

      <section className="main-grid">
        <article className="panel market-panel">
          <h2>Fund market</h2>
          <p className="muted">Funds trade the underlying market. Public names rotate each day. Can you spot the patterns?</p>
          <FundMarketTable funds={sortedFunds} selectedSymbol={activeSymbol} onSelect={setSelectedSymbol} />
        </article>
        <TradeTicket
          activeFund={activeFund}
          error={tradeError}
          onSharesChange={setShares}
          onTrade={runTrade}
          shares={shares}
          submitting={submitting}
          tradesAllowed={marketClock?.tradesAllowed ?? true}
        />
        <FundConstituentsPanel
          activeFund={activeFund}
          constituents={sortedFundConstituents}
        />
      </section>

      <section className="main-grid">
        <PortfolioSummary
          cashBalance={cashBalance}
          fundHoldings={fundHoldings}
          fundHoldingsValue={fundHoldingsValue}
          funds={sortedFunds}
          portfolioValue={portfolioValue}
        />
        <PredictionCard
          error={predictionError}
          funds={sortedFunds}
          onSubmit={submitDailyPrediction}
          prediction={dailyPrediction}
          predictionsAllowed={marketClock?.predictionsAllowed ?? false}
          submitting={submitting}
          history={predictionResults}
          leaderboard={predictionLeaderboard}
        />
      </section>

      <section className="main-grid">
        <article className="panel">
          <h2>My fund trades</h2>
          {recentFundTrades.length === 0 ? (
            <p className="muted">No fund trades yet.</p>
          ) : (
            <ul className="trade-list">
              {recentFundTrades.map(trade => (
                <li key={trade.id.toString()}>
                  <strong style={{ color: trade.side === 'buy' ? GAIN_COLOR : LOSS_COLOR }}>
                    {trade.side === 'buy' ? 'Buy' : 'Sell'}
                  </strong>{' '}
                  {trade.shares.toString()} {trade.symbol} @ {formatMoney(trade.priceCents)}
                  <div className="muted">Total {formatMoney(trade.totalCents)} · {trade.createdAt.toDate().toLocaleString()}</div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="main-grid">
        <LeaderboardPanel identity={identity} rows={leaderboardRows} />
        <NewsFeed
          affectedFunds={latestAffectedFunds}
          configured={globalAiConfigured}
          failedMessage={newsError}
          keyArticle={latestKeyArticle}
          news={recentNews}
          onGenerate={() => void postDemoNews()}
          submitting={submitting}
        />
      </section>

      <section className="activity-grid">
        <ManagerActivity minds={managerMinds} trades={[...managerTrades].reverse()} />
        <InstitutionalFlow flows={[...institutionalFlows].reverse()} />
      </section>
    </main>
  );
}

export default App;
