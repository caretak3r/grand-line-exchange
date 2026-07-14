# 🏴‍☠️ Grand Line Exchange

A real-time trading dashboard for One Piece TCG sealed booster boxes — Bloomberg Terminal aesthetics, automatic price updates, GitHub Pages deployment.

> Track every English booster box (OP-01 through OP-15, EB, PRB) with live prices, 30-day momentum, technicals, buy/sell signals, and a market-wide index.

---

## ✨ Features

- **22 tracked sets** — every single English booster box, no clutter from starter decks or premium sets that aren't single boxes
- **Auto-updating prices** — GitHub Actions runs the scraper hourly and commits fresh data
- **Real RSI + 30d momentum** computed from actual price history, not heuristics
- **Live tape** of recent sales from TCGPlayer
- **Buy/sell signals** generated from momentum + 52-week range position
- **Persistent watchlist** via localStorage
- **Free hosting** on GitHub Pages — no servers, no databases, no API keys required to start

---

## 🚀 Quick Start

### One-time setup

```bash
# 1. Clone and install
git clone https://github.com/<YOU>/<REPO>.git
cd <REPO>
npm install

# 2. Run locally
npm run dev
# → http://localhost:5173
```

### Deploy to GitHub Pages

1. Push the repo to GitHub.
2. Go to **Settings → Pages** and set **Source = GitHub Actions**.
3. The `Deploy to GitHub Pages` workflow will run automatically on push to `main`.
4. Your dashboard will be live at `https://<you>.github.io/<repo>/`.

### Enable scheduled price updates

The `Update Prices` workflow runs hourly by default. To trigger it manually:

- Go to the **Actions** tab → **Update Prices** → **Run workflow**.

To run it locally:

```bash
python scripts/update-prices.py            # writes to public/data/
DRY_RUN=1 python scripts/update-prices.py  # preview without writing
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (hourly)                       │
│                                                                  │
│   scripts/update-prices.py                                       │
│      │                                                           │
│      ├─→ query TCGPlayer mp-search-api JSON endpoints per product│
│      ├─→ compute RSI, 30d Δ, signals, range positions           │
│      │                                                           │
│      ↓                                                           │
│   public/data/market.json     ← latest quote snapshot            │
│   public/data/history.json    ← last 365d + monthly spine per set│
│   public/data/transactions.json ← live tape feed                 │
│      │                                                           │
│      ↓                                                           │
│   git commit & push (workflow user)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  GitHub Pages (static site)                      │
│                                                                  │
│   Vite + React build  ──→  fetches /data/*.json on load          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key idea:** the dashboard is a pure static site that reads JSON committed by a scheduled workflow. There is no backend. The repo itself is the database.

**Analytics ownership:** every value persisted in `public/data/market.json`
(price, RSI, signals, 52-week ranges, volumes) is computed once by
`scripts/update-prices.py` at ingest. Every value derived in the browser for
display (moving averages, the Grand Line Index, market-pulse aggregates) is
computed in `src/lib/analytics.js`. Nothing computes the same number in both
places — if you need a value in a new place, import it from its owner.

---

## 📂 Project Structure

```
.
├── .github/workflows/
│   ├── deploy.yml          # Builds + deploys to GitHub Pages
│   └── update-prices.yml   # Cron: scrapes prices hourly
├── public/data/
│   ├── market.json         # Latest quote snapshot (overwritten)
│   ├── history.json        # last 365d + monthly spine per set; older rows in history-archive.json
│   ├── history-archive.json # rows aged out of the 365d window (not fetched by the app)
│   └── transactions.json   # Live tape, last 100 events (rolling)
├── scripts/
│   └── update-prices.py    # The scraper. Runs in Actions or locally.
├── src/
│   ├── Dashboard.jsx       # Main React component
│   ├── data/sets.json      # Set metadata (codes, MSRPs, TCG product IDs)
│   ├── lib/analytics.js    # Browser-side derived analytics (MAs, index, aggregates)
│   └── main.jsx            # Entry point
├── index.html
├── package.json
└── vite.config.js
```

---

## 🛠️ Customization

### Adjust the schedule

Edit `.github/workflows/update-prices.yml`:

```yaml
on:
  schedule:
    - cron: '15 * * * *'     # hourly
    # - cron: '15 */6 * * *' # every six hours
    # - cron: '0 9 * * *'    # daily at 09:00 UTC
```

GitHub Actions has a 5-minute minimum schedule and frequent cron jobs may be delayed during peak load.

### Add a new set

1. Append a new entry to `src/data/sets.json` with the TCGPlayer product ID (the number in the product URL). Entries must be valid JSON: double-quoted keys/strings, no trailing commas.
2. Run `python scripts/update-prices.py` locally once to populate the new set.
3. Commit and push.

### Tune the buy/sell signal logic

Edit `compute_signal()` in `scripts/update-prices.py`. Defaults:

| Condition                             | Signal       |
|---------------------------------------|--------------|
| 30d change > 7% AND in lower 60% of range | `STRONG BUY` |
| 30d change > 3%                       | `BUY`        |
| 30d change < -4%                      | `WATCH`      |
| Price in top 15% of 52w range         | `WATCH`      |
| Otherwise                             | `HOLD`       |

---

## ⚠️ Important Notes

- **Not financial advice.** Sealed TCG product is illiquid; prices can move sharply on reprint announcements.
- **TCGPlayer scraping is best-effort.** If their HTML structure changes, the scraper may need an update. The dashboard is designed to gracefully fall back to cached prices if a fetch fails.
- **Always verify the live quote** on TCGPlayer/eBay before placing a trade. Each set has a "View on TCGPlayer ↗" link in the detail panel.
- **GitHub Actions free tier** gives 2,000 minutes/month for private repos and unlimited for public repos. The scraper runs in ~1 minute per execution, so 24 runs/day = ~720 minutes/month (public repos get unlimited Actions minutes).

---

## 🧰 Tech Stack

- **React 19** + **Vite** — fast dev/build
- **Recharts** — price + volume charting
- **Lucide** — icons
- **Python 3.11** — scraper (zero dependencies, stdlib only)
- **GitHub Actions** — orchestration
- **GitHub Pages** — hosting

No external paid APIs required to start. Everything runs on free tiers.

---

## 📜 License

MIT. Use it, fork it, ship it.
