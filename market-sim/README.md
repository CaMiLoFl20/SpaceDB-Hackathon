# Market Sim

A multiplayer stock market simulator built on [SpacetimeDB](https://spacetimedb.com). Trade top US tech stocks, compete on a public leaderboard, and watch AI institutions move the market. Optional LLM integration generates contextual market news from recent activity.

## Features

- **Live trading** — Buy and sell NVDA, AAPL, GOOGL, MSFT, and AMZN with price impact based on order size
- **$10,000 starting capital** — Each player gets a fresh account on first connect
- **Private trades** — Your trade history is visible only to you; human trader names are never shown publicly
- **Public leaderboard** — Ranked by estimated portfolio value (cash + holdings at current prices)
- **AI institutions** — Titan Capital, Northbridge Quant, Atlas Pension, Helios Market Making, and Sentinel Asset Management react to human trades and run on a 30-second market tick
- **Market news** — Institutional moves publish AI Market Mover headlines; optional LLM-generated demo news via OpenAI or OpenRouter
- **Global AI settings** — One shared LLM config for demo news (set via the AI Settings panel)

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [SpacetimeDB CLI](https://spacetimedb.com/install) 2.4+
- (Optional) OpenAI or OpenRouter API key for LLM-generated news

## Quick start (local)

```bash
npm install
cd spacetimedb && npm install && cd ..

# Starts local SpacetimeDB, publishes module, generates bindings, runs Vite
spacetime dev
```

Open [http://localhost:5173](http://localhost:5173).

## Quick start (maincloud)

Connect to the hosted demo database:

```bash
# .env.local (or export before npm run dev)
VITE_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DB_NAME=market-sim-69q12
```

```bash
npm install
npm run dev
```

Publish module updates:

```bash
spacetime publish --module-path spacetimedb --server maincloud -y market-sim-69q12
```

Regenerate client bindings after server schema changes:

```bash
npm run spacetime:generate
```

## AI news configuration

1. Open **AI Settings** in the dashboard
2. Choose `openai` or `openrouter`
3. Enter an API key and model (defaults: `gpt-4o-mini` for OpenAI, `openai/gpt-4o-mini` for OpenRouter)
4. Click **Generate news** to run the `generate_demo_news` procedure

If no global config is set, or the LLM call fails (e.g. quota exceeded), the server falls back to deterministic template headlines. Server logs include debug lines prefixed with `[generate_demo_news]` — view them with:

```bash
spacetime logs market-sim-69q12 -f
```

API keys are stored in the `global_ai_config` table on the server. They are never returned to clients through subscriptions or status procedures. Use keys appropriate for a hackathon or demo environment.

## How the market works

### Human trades

- Buys and sells update price via basis-point impact: `min(1000, max(5, shares / 10))` bps
- Trade size, side, and totals are recorded in your private `my_trades` view

### Institutional behavior

Institutions are demo-friendly and biased toward buying:

| Trigger | Behavior |
|---------|----------|
| Human buy (large) | ~78% chance institutions accumulate, momentum-buy, or rotate in |
| Human buy (small) | ~52% chance of bullish follow-through |
| Human sell | ~68% buy-the-dip; otherwise accumulation or reduced exposure |
| Scheduled tick (30s) | ~70% bullish (accumulation, momentum, buy-the-dip, sector rotation) |
| Profit-taking | Only when price is up ≥8% vs previous reference; ~22% chance, less frequent than buying |

Institutional activity moves prices, increases volume, and publishes **AI Market Mover** news. Human activity does not appear in public news.

### Stocks (seed prices)

| Symbol | Company | Seed price |
|--------|---------|------------|
| NVDA | NVIDIA Corporation | $205.70 |
| AAPL | Apple Inc. | $307.88 |
| GOOGL | Alphabet Inc. | $366.32 |
| MSFT | Microsoft Corporation | $417.15 |
| AMZN | Amazon.com Inc. | $246.03 |

## Project structure

```
market-sim/
├── spacetimedb/              # SpacetimeDB module (server)
│   └── src/
│       ├── index.ts          # Tables, reducers, procedures, market logic
│       └── llm.ts            # OpenAI / OpenRouter HTTP helpers
├── src/
│   ├── App.tsx               # React trading dashboard
│   ├── main.tsx              # SpacetimeDB connection setup
│   └── module_bindings/      # Auto-generated — run spacetime:generate after schema changes
├── spacetime.json            # Database name and server config
└── package.json
```

## Server API (module)

### Reducers

| Reducer | Description |
|---------|-------------|
| `buy_stock` / `sell_stock` | Execute trades |
| `set_name` | Set public leaderboard nickname |
| `set_global_ai_config` | Configure shared LLM for demo news |
| `seed_market` | Idempotent stock seeding |

### Procedures

| Procedure | Description |
|-----------|-------------|
| `generate_demo_news` | Generate market news (LLM or fallback) |
| `get_global_ai_config_status` | Check whether global AI is configured (no API key returned) |

### Views (per-identity)

| View | Description |
|------|-------------|
| `my_account` | Cash balance |
| `my_holdings` | Stock positions |
| `my_trades` | Private trade ledger |
| `leaderboard` | Public rankings |

### Public tables

`stock`, `market_news`, `player_directory`, `recent_trade` (institutional activity only in UI)

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run spacetime:generate` | Regenerate TypeScript bindings |
| `npm run spacetime:publish` | Publish module to maincloud |
| `npm run spacetime:publish:local` | Publish module to local server |

## Troubleshooting

| Error | Fix |
|-------|-----|
| `nonexistent procedure "generate_demo_news"` | Publish latest module: `spacetime publish ...` |
| `invalid arguments` on generate_demo_news | Run `npm run spacetime:generate` and restart dev server |
| `callChat error: LLM HTTP 429 insufficient_quota` | Add OpenAI billing or switch to OpenRouter in AI Settings |
| Empty stock dropdown | Call `seed_market` or reconnect after publish |
| `Insufficient funds` / `Insufficient shares` | Normal validation — check balance and holdings |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_SPACETIMEDB_HOST` | `ws://localhost:3000` | SpacetimeDB WebSocket URI |
| `VITE_SPACETIMEDB_DB_NAME` | `llm-chat-ts` | Database name (set to `market-sim-69q12` for maincloud) |

## Further reading

- [SpacetimeDB TypeScript SDK](https://spacetimedb.com/docs/intro/core-concepts/clients/typescript-reference)
- [Chat App Tutorial](https://spacetimedb.com/docs/intro/tutorials/chat-app) (original template this project evolved from)
