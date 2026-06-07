# Market Sim / Fund Floor

A multiplayer fund-trading game built on [SpacetimeDB](https://spacetimedb.com). Players trade shares of public funds while hidden LLM and scripted managers trade an underlying stock market. The player goal is to infer which funds will perform best and grow their own portfolio.

## Current Functionality

- **Fund-share trading** — players buy and sell public fund shares through `buy_fund` / `sell_fund`.
- **Hidden fund managers** — three LLM-managed funds use conservative, moderate, and aggressive trading styles.
- **Scripted funds** — deterministic/script-managed funds act as non-LLM competitors and decoys.
- **Randomized public fund names** — manager identities are presented as mutual-fund-style public names for the session.
- **Underlying stock market** — fund managers trade NVDA, AAPL, GOOGL, MSFT, and AMZN; stock prices move with trade impact.
- **NAV-backed fund prices** — each fund share price derives from the manager's underlying portfolio value divided by total fund shares.
- **Limited public float** — each fund has a fixed available share float players can buy from and sell back into.
- **Player portfolio** — players start with $10,000 and track cash, fund holdings value, total return, private trades, and 24h portfolio history.
- **Public leaderboard** — ranks players and fund managers by estimated portfolio value.
- **Market signals** — AI-generated or manual market headlines can react to trading activity without naming human players.
- **AI settings** — a shared OpenAI/OpenRouter key is stored in SpacetimeDB via `global_ai_config`.
- **Componentized frontend** — React UI is split into focused `components/` and deterministic `utils/`.
- **Unit tests** — deterministic finance, chart, fund-pricing, and market-math helpers are covered with Vitest.

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

## How Gameplay Works

### Player Loop

Players do not directly trade the underlying stocks in the current UI. They:

1. Review public fund names, prices, day returns, and available float.
2. Read market signals and manager tape activity.
3. Buy or sell fund shares.
4. Compete on total portfolio value.

### Fund Managers

There are five public funds today:

- Three LLM-managed funds: conservative, moderate, aggressive.
- Two scripted funds: deterministic market participants/decoys.

Managers have large starting balances and trade the underlying stock market. Their public names are randomized mutual-fund-style labels, while their internal manager type is hidden from the player-facing concept.

### Fund Pricing

Each fund has:

- `total_shares`
- `available_shares`
- `nav_cents`
- `price_cents`

The current share price is derived from:

```text
fund price = manager portfolio NAV / total shares
```

Player fund trades update player cash, private fund holdings, private fund trade history, and the fund's available public float.

### Underlying Market

The underlying stock market still exists and drives fund performance:

- Seed stocks: NVDA, AAPL, GOOGL, MSFT, AMZN
- Buys and sells apply basis-point price impact.
- Fund manager portfolios are valued from cash plus stock holdings.

## Project Structure

```text
market-sim/
├── spacetimedb/src/
│   ├── index.ts              # SpacetimeDB schema, reducers, views, timers
│   ├── ai_trader_llm.ts      # LLM prompt + response parsing
│   ├── ai_market_news.ts     # AI news prompt + response parsing
│   ├── llm.ts                # OpenAI/OpenRouter HTTP helpers
│   ├── models/               # Fund and AI-manager definitions
│   └── utils/                # Deterministic backend helpers
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
| `buy_stock` / `sell_stock` | Underlying stock execution path, mainly used by managers |
| `set_name` | Player leaderboard nickname |
| `set_global_ai_config` | Shared LLM provider/key/model settings |
| `seed_market` | Idempotently seeds stocks, managers, funds, and timers |

### Procedures

| Procedure | Description |
|-----------|-------------|
| `generate_demo_news` | Generate a manual AI market headline |
| `get_global_ai_config_status` | Check whether shared AI config exists |
| `test_global_ai_connection` | Ping OpenAI/OpenRouter |
| `ai_trader_nova_tick` | Scheduled tick for the conservative LLM manager timer slot |
| `ai_trader_pulse_tick` | Scheduled tick for the moderate LLM manager timer slot |
| `ai_trader_apex_tick` | Scheduled tick for the aggressive LLM manager |
| `ai_market_news_tick` | Scheduled AI news desk check |

### Public Tables / Views

| View/Table | Description |
|------------|-------------|
| `market_funds` | Public fund market: name, symbol, NAV, price, float |
| `my_fund_holdings` / `my_fund_trades` | Private player fund positions and fund trade history |
| `my_account` / `my_portfolio_history` | Private player cash and portfolio history |
| `leaderboard` | Public ranking by estimated portfolio value |
| `ai_trader_log` | Public manager trade tape |
| `ai_trader_minds` | Public manager status rows |
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

## TODOs Against Initial Spec

- **True daily round system** — current code uses UTC trading-day fields and live ticks, but there is no explicit round start/end, day close summary, or locked trading window.
- **Player prediction mechanic** — players can trade fund shares, but there is not yet a separate "predict what to buy/sell today" objective, scoring rule, or prediction submission history.
- **Stronger information hiding** — the UI hides explicit bot names, but some fields still expose risk/profile text and manager tape details that may be too revealing for the intended mystery.
- **Fund naming per session** — aliases are deterministic from the trading day; there is no explicit session entity with its own seed, reset, or replay lifecycle.
- **Share issuance controls** — funds have a fixed float, but there is no admin/reset flow for replenishing float or creating new fund seasons.
- **LLM behavior tuning** — prompts are functional, but they should be revisited for the final game objective, risk constraints, and anti-collusion/anti-leakage rules.
- **Script-managed fund diversity** — scripted funds exist, but their strategies are still simple and should be expanded so they are convincing decoys.
- **Player onboarding/copy** — the UI is usable, but needs clearer game framing without exposing hidden mechanics.
- **End-to-end tests** — deterministic unit tests exist; browser/SpacetimeDB integration tests are still missing.
- **Operational admin tools** — no admin UI yet for resetting seasons, rotating fund aliases, inspecting manager internals, or controlling AI/news schedules.

## Further Reading

- [SpacetimeDB TypeScript SDK](https://spacetimedb.com/docs/intro/core-concepts/clients/typescript-reference)
- [SpacetimeDB CLI install](https://spacetimedb.com/install)
