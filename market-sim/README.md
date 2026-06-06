# Market Sim

A multiplayer stock market simulator built on [SpacetimeDB](https://spacetimedb.com). Trade top US tech stocks, compete on a public leaderboard, and watch two AI traders (Nova & Pulse) battle each other and human players.

## Features

- **Live trading** — Buy and sell NVDA, AAPL, GOOGL, MSFT, and AMZN; prices move with order size
- **$10,000 starting capital** — Fresh account on first connect
- **Private trades** — Your history is only visible to you
- **Public leaderboard** — Ranked by portfolio value (cash + holdings)
- **AI trader bots** — Nova AI (aggressive) and Pulse AI (conservative) trade every 30s
- **LLM-powered bots** — When OpenAI is configured, bots read the market, remember past moves, and decide buy/sell/hold
- **AI trader log** — Live console showing bot trades and reasoning
- **Market news** — Generate AI headlines via OpenAI/OpenRouter (optional)
- **Portfolio chart** — 24h portfolio history

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [SpacetimeDB CLI](https://spacetimedb.com/install) 2.4+
- (Optional) OpenAI or OpenRouter API key for LLM news and AI trader decisions

## Working together (teammate setup)

Everyone connects to the **same hosted database** so you see the same market, leaderboard, and bots.

```bash
git clone https://github.com/CaMiLoFl20/SpaceDB-Hackathon.git
cd SpaceDB-Hackathon/market-sim

npm install
cd spacetimedb && npm install && cd ..

cp .env.example .env.local   # points at shared maincloud DB
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), pick a nickname, and trade.

### Shared database

| Setting | Value |
|---------|-------|
| Host | `https://maincloud.spacetimedb.com` |
| Database | `market-sim-69q12` |
| Dashboard | https://spacetimedb.com/market-sim-69q12 |

### API key (one per team)

The OpenAI key lives in the **server** (`global_ai_config` table), not in git.

1. Open the app → **AI Settings**
2. Paste your OpenAI key and save
3. Confirm **OpenAI: connected** in the header

Only one global key is needed for the whole team on the shared DB. Do not commit keys to the repo.

### Publishing backend changes

When you change `spacetimedb/src/`, publish so everyone gets the same logic:

```bash
spacetime publish --module-path spacetimedb --server maincloud -y market-sim-69q12
```

Then regenerate client bindings if schema changed:

```bash
npm run spacetime:generate
```

**Before publishing:** run `cd spacetimedb && npm run build` locally to catch errors.

### Git workflow

- `main` — stable shared version
- Use feature branches and PRs for larger changes
- Never commit `.env.local` (gitignored)

## Quick start (local SpacetimeDB)

Run your own isolated database instead of maincloud:

```bash
npm install
cd spacetimedb && npm install && cd ..
spacetime dev
```

Open [http://localhost:5173](http://localhost:5173).

## How the market works

### Human trades

- Buys and sells move price via basis-point impact
- Your trades are private (`my_trades` view)

### AI traders (Nova & Pulse)

- Trade every **30 seconds** via scheduled `ai_trader_llm_tick` procedure
- With OpenAI configured: LLM reads leaderboard, holdings, cash, and past reasoning
- Without OpenAI (or on failure): rule-based fallback with distinct personalities
- Nova: momentum, larger sizes · Pulse: dips, smaller sizes, profit-taking

### Institutional auto-trading

Disabled by default (`AUTOMATIC_MARKET_MOVEMENT = false`). Prices move from **human + bot trades**, not background institutions.

## Project structure

```
market-sim/
├── spacetimedb/src/
│   ├── index.ts          # Tables, reducers, procedures, bots, market logic
│   ├── ai_trader_llm.ts  # LLM prompt + response parsing for bots
│   └── llm.ts            # OpenAI / OpenRouter HTTP helpers
├── src/
│   ├── App.tsx           # React dashboard
│   ├── main.tsx          # SpacetimeDB connection
│   └── module_bindings/  # Auto-generated — run spacetime:generate after schema changes
├── .env.example          # Copy to .env.local (not committed)
└── spacetime.json        # CLI database config
```

## Server API (module)

### Reducers

| Reducer | Description |
|---------|-------------|
| `buy_stock` / `sell_stock` | Execute trades |
| `set_name` | Leaderboard nickname |
| `set_global_ai_config` | Shared LLM key for news + bots |
| `seed_market` | Idempotent stock seeding |

### Procedures

| Procedure | Description |
|-----------|-------------|
| `generate_demo_news` | AI or fallback market news |
| `get_global_ai_config_status` | Check if AI is configured |
| `test_global_ai_connection` | Ping OpenAI/OpenRouter |
| `ai_trader_llm_tick` | Scheduled bot trading (internal) |

### Views

| View | Description |
|------|-------------|
| `my_account` / `my_holdings` / `my_trades` | Your private data |
| `leaderboard` | Public rankings |
| `ai_trader_log` | Bot trade console (public) |
| `ai_trader_minds` | Bot reasoning + rank (public) |
| `market_stocks` / `recent_market_news` | Stocks and news feed |

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run spacetime:generate` | Regenerate TypeScript bindings |
| `npm run spacetime:publish` | Publish module to maincloud |

## Logs & debugging

```bash
# AI trader decisions
spacetime logs market-sim-69q12 -f | grep ai_trader_llm

# News generation
spacetime logs market-sim-69q12 -f | grep generate_demo_news

# OpenAI connection tests
spacetime logs market-sim-69q12 -f | grep ai_connection
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bots not trading | Check logs for `ai_trader_llm`; ensure OpenAI connected or fallback runs |
| `nonexistent procedure` | Publish latest module + `npm run spacetime:generate` |
| Schema mismatch in browser | `npm run spacetime:generate` and hard-refresh |
| `insufficient_quota` | OpenAI billing issue — add credits or use OpenRouter |
| Empty stocks | Reconnect; `seed_market` runs on connect |
| Lost API key after publish | Key is in DB — publish does not wipe `global_ai_config` |

## Environment variables

| Variable | Example | Description |
|----------|---------|-------------|
| `VITE_SPACETIMEDB_HOST` | `https://maincloud.spacetimedb.com` | WebSocket host |
| `VITE_SPACETIMEDB_DB_NAME` | `market-sim-69q12` | Database name |

See `.env.example` for a copy-paste template.

## Further reading

- [SpacetimeDB TypeScript SDK](https://spacetimedb.com/docs/intro/core-concepts/clients/typescript-reference)
- [SpacetimeDB CLI install](https://spacetimedb.com/install)
