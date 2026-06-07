# SpacetimeDB Hackathon — Fund Floor

A real-time multiplayer fund-trading game on SpacetimeDB. Players buy and sell shares of anonymous public funds while hidden AI and scripted managers trade an underlying stock market. Your goal: read the signals, pick the winners, and grow your portfolio.

**Live demo:** https://market-sim-wine.vercel.app

## Quick start

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

## How to play

1. **Pick a nickname** — you start with $10,000 in cash.
2. **Study the fund market** — five anonymous funds trade the underlying stock market. Their public names rotate each day. Some are managed by AI, some by algorithms — you don't know which is which.
3. **Buy and sell fund shares** — select a fund, enter a share count, and trade. Fund prices move based on the manager's underlying portfolio performance.
4. **Make daily predictions** — before 10:30 AM game time each day, predict which fund will be the day's best performer and which will be the worst. Correct picks earn cash bonuses.
5. **Watch the signals** — the manager activity tape, market news, and price movements all give clues about what each fund is doing under the hood.
6. **Compete on the leaderboard** — total portfolio value (cash + fund holdings) determines your rank. Can you beat the AI?

### Game day cycle

Each trading day is compressed: 9:30 AM to 4:00 PM game time runs in about 3.25 real-time minutes.

| Phase | Duration | What happens |
|-------|----------|-------------|
| **Open** | ~2.75 min | Trading and predictions are live |
| **Closing warning** | ~30s | Last chance to trade |
| **Frozen** | ~10s | Day is settling — no trades |
| **Results** | ~15s | Day summary: best/worst fund, top player, prediction outcomes |

Then the next day opens automatically.

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

## License

Hackathon / experiment — use and modify freely.
