# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## What This Is

**Grand Line Exchange** — a Bloomberg-Terminal-styled trading dashboard for One Piece TCG *sealed booster boxes* (22 English sets: OP-01…OP-15, EB, PRB). It tracks live prices, 30-day momentum, RSI, buy/sell signals, a live sales tape, and an equal-weight market index. The point is treating collectible sealed product like a tradeable asset class, with real computed technicals instead of vibes.

**The one architectural idea everything follows from: there is no backend. The repo is the database.** A GitHub Action runs the scraper hourly, commits fresh JSON to `public/data/`, and GitHub Pages serves a static Vite/React build that fetches those files. No servers, no API keys required, free to run forever. Any change that introduces a backend, a database, or a paid dependency is fighting the design — don't.

## Architecture

```
GitHub Actions (hourly, update-prices.yml)
  └─ scripts/update-prices.py  (Python, stdlib ONLY)
       ├─ fetches TCGPlayer mp-search-api per product
       ├─ computes RSI, 30d Δ, signals, 52w range positions
       └─ writes public/data/{market,history,transactions}.json → git commit
                     ↓
GitHub Pages (deploy.yml)
  └─ Vite + React static build → fetches /data/*.json at load
       └─ src/lib/analytics.js computes display-side derivations
```

README.md has the full diagram and product docs; this file is the agent-facing layer.

### The ownership rule (load-bearing — violations get reverted)

Every value **persisted** in `public/data/market.json` (price, RSI, signals, 52-week ranges, volumes) is computed once by `scripts/update-prices.py` at ingest. Every value **derived in the browser** for display (moving averages, the Grand Line Index, market-pulse aggregates) is computed in `src/lib/analytics.js`. Nothing computes the same number in both places. Need a value somewhere new? Import it from its owner. Both sides are pinned by tests against a shared fixture (daily closes `[95, 110, 84]` → MA 96.33) — if you change semantics on one side, the other side's suite will tell you.

## Design Philosophy

- **Stdlib-only scraper.** `update-prices.py` imports nothing outside the Python standard library. This is deliberate: zero install step on CI runners, zero supply-chain surface for a workflow with `contents: write`. Keep it that way.
- **No new runtime deps without approval.** The JS side is React + recharts + lucide, full stop. `devDependencies` additions (test tooling) are negotiable; `dependencies` are not.
- **Resilient by design.** A failed fetch for one set keeps the previous value; a failed run leaves existing JSON untouched. Never let a partial failure write partial data.
- **UTC everywhere.** All history timestamps are UTC-explicit (`...Z` / offset labels). Day-bucketing happens on UTC calendar days on both sides. This was a real bug class (plans 002/004) — treat any naive-datetime or local-time code path as a defect.
- **History is bounded.** `history.json` keeps 365 days + a monthly spine (last positive-price row per old month + release anchors); older rows move to `history-archive.json`. `prune_history()` is pure; the IO lives in `main()`.
- **Truthful data over pretty data.** Cached quotes carry a real `lastUpdated` and a stale flag; `money()` returns `None` for malformed input rather than coercing to 0. Don't "fix" honest gaps by fabricating values.

## Build & Test

```bash
npm run dev              # local dashboard at :5173
npm test                 # vitest, 12 tests (script pins TZ=UTC — required)
pytest -q tests/         # 57 tests. Use Homebrew pytest or `uv run --with pytest`
npm run build            # must exit 0 with NO >500kB chunk warning
python scripts/update-prices.py           # full scrape (writes public/data/)
DRY_RUN=1 python scripts/update-prices.py # preview, no writes
```

**A change is not done until all three gates pass:** `npm test` (12), `pytest -q tests/` (57), `npm run build` (clean). CI (`ci.yml`) runs exactly these on push/PR to main.

### Environment gotchas (hard-won, don't rediscover)

- **TZ matters.** Both suites pin TZ=UTC (`package.json` test script; `tests/conftest.py`). Without it, UTC day-bucketing assertions pass or fail by the runner's timezone.
- **No `pip install` locally.** Homebrew Python is PEP-668 externally-managed. Use `/opt/homebrew/bin/pytest` or `uv run --with pytest pytest -q tests/`. (CI runners are not locked — `pip install pytest` is fine *inside* ci.yml only.)
- **The scraper filename has a hyphen.** Import it in tests via `importlib.util.spec_from_file_location` (see `tests/test_update_prices.py`). Module import is side-effect-free; `main()` only runs under `__main__`.
- **Bare `pytest` crawls `node_modules/`.** Always `pytest -q tests/`.
- **vite 8 is rolldown-based.** Chunk splitting lives in `vite.config.js` under `rolldownOptions.output.codeSplitting`, not rollup's `manualChunks`.

## Project Structure

```
scripts/update-prices.py   the ingest bot — owns every persisted value
src/data/sets.json         single source of truth for tracked sets (strict
                           contract: load_sets() hard-fails on malformed entries)
public/data/*.json         the "database" — written only by the scraper/Action
src/Dashboard.jsx          state + composition only (~170 lines)
src/components/            presentational pieces (Ticker, OrderBook, charts…)
src/lib/analytics.js       ALL browser-side math (+ analytics.test.js beside it)
tests/                     pytest suite for the scraper's pure functions
plans/                     completed uplift handoff plans (historical record)
.github/workflows/         update-prices (hourly bot) · ci · deploy
```

## Conventions & What to Strive For

- **Conventional Commits** (`feat|fix|refactor|perf|test|ci|chore|docs`). Note: hourly bot commits (`📊 price update …`) pollute history — exclude them from any changelog tooling.
- **Every persisted value gets a hand-derived test.** Expected values in tests are derived by hand (arithmetic shown in comments), never captured from running the code. Characterization tests are how bugs get enshrined.
- **Pure functions stay pure.** The scraper separates computation from IO (`prune_history` returns `(kept, archived)`; `main()` writes). Keep new logic testable the same way.
- **Components are presentational.** State lives in `Dashboard.jsx`; math lives in `src/lib/analytics.js`; `src/components/*` render props. Don't duplicate state downward.
- **Strive for:** CI green on every commit · automated releases (tags + changelog + GitHub Releases) · a Nextra docs site with architecture diagrams and JSON contract specs · specs/diagrams for every structural decision. These are tracked as beads under the `project maturity` epic (`bd show op-dashboard-c80`) — check there before starting docs/release work.
