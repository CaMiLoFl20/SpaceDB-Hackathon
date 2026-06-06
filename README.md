# SpacetimeDB Hackathon

A collection of SpacetimeDB experiments built for the hackathon. The main project is **Market Sim** — a multiplayer stock market simulator with AI institutions and LLM-generated market news.

## Projects

| Project | Description |
|---------|-------------|
| [`market-sim/`](./market-sim/) | Real-time stock trading game on SpacetimeDB with institutional market movers and optional OpenAI/OpenRouter news generation |

## Market Sim (quick start)

```bash
cd market-sim
npm install
cd spacetimedb && npm install && cd ..

# Local development (starts SpacetimeDB, publishes module, generates bindings, runs Vite)
spacetime dev

# Or run against the hosted database on maincloud
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), pick a nickname, and start trading.

See [`market-sim/README.md`](./market-sim/README.md) for full setup, architecture, and deployment instructions.

## Stack

- **SpacetimeDB 2.4** — server-side module (TypeScript → WASM)
- **React 18 + Vite 7** — client dashboard
- **OpenAI / OpenRouter** — optional LLM for demo news headlines

## Hosted database

The demo is published to SpacetimeDB maincloud as `market-sim-69q12`. Configure the client with:

```bash
VITE_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DB_NAME=market-sim-69q12
```

## License

Hackathon / experiment project — use and modify freely.
