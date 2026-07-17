# Architecture Specs

Agent- and human-facing specs for Grand Line Exchange, derived from reading
`scripts/update-prices.py`, `src/lib/analytics.js`, `src/data/sets.json`,
and the current `public/data/*.json` contents — not invented. All Mermaid
diagrams below render natively on GitHub.

- [`architecture-component-diagram.md`](architecture-component-diagram.md) — Action → scraper → JSON → Pages → browser, component by component.
- [`data-flow-ownership.md`](data-flow-ownership.md) — the ownership-rule boundary: what's computed once at ingest vs. once in the browser, field by field.
- [`scrape-cycle-sequence.md`](scrape-cycle-sequence.md) — one scrape cycle: the fetch/fallback chain, per-set failure handling, history dedup, and the 365-day retention/archive split.
- [`json-contracts.md`](json-contracts.md) — field-level contracts for `market.json`, `history.json`, `transactions.json`, and `sets.json`.
- [`decision-log.md`](decision-log.md) — why no backend, why stdlib-only, why the repo is the database, why timestamps are UTC-explicit, why analytics ownership is split the way it is.
