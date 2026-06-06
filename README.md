# SpacetimeDB Hackathon

Multiplayer stock market simulator on SpacetimeDB — trade against friends and two LLM-powered AI bots (Nova & Pulse).

## Quick start (teammates)

```bash
git clone https://github.com/CaMiLoFl20/SpaceDB-Hackathon.git
cd SpaceDB-Hackathon/market-sim
npm install && cd spacetimedb && npm install && cd ..
cp .env.example .env.local
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Everyone shares the hosted database **`market-sim-69q12`** on maincloud — same market, leaderboard, and bots in real time.

Full docs: [`market-sim/README.md`](./market-sim/README.md)

## Stack

- **SpacetimeDB 2.4** — TypeScript module (server)
- **React 18 + Vite 7** — trading dashboard
- **OpenAI** — optional LLM for bot decisions and market news

## Repo layout

| Path | Description |
|------|-------------|
| [`market-sim/`](./market-sim/) | Main app (frontend + SpacetimeDB module) |

## Shared database

- **Host:** `https://maincloud.spacetimedb.com`
- **Name:** `market-sim-69q12`
- **Dashboard:** https://spacetimedb.com/market-sim-69q12

Set the OpenAI API key once via **AI Settings** in the app (stored on server, not in git).

## License

Hackathon / experiment — use and modify freely.
