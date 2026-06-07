# SpacetimeDB Hackathon

Multiplayer fund-trading game on SpacetimeDB. Players buy and sell shares of public funds while hidden LLM and scripted fund managers trade an underlying stock market.

## Quick start (teammates)

```bash
git clone https://github.com/CaMiLoFl20/SpaceDB-Hackathon.git
cd SpaceDB-Hackathon/market-sim
npm install && cd spacetimedb && npm install && cd ..
cp .env.example .env.local
npm run dev
```

Open the Vite URL printed by `npm run dev` (usually [http://localhost:5173](http://localhost:5173)).

Everyone shares the hosted database **`market-sim-69q12`** on maincloud — same funds, market, leaderboard, and manager activity in real time.

Full docs: [`market-sim/README.md`](./market-sim/README.md)

## Stack

- **SpacetimeDB 2.4** — TypeScript module (server)
- **React 18 + Vite 7** — fund trading dashboard
- **OpenAI/OpenRouter** — optional LLM for fund-manager decisions and market news

## Repo layout

| Path | Description |
|------|-------------|
| [`market-sim/`](./market-sim/) | Main app (frontend + SpacetimeDB module) |

## Shared database

- **Host:** `https://maincloud.spacetimedb.com`
- **Name:** `market-sim-69q12`
- **Dashboard:** https://spacetimedb.com/market-sim-69q12

Set the OpenAI API key once via **AI Settings** in the app (stored on server, not in git).

## Current gameplay

- Players start with **$10,000** and trade shares of public funds.
- Three hidden LLM-managed funds use conservative, moderate, and aggressive styles.
- Scripted funds provide additional non-LLM competitors/decoys.
- Fund share prices are derived from each manager's underlying portfolio NAV.
- Players see public fund names, prices, available float, market signals, their private fund holdings/trades, and the leaderboard.

## License

Hackathon / experiment — use and modify freely.
