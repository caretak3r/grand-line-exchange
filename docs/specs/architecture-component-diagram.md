# Component Diagram

Grand Line Exchange has no backend and no database. The two GitHub Actions
workflows and the static Pages build are the entire system. This diagram
traces the components from `scripts/update-prices.py` (source of truth for
every persisted value) through to the browser.

```mermaid
flowchart TD
    subgraph cron["GitHub Actions: Update Prices (update-prices.yml)"]
        direction TB
        A["cron trigger\n15 * * * * (hourly)\nor workflow_dispatch"] --> B["scripts/update-prices.py\n(Python 3.11, stdlib only)"]
        B -->|"per tracked set"| C["TCGPlayer\nmp-search-api / mpapi"]
        C --> B
        B --> D["public/data/market.json"]
        B --> E["public/data/history.json"]
        B --> F["public/data/history-archive.json"]
        B --> G["public/data/transactions.json"]
        D & E & F & G --> H["git commit + push\n(grand-line-bot)"]
    end

    subgraph pages["GitHub Actions: Deploy to GitHub Pages (deploy.yml)"]
        direction TB
        H -->|"triggers via workflow_run\non push to main"| I["npm ci && npm run build\n(Vite + React static build)"]
        I --> J["actions/upload-pages-artifact\n(dist/)"]
        J --> K["actions/deploy-pages"]
    end

    subgraph browser["GitHub Pages (static site)"]
        direction TB
        K --> L["Vite + React bundle"]
        L -->|"fetch on load"| D
        L -->|"fetch on load"| E
        L -->|"fetch on load"| G
        L --> M["src/lib/analytics.js\n(browser-side derived math)"]
        M --> N["Dashboard.jsx\n+ src/components/*"]
    end

    style D fill:#1a1a2e,stroke:#e94560,color:#fff
    style E fill:#1a1a2e,stroke:#e94560,color:#fff
    style F fill:#1a1a2e,stroke:#e94560,color:#fff
    style G fill:#1a1a2e,stroke:#e94560,color:#fff
```

## Reading the diagram

- **The repo is the database.** `public/data/*.json` is written only by
  `scripts/update-prices.py`, committed by the bot user `grand-line-bot`, and
  read only by the browser bundle at load time. No other writer, no reader
  outside the static site.
- **Two independent workflows, loosely coupled.** `update-prices.yml` doesn't
  know deploy exists; `deploy.yml` reacts to `workflow_run` completion of
  `Update Prices` (plus direct pushes to source paths) — see
  `.github/workflows/deploy.yml:6-13`.
- **`release.yml` is out of this loop.** It fires on `v*.*.*` tags only, reads
  git history, and writes a GitHub Release — it never touches `public/data/`
  or the Pages deploy. See `docs/specs/decision-log.md`.
- **A third workflow, `ci.yml`**, runs `npm test` + `pytest -q tests/` +
  `npm run build` on every push/PR to `main`; it isn't part of the runtime
  data flow, so it's omitted above.
