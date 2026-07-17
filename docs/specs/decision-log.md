# Decision Log

Why this repo looks the way it does. Each entry states the decision, the
constraint it resolves, and what a violation looks like — sourced from
`CLAUDE.md` (the project's own agent-facing contract) and cross-checked
against the actual workflow/script files.

## 1. No backend

**Decision:** The dashboard is a static site with no server, no database,
and no API keys required to run it.

**Why:** GitHub Pages serves static files for free, forever, with no ops
burden. A backend would need hosting, uptime monitoring, and a place to put
secrets — none of which this project needs to show a price chart.

**Mechanism:** `deploy.yml` builds `dist/` with Vite and hands it to
`actions/deploy-pages`. There is no server process anywhere in
`.github/workflows/` or `package.json` scripts.

**What a violation looks like:** adding an Express/Flask/Next-API-route
server, a hosted database, or any dependency that requires a paid tier to
function. `CLAUDE.md` calls this out directly: *"Any change that introduces
a backend, a database, or a paid dependency is fighting the design — don't."*

## 2. The repo is the database

**Decision:** `public/data/*.json` — written by the hourly bot commit — *is*
the persistence layer. There is no separate data store.

**Why:** Git already gives free versioning, free hosting (via Pages), and a
free audit trail (every price point is a commit). Reusing it means zero
additional infrastructure.

**Mechanism:** `update-prices.yml` runs the scraper, then does a plain
`git add` + `git commit` + `git push` of the four JSON files
(`update-prices.yml`'s final step) — the exact same mechanism a human would
use to save a file, just on a schedule.

**Tradeoff accepted:** hourly bot commits pollute `git log`. This is
explicitly tolerated, not treated as a bug — `CLAUDE.md` instructs changelog
tooling to filter `📊 price update …` commits out rather than trying to stop
them from happening (see `release.yml` / `generate-changelog.sh`).

## 3. Stdlib-only scraper

**Decision:** `scripts/update-prices.py` imports nothing outside the Python
standard library (`json`, `os`, `subprocess`, `sys`, `time`, `random`,
`datetime`, `pathlib`, `urllib.request`, `urllib.error`).

**Why:** two reasons, both visible in `CLAUDE.md`:
1. **Zero install step** on CI runners — no `pip install` before the scraper
   can run, so a broken or yanked PyPI package can never break the hourly
   job.
2. **Zero supply-chain surface** for a workflow that holds `contents: write`
   — `update-prices.yml` grants the job permission to push commits directly
   to the repo, so any dependency in that code path is a potential commit
   forger. Stdlib-only means the attack surface is just CPython itself.

**Mechanism check:** `curl_json()` shells out to the system `curl` binary
via `subprocess` rather than adding `requests` — the fallback path for
`fetch_tcgplayer_latest_sales()` when `urllib` fails. This is the one place
the script reaches outside Python itself, and it reaches for a binary that's
preinstalled on every GitHub-hosted runner, not a pip package.

**What a violation looks like:** any `import requests`, `import httpx`, or
similar in `scripts/update-prices.py`, or a `requirements.txt` the scraper
depends on at runtime.

## 4. UTC-explicit everywhere

**Decision:** every timestamp in `history.json` carries explicit UTC
(`...Z` or a `+00:00` offset), and day-bucketing (`daily_closes()`,
`prune_history()`, and the browser's `buildChartData()`/`buildIndexData()`)
operates on UTC calendar days on both sides.

**Why:** `CLAUDE.md` flags this as *"a real bug class (plans 002/004) —
treat any naive-datetime or local-time code path as a defect."* A scraper
running on a UTC CI runner and a browser running in an arbitrary local
timezone will bucket the same sale into different days if either side uses
local time — corrupting RSI, moving averages, and the 30-day window
consistently, not just cosmetically.

**Mechanism:** `parse_datetime()` (`update-prices.py:276-295`) always
returns a UTC-aware `datetime`, converting naive input by assuming UTC
rather than the runner's local zone. `analytics.js::buildChartData()`
buckets with `new Date(row.ts).toISOString().slice(0, 10)` — `toISOString()`
is UTC by construction in JS, so the two sides can't drift apart by
implementation accident. Both test suites additionally pin `TZ=UTC`
(`package.json`'s test script; `tests/conftest.py`) so a developer's local
timezone can't silently mask a regression.

## 5. Resilience over completeness (per-set and per-run)

**Decision:** a single set's failed fetch doesn't fail the run, and a fully
failed run doesn't touch existing data.

**Why:** TCGPlayer is an undocumented third-party API being scraped, not a
partner integration — it can rate-limit, change response shape, or 500 on
any given request. The dashboard's job is to show the best data it has, not
to go blank because one of 22 sets had a bad minute.

**Mechanism:** see `docs/specs/scrape-cycle-sequence.md` invariants 2 and 6
— per-set, `has_live_price` gates a fallback to the cached price
(`update-prices.py:541-553`); per-run, `main()` raises before any
`.write_text()` call if zero live prices were fetched and there's no cached
positive quote to lean on, or if any tracked set ends up with no quote at
all (`update-prices.py:621-632`).

## 6. Analytics ownership rule

**Decision:** every persisted value (price, RSI, signals, ranges, volumes)
is computed exactly once, at ingest, in Python. Every display-only
derivation (moving averages, the Grand Line Index, market-pulse aggregates)
is computed exactly once, in the browser, in `src/lib/analytics.js`.

**Why:** without a single owner per value, two implementations of "30-day
change" or "RSI" can silently drift — one gets a bug fix, the other doesn't,
and the dashboard shows two different numbers for the same concept depending
on which code path rendered it. `CLAUDE.md` states this is "load-bearing —
violations get reverted."

**Mechanism:** both sides are pinned by hand-derived tests against a shared
fixture (daily closes `[95, 110, 84]` → MA `96.33`), so a semantics change on
either side that isn't mirrored shows up as a test failure rather than a
silent display bug. See `docs/specs/data-flow-ownership.md` for the full
value-to-owner mapping, including the one deliberate exception (the
daily-closes bucketing *algorithm* exists on both sides because RSI needs it
at ingest and the moving averages need it at render — but no *value* crosses
the boundary in both directions).
