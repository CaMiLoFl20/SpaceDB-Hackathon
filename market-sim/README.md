# Market Sim / Fund Floor

A multiplayer fund-trading game built on [SpacetimeDB](https://spacetimedb.com). Players trade shares of anonymous public funds while hidden LLM and scripted managers trade an underlying stock market. The player goal is to read the signals, pick the best funds, and grow their portfolio.

## How to Play

### Objective

You are a retail trader competing in a compressed market simulation. Your job is to grow your portfolio by buying and selling shares of public funds, reading market signals, and predicting which funds will outperform each trading day.

You do **not** trade individual stocks directly. Stocks are the underlying assets traded by fund managers. Their gains and losses flow through to fund NAVs and fund share prices.

### Getting Started

1. Open the app and pick a **nickname** — you start with **$10,000** in cash.
2. The **fund market** shows five anonymous funds with current prices, daily returns, and available shares.
3. Fund names rotate each day. Some funds are managed by AI, some by algorithms — figuring out which is which is part of the game.

### Trading

- Select a fund from the market table, enter a share count, and click **Buy** or **Sell**.
- Use the **Fund holdings** panel to inspect the stocks inside the selected fund before buying. Players can research stock exposure, but cannot trade stocks directly.
- Fund share prices are backed by each manager's underlying portfolio NAV (net asset value). When a manager trades well, their fund price goes up.
- Each fund has a limited public float (250,000 shares). Shares you buy come from the float; shares you sell go back into it.
- Your portfolio value = cash + (fund shares x current fund prices).

### Fund Holdings

Each fund is a wrapper around a live stock portfolio. The **Fund holdings** panel shows the selected fund's current stock constituents:

- **Stock** — the underlying company symbol and name.
- **Price / Day** — the current stock price and its daily move.
- **Shares** — how many shares the fund manager currently holds.
- **Weight** — how much of the fund's NAV is exposed to that stock.

Use this panel to connect public market news to funds. For example, if a key article sharply hurts `NVDA`, funds with heavier `NVDA` exposure should be more vulnerable than funds that do not hold it.

### Daily Predictions

- Before **10:30 AM game time** each day, you can predict which fund will be the **best performer** and which will be the **worst**.
- Correct picks pay cash bonuses at market close:
  - Best fund correct: **$250**
  - Worst fund correct: **$250**
  - Both correct (combo): **$250** bonus
- Your prediction history and a **prediction leaderboard** track accuracy over time.

### Reading the Signals

- **Market pulse strip** — track top stock movers, active key articles, and time remaining without leaving the trading desk.
- **Manager activity tape** — see real-time trades by fund managers (buy/sell, stock, shares, price).
- **Market news** — AI-generated headlines react to trading activity and market moves.
- **Fund price movements** — watch which funds are gaining or losing value throughout the day.
- **Fund holdings** — inspect the stock exposure behind each fund before placing an order.
- **Key articles** — occasional market shock events can move individual stock prices significantly, which can quickly lift or damage funds holding those stocks.

### Feedback and Sound

- Trade confirmations and rejected trades appear as short toast notifications.
- Key articles and rank gains also trigger toasts so important events do not get buried in the feed.
- Sound is muted by default. Use the **Sound** toggle in the market pulse strip to enable short cues for market open, closing warning, trades, key articles, and rank movement.

### Game Day Cycle

Each trading day runs on compressed time (~3.25 real-time minutes per game day):

| Phase | Duration | What happens |
|-------|----------|-------------|
| **Open** | ~2.75 min | Trading and predictions are live. Prediction window closes at 10:30 AM game time. |
| **Closing warning** | ~30s | Last chance to trade before the day ends. |
| **Frozen** | ~10s | Day is settling. Trading is locked. |
| **Results** | ~15s | Day summary shows best/worst fund, returns, and top player. |

The next day opens automatically after results.

### Winning

Compete on the **leaderboard** — ranked by total portfolio value (cash + fund holdings). Leaderboards show human players only; fund managers still appear in the trade tape, fund activity, and market signals.

## Current Functionality

- **Fund-share trading** — buy and sell public fund shares with real-time price updates.
- **Pre-trade fund research** — selected funds disclose their current underlying stock constituents, position values, and weights.
- **Five anonymous funds** — three LLM-managed and two scripted, all presented with randomized mutual-fund-style names.
- **Distinct fund strategies** — LLM funds use conservative/moderate/aggressive styles via daily trading plans. Scripted funds use sector rotation and momentum-chasing strategies.
- **Information hiding** — fund types, risk profiles, and manager reasoning are hidden from players. Only public signals (prices, trades, news) are visible.
- **Daily predictions** — pick best/worst fund each day for cash bonuses, with history and leaderboard tracking.
- **Day close results** — each day ends with a summary phase showing best/worst fund performance and top player.
- **NAV-backed fund pricing** — fund share prices derive from each manager's underlying stock portfolio.
- **AI market news** — LLM-generated headlines react to trading activity without revealing player or manager identities.
- **Market pulse strip** — top movers, key article status, clock, and sound toggle in one compact status row.
- **Game feedback** — toast notifications and optional Web Audio cues for trades, rejected actions, key articles, market open/close warning, and rank gains.
- **Portfolio history chart** — track performance over compressed game-time ranges: 24h, week, month, and year.
- **Anti-leakage LLM prompts** — bot prompts use public aliases, include anti-collusion rules, and do not expose strategy types.
- **Unit tests** — deterministic finance, chart, fund-pricing, game-day, and prediction helpers covered with Vitest.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [SpacetimeDB CLI](https://spacetimedb.com/install) 2.4+
- Optional OpenAI or OpenRouter API key for LLM manager decisions and market news

## Working Together

Everyone connects to the same hosted database so you see the same funds, market, leaderboard, and manager activity.

```bash
git clone https://github.com/CaMiLoFl20/SpaceDB-Hackathon.git
cd SpaceDB-Hackathon/market-sim

npm install
cd spacetimedb && npm install && cd ..

cp .env.example .env.local
npm run dev
```

Open the Vite URL printed in the terminal, usually [http://localhost:5173](http://localhost:5173). If that port is busy, Vite will print another port.

### Shared Database

| Setting | Value |
|---------|-------|
| Host | `https://maincloud.spacetimedb.com` |
| Database | `market-sim-69q12` |
| Dashboard | https://spacetimedb.com/market-sim-69q12 |

### API Key

The AI key lives in the server (`global_ai_config` table), not in git.

1. Open the app.
2. Open **AI Settings**.
3. Paste an OpenAI or OpenRouter API key and save.
4. Confirm the connection state shows connected.

Only one global key is needed for the shared DB. Do not commit keys.

## Project Structure

```text
market-sim/
├── spacetimedb/src/
│   ├── index.ts              # SpacetimeDB schema, reducers, views, timers
│   ├── ai_trader_llm.ts      # LLM prompt + response parsing
│   ├── ai_trading_plan.ts    # Daily trading plan LLM prompt + parsing
│   ├── ai_market_news.ts     # AI news prompt + response parsing
│   ├── llm.ts                # OpenAI/OpenRouter HTTP helpers
│   ├── models/               # Fund and AI-manager definitions
│   └── utils/                # Deterministic backend helpers (game_day, predictions, etc.)
├── src/
│   ├── App.tsx               # Data wiring / main page composition
│   ├── components/           # React UI components
│   ├── utils/                # Deterministic frontend helpers
│   ├── main.tsx              # SpacetimeDB connection
│   └── module_bindings/      # Auto-generated; run spacetime:generate after schema changes
├── .env.example              # Copy to .env.local
└── spacetime.json            # CLI database config
```

## Server API

### Reducers

| Reducer | Description |
|---------|-------------|
| `buy_fund` / `sell_fund` | Player fund-share trading |
| `buy_stock` / `sell_stock` | Underlying stock execution, mainly used by managers |
| `set_name` | Player leaderboard nickname |
| `submit_prediction` | Daily best/worst fund prediction |
| `set_global_ai_config` | Shared LLM provider/key/model settings |
| `seed_market` | Idempotently seeds stocks, managers, funds, and timers |

### Procedures

| Procedure | Description |
|-----------|-------------|
| `generate_demo_news` | Generate a manual AI market headline |
| `get_global_ai_config_status` | Check whether shared AI config exists |
| `test_global_ai_connection` | Ping OpenAI/OpenRouter |
| `ai_trader_nova_tick` | Scheduled tick for LLM manager timer slot 1 |
| `ai_trader_pulse_tick` | Scheduled tick for LLM manager timer slot 2 |
| `ai_trader_apex_tick` | Scheduled tick for LLM manager timer slot 3 |
| `ai_market_news_tick` | Scheduled AI news desk check |

### Public Tables / Views

| View/Table | Description |
|------------|-------------|
| `market_funds` | Public fund market: name, symbol, NAV, price, float (type/risk hidden) |
| `fund_constituents` | Public read-only stock constituents for each fund |
| `market_clock` | Current game day, phase, time, countdown |
| `latest_day_summary` | Most recent day close summary (best/worst fund, top player) |
| `my_fund_holdings` / `my_fund_trades` | Private player fund positions and trade history |
| `my_account` / `my_portfolio_history` | Private player cash and portfolio snapshots |
| `my_daily_prediction` | Current day prediction (if submitted) |
| `prediction_results` | Last 10 settled predictions for the player |
| `prediction_leaderboard` | Public prediction accuracy rankings |
| `leaderboard` | Public human-player ranking by estimated portfolio value |
| `ai_trader_log` | Public manager trade tape |
| `ai_trader_minds` | Public manager status (reasoning/source hidden) |
| `market_stocks` | Public underlying stock prices |
| `recent_market_news` | Public market signal feed |

## Development

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check and build frontend |
| `npm test` | Run Vitest unit tests |
| `npm run spacetime:generate` | Regenerate TypeScript bindings |
| `npm run spacetime:publish` | Publish module to maincloud |

### Backend Build / Publish

When changing `spacetimedb/src/`:

```bash
cd market-sim/spacetimedb
npm run build

cd ..
npm run spacetime:generate
npm run build
npm test
spacetime publish --module-path spacetimedb --server maincloud -y market-sim-69q12
```

After publishing, call the seed reducer if you need new seed logic to run immediately:

```bash
spacetime call --server maincloud market-sim-69q12 seed_market
```

## Environment Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `VITE_SPACETIMEDB_HOST` | `https://maincloud.spacetimedb.com` | Browser SpacetimeDB host |
| `VITE_SPACETIMEDB_DB_NAME` | `market-sim-69q12` | Browser database name |
| `SPACETIMEDB_HOST` | `https://maincloud.spacetimedb.com` | Optional CLI helper |
| `SPACETIMEDB_DB_NAME` | `market-sim-69q12` | Optional CLI helper |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Browser tries `ws://localhost:3000/v1/database/llm-chat-ts` | Create `.env.local` from `.env.example`, restart Vite, and hard-refresh |
| `nonexistent reducer/view/table` | Publish latest module and run `npm run spacetime:generate` |
| Empty funds | Reconnect or call `spacetime call --server maincloud market-sim-69q12 seed_market` |
| Cannot publish: not a collaborator | Ask DB owner to add your `spacetime login show` identity |
| Cannot publish: database suspended | Ask DB owner to start/reactivate the database |
| Bots/managers not trading | Check `spacetime logs market-sim-69q12 -f`; verify AI settings if LLM mode is expected |
| OpenAI quota errors | Add billing/credits or use OpenRouter |

## Remaining TODOs

- **Fund naming per session** — aliases rotate daily; no explicit session entity with its own seed, reset, or replay lifecycle.
- **Share issuance controls** — funds have a fixed float but no admin/reset flow for replenishing it.
- **End-to-end tests** — deterministic unit tests exist; browser/SpacetimeDB integration tests are still missing.
- **Operational admin tools** — no admin UI yet for resetting seasons, rotating fund aliases, or controlling AI schedules.
- **Additional gamification polish** — achievements, streaks, and richer end-of-day presentation are still open.

## Proposed Gamification Enhancements

These are remaining design candidates, not yet implemented.

### UI Enhancements

- **Fund exposure badges** — show the selected fund's largest holdings as small badges beside the trade ticket, such as `NVDA 28%` or `AAPL 12%`.
- **End-of-day results card** — richer close screen with best/worst fund, your prediction result, portfolio delta, rank movement, and biggest missed opportunity.
- **Rank movement indicator** — small up/down rank delta near the leaderboard and player summary after each results phase.
- **Prediction streak meter** — track consecutive correct prediction components to make the prediction game feel cumulative.
- **Portfolio milestone badges** — lightweight achievements for first trade, first profitable day, correct combo prediction, new all-time high, and top-three rank.

## Further Reading

- [SpacetimeDB TypeScript SDK](https://spacetimedb.com/docs/intro/core-concepts/clients/typescript-reference)
- [SpacetimeDB CLI install](https://spacetimedb.com/install)
