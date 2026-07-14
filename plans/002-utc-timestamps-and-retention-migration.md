# Plan 002: Make history timestamps UTC-explicit and enforce the documented 365-day retention (one migration commit)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 071b8bb..HEAD -- scripts/update-prices.py src/Dashboard.jsx .github/workflows/update-prices.yml README.md`
> Expected drift: plan 001's changes (the `load_sets()` JSON loader in the
> scraper, the `sets.json` import in `Dashboard.jsx`, the workflow validation
> line, two README lines). Any drift in the regions this plan quotes below is
> a STOP condition. `public/data/*.json` changes hourly via the scheduled bot
> — that churn is expected, not drift; the counts in this plan's
> verifications are therefore *structural* (format classes, per-set counts),
> never absolute row numbers.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (rewrites persisted data — but reversibly, in one commit, with a validating migration script)
- **Depends on**: none required; plans/001-shared-sets-json-contract.md recommended first
- **Category**: bug + migration
- **Planned at**: commit `071b8bb`, 2026-07-13

## Why this matters

Two persisted-data defects share one file, so they must be fixed in one migration commit. First, timestamps: the scraper writes zone-less minute stamps like `2026-07-13 16:59` from a UTC clock, and its own parser reads them back as UTC — but JavaScript's `new Date('2026-07-13T16:59')` parses zone-less date-times as **local** time (while parsing date-only strings like `2022-12-02` as UTC). Every browser therefore renders every chart point shifted by the viewer's UTC offset, inconsistently between row types. Appending `Z` fixes every browser at once without changing the Python interpretation. Second, retention: the README promises "rolling 365 days" of history, but `merge_history_points` keeps every row forever; `history.json` is already ~1.4 MB / 9,000+ rows and is re-downloaded on every page load with a cache-defeating `?t=${Date.now()}` query. This plan implements the promised retention (old rows move to a non-fetched archive file, with a monthly "spine" kept for all-time charts), fixes browser caching, and corrects the README's several stale claims.

## Current state

All facts below were verified against the live repo on 2026-07-13 at commit `071b8bb`.

**Data formats** (verified by parsing the actual files):

- `public/data/history.json` — dict of set code → row list. Exactly two date formats exist: 22 date-only rows (`2022-12-02`, one release anchor per set, `price: null`) and 9,036 rows in `YYYY-MM-DD HH:MM` format (sources `tcgplayer current market` and `tcgplayer latest sale`). No third format exists. Oldest priced row: 2026-03-09 — so as of this writing **no priced row is older than 365 days** and the initial archive will be empty; the retention code becomes active as data ages.
- `public/data/transactions.json` — 100 rows; every `timestamp` is already offset-explicit ISO (e.g. `2026-07-13T16:30:01.19+00:00`, raw TCGPlayer `orderDate`), and each row's `id` embeds that string (e.g. `OP-13-sold-2026-07-13T16:30:01.19+00:00-1-41399`). **transactions.json needs NO migration** — rewriting timestamps would corrupt the dedup ids.

**Scraper** (`scripts/update-prices.py`):

- Line 514 mints the zone-less label used for market snapshot rows:
  ```python
  today = now.strftime('%Y-%m-%d %H:%M')
  ```
- Lines 372-387, `sales_history_points`, mints the zone-less label for sale rows (note it actively strips the `T` from the ISO `orderDate`):
  ```python
  def sales_history_points(sales):
      points = []
      for sale in sales or []:
          order_date = sale.get('orderDate') or ''
          label = order_date[:16].replace('T', ' ') if len(order_date) >= 16 else sale_date(sale)
  ```
- Lines 300-319, `parse_datetime`, already handles a trailing `Z` (`text[:-1] + '+00:00'`) and treats naive stamps as UTC — the new format needs no parser change.
- Lines 332-337, `history_row_key`, dedupes market/release rows by `date[:10]` — still the calendar date under the new `YYYY-MM-DDTHH:MMZ` format, so dedup is unaffected.
- Lines 340-347, `merge_history_points`, merges with **no retention boundary** — every prior row is kept forever.
- Lines 499-501 load the three data files; lines 641-645 write them:
  ```python
  DATA_DIR.mkdir(parents=True, exist_ok=True)
  MARKET.write_text(json.dumps(out_market, indent=2) + '\n')
  HISTORY.write_text(json.dumps(history, indent=2) + '\n')
  TXNS.write_text(json.dumps(txns, indent=2) + '\n')
  ```
- Lines 637-639: `if DRY_RUN: ... return` sits before the writes, so `DRY_RUN=1` runs are filesystem-safe (they do hit live TCGPlayer endpoints).
- Line 130-134, `money()`, currently returns `0.0` for malformed input (plan 003 changes this later — the retention code below is written to work under both behaviors).

**Frontend** (`src/Dashboard.jsx`):

- Lines 26-29, `parseChartTime` — the browser parser this plan fixes the data for (no change needed here; `replace(' ', 'T')` becomes a harmless no-op after migration):
  ```js
  const parseChartTime = (value) => {
    const ts = new Date(String(value || '').replace(' ', 'T')).getTime();
    return Number.isFinite(ts) ? ts : null;
  };
  ```
- Lines 64-70, the cache-defeating fetches:
  ```js
  const base = import.meta.env.BASE_URL;
  const [m, h, x] = await Promise.all([
    fetch(`${base}data/market.json?t=${Date.now()}`).then(r => r.json()),
    fetch(`${base}data/history.json?t=${Date.now()}`).then(r => r.json()),
    fetch(`${base}data/transactions.json?t=${Date.now()}`).then(r => r.json()),
  ]);
  ```

**Workflow** (`.github/workflows/update-prices.yml`):

- Line 6: the schedule is hourly — `- cron: '15 * * * *'` (the README claims "every 6 hours" in four places; corrected in Step 7).
- Line 83, the commit step stages only three files:
  ```
  git add public/data/market.json public/data/history.json public/data/transactions.json
  ```

**Repo constraints**: Python scraper is stdlib-only by design (`README.md:173`). No test/lint/typecheck scripts exist (`package.json` scripts: `dev`, `build`, `preview` only).

**JS date-parsing facts the fix relies on** (per ECMAScript spec, all evergreen browsers): `YYYY-MM-DDTHH:MMZ` (no seconds, trailing Z) is a valid Date-Time string parsed as UTC; `YYYY-MM-DDTHH:MM` without offset is parsed as local; `YYYY-MM-DD` alone is parsed as UTC.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install frontend deps | `npm ci` | exit 0 |
| Build frontend | `npm run build` | exit 0 |
| Scraper dry run (network) | `DRY_RUN=1 python3 scripts/update-prices.py` | exit 0, no file writes |
| Run migration | `python3 scripts/migrate-history-20260713.py` | prints `Migrated N rows, left M unchanged...`, exit 0 |
| Scope check | `git status --porcelain` | only in-scope files |

## Scope

**In scope** (the only files you should modify):
- `scripts/update-prices.py` (timestamp format, retention, archive read/write)
- `scripts/migrate-history-20260713.py` (create — one-time migration, kept in repo for audit)
- `public/data/history.json` (rewritten by the migration script only — never hand-edit)
- `public/data/history-archive.json` (created by the migration script)
- `src/Dashboard.jsx` (the fetch block in `useMarketData` only)
- `.github/workflows/update-prices.yml` (the `git add` line only)
- `README.md` (the specific corrections in Step 7)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `public/data/transactions.json` and `public/data/market.json` — no migration needed (verified above); the bot owns them.
- Analytics semantics (RSI/MA windows) — plan 004 owns those; this plan changes only how time is *written*, not how it is *aggregated*.
- `parseChartTime`, chart components, `history_row_key`, `parse_datetime` — verified to already handle the new format.
- `deploy.yml`, `vite.config.js`, `src/data/sets.json`.

## Git workflow

- Branch: `advisor/002-utc-timestamps-and-retention`
- **All of Steps 1-7 plus the migration output must land in ONE commit** (e.g. `fix: UTC-explicit history timestamps + 365d retention with archive`). Rationale: once the scraper writes the new format, the old and new labels for the same sale would no longer dedup against each other; and a migrated file without the scraper change would regress on the next bot run. One commit keeps repo history consistent at every checkout.
- Do NOT push or open a PR unless the operator instructed it.
- Coordination: the hourly bot commits to `main` at :15 past each hour. Rebase your branch onto the latest `main` and re-run the migration script (it is idempotent) immediately before finishing, so no bot-written space-format rows are left behind.

## Steps

### Step 1: Record the pre-migration baseline

```bash
python3 -c "
import json, re
h = json.load(open('public/data/history.json'))
date_only = space = utc = other = 0
for rows in h.values():
    for r in rows:
        d = str(r.get('date'))
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', d): date_only += 1
        elif re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}', d): space += 1
        elif re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z', d): utc += 1
        else: other += 1
print('sets:', len(h), 'date_only:', date_only, 'space:', space, 'utc:', utc, 'other:', other)
"
```
→ `other: 0` and `utc: 0`; `date_only` equals the number of sets (22 at planning time). Save the printed line — Step 4's verification compares against it. **If `other` is nonzero, STOP** — a date format exists that this plan has not accounted for.

### Step 2: Change the scraper to write UTC-explicit timestamps

In `scripts/update-prices.py`:

1. Line 514: change to
   ```python
   today = now.strftime('%Y-%m-%dT%H:%MZ')
   ```
   (`now` is `datetime.now(timezone.utc)` — line 495 — so the `Z` is truthful.)

2. In `sales_history_points` (lines 372-387), replace the two label lines
   ```python
   order_date = sale.get('orderDate') or ''
   label = order_date[:16].replace('T', ' ') if len(order_date) >= 16 else sale_date(sale)
   ```
   with
   ```python
   parsed = parse_datetime(sale.get('orderDate'))
   label = parsed.strftime('%Y-%m-%dT%H:%MZ') if parsed else sale_date(sale)
   ```
   (`parse_datetime` normalizes the offset-explicit `orderDate` to UTC first, so the minute label is guaranteed UTC. The `sale_date` fallback yields date-only, which both runtimes already parse as UTC.)

**Verify** (no network needed):
```bash
python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('up', 'scripts/update-prices.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pts = m.sales_history_points([{'orderDate': '2026-07-13T16:30:01.19+00:00', 'purchasePrice': '400', 'shippingPrice': '13.99', 'quantity': 1}])
assert pts[0]['date'] == '2026-07-13T16:30Z', pts
assert m.parse_datetime('2026-07-13T16:30Z').isoformat() == '2026-07-13T16:30:00+00:00'
print('OK')
"
```
→ prints `OK`.

### Step 3: Add retention + archive to the scraper

Still in `scripts/update-prices.py`:

1. Near the other path constants (after line 36), add:
   ```python
   ARCHIVE = DATA_DIR / 'history-archive.json'
   RETENTION_DAYS = 365
   ```

2. Add this function next to `merge_history_points` (after line 347). Retention rule, chosen for determinism: a calendar month (UTC, per set) is pruned only once it has **fully** ended before the cutoff; from such a month, keep its last positive-price row in `history.json` (the "monthly spine", so all-time charts keep their left edge) plus any `release date` anchor, and move every other row to the archive. Months only partially past the cutoff are left intact, so the spine choice never changes between runs.

   ```python
   def prune_history(rows, now):
       """Split sorted history rows into (kept, archived). Months fully older
       than RETENTION_DAYS keep one spine row (their last positive-price row)
       and their release anchors; everything else in them is archived."""
       cutoff = now - timedelta(days=RETENTION_DAYS)
       by_month = {}
       for row in rows or []:
           parsed = parse_datetime(row.get('date'))
           key = parsed.strftime('%Y-%m') if parsed else None
           by_month.setdefault(key, []).append(row)
       kept, archived = [], []
       for key, group in by_month.items():
           if key is None:
               kept.extend(group)
               continue
           year, month = int(key[:4]), int(key[5:7])
           month_end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
           if month_end >= cutoff:
               kept.extend(group)
               continue
           spine = None
           for row in group:  # rows arrive sorted, so the last hit is the latest
               price = money(row.get('price'))
               if price and price > 0:
                   spine = row
           for row in group:
               if row is spine or row.get('source') == 'release date':
                   kept.append(row)
               else:
                   archived.append(row)
       return sorted(kept, key=history_sort_key), archived
   ```

3. In `main()`, load the archive alongside the other files (after line 501):
   ```python
   archive = json.loads(ARCHIVE.read_text()) if ARCHIVE.exists() else {}
   ```
   and inside the `if INITIAL_SCRAPE:` block (lines 503-505), also reset it: `archive = {}`.

4. Immediately after `history[code] = hist` (line 560), apply retention:
   ```python
   hist, archived_rows = prune_history(hist, now)
   history[code] = hist
   if archived_rows:
       archive[code] = merge_history_points(archive.get(code, []), archived_rows)
   ```
   (The window metrics computed below from `hist` — 52-week range, 30-day change, volumes — only look back ≤365 days, so pruning rows older than that cannot change them. RSI at line 602 currently runs over all of `hist` including spine rows; that is unchanged behavior-wise and is redesigned separately in plan 004.)

5. In the write block (lines 641-645), add after the `HISTORY.write_text(...)` line:
   ```python
   ARCHIVE.write_text(json.dumps(archive, indent=2) + '\n')
   ```

**Verify** (synthetic, no network):
```bash
python3 -c "
import importlib.util
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('up', 'scripts/update-prices.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
now = datetime(2026, 7, 13, tzinfo=timezone.utc)
rows = [
  {'date': '2022-12-02', 'price': None, 'volume': 0, 'source': 'release date', 'confidence': 'reference'},
  {'date': '2025-01-05T10:00Z', 'price': 100, 'volume': 1, 'source': 'tcgplayer latest sale', 'confidence': 'verified'},
  {'date': '2025-01-20T10:00Z', 'price': 110, 'volume': 1, 'source': 'tcgplayer latest sale', 'confidence': 'verified'},
  {'date': '2026-07-01T10:00Z', 'price': 200, 'volume': 1, 'source': 'tcgplayer current market', 'confidence': 'verified'},
]
kept, archived = m.prune_history(rows, now)
assert [r['date'] for r in kept] == ['2022-12-02', '2025-01-20T10:00Z', '2026-07-01T10:00Z'], kept
assert [r['date'] for r in archived] == ['2025-01-05T10:00Z'], archived
print('OK')
"
```
→ prints `OK` (Jan 2025 fully expired: spine = its last priced row; the recent row and the release anchor survive).

### Step 4: Create and run the one-time migration script

Create `scripts/migrate-history-20260713.py` with exactly this content:

```python
#!/usr/bin/env python3
"""One-time migration (2026-07-13): make history timestamps UTC-explicit.

Rewrites every 'YYYY-MM-DD HH:MM' date in public/data/history.json to
'YYYY-MM-DDTHH:MMZ'. The scraper always wrote these labels from a UTC clock
and its own parser (parse_datetime in scripts/update-prices.py) already read
them as UTC, but browsers parse zone-less date-time strings as LOCAL time —
so every chart point was shifted by the viewer's UTC offset. Appending 'Z'
preserves the Python interpretation and fixes browsers.

Also creates public/data/history-archive.json if absent (empty on first run:
as of 2026-07 no priced row is older than the 365-day retention window).

transactions.json needs NO migration: every timestamp there is already
offset-explicit ISO, and transaction ids embed those strings, so rewriting
them would break dedup.

Idempotent: already-migrated rows are left untouched. Validates every row
before writing anything and aborts on any unrecognized format.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HISTORY = ROOT / 'public' / 'data' / 'history.json'
ARCHIVE = ROOT / 'public' / 'data' / 'history-archive.json'

DATE_ONLY = re.compile(r'^\d{4}-\d{2}-\d{2}$')
SPACE_MINUTE = re.compile(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$')
UTC_MINUTE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$')


def main():
    history = json.loads(HISTORY.read_text())
    migrated, unchanged, bad = 0, 0, []
    for code, rows in history.items():
        for row in rows:
            date = str(row.get('date') or '')
            if SPACE_MINUTE.fullmatch(date):
                row['date'] = date.replace(' ', 'T') + 'Z'
                migrated += 1
            elif DATE_ONLY.fullmatch(date) or UTC_MINUTE.fullmatch(date):
                unchanged += 1
            else:
                bad.append((code, date))
    if bad:
        print(f'ABORT: {len(bad)} rows with unrecognized date format, e.g. {bad[:5]}', file=sys.stderr)
        sys.exit(1)
    HISTORY.write_text(json.dumps(history, indent=2) + '\n')
    if not ARCHIVE.exists():
        ARCHIVE.write_text('{}\n')
    print(f'Migrated {migrated} rows, left {unchanged} unchanged, across {len(history)} sets.')


if __name__ == '__main__':
    main()
```

Run it: `python3 scripts/migrate-history-20260713.py`

**Verify**:
1. The script prints `Migrated <N> rows, left <M> unchanged, across <S> sets.` where `<N>` equals Step 1's `space` count, `<M>` equals Step 1's `date_only` count, and `<S>` equals Step 1's `sets` count.
2. Re-run Step 1's format census → now `space: 0`, `utc:` equals the old `space` count, `date_only` unchanged, `other: 0`, and the row total is identical (no row lost or added).
3. Idempotence: run the migration a second time → prints `Migrated 0 rows, ...` and `git diff --stat public/data/history.json` shows no further change.
4. Every date now parses identically in both runtimes:
   ```bash
   node -e "
   const h = require('./public/data/history.json');
   let n = 0, bad = 0;
   for (const rows of Object.values(h)) for (const r of rows) { n++; if (!Number.isFinite(new Date(String(r.date).replace(' ', 'T')).getTime())) bad++; }
   console.log(n, 'rows,', bad, 'unparseable');
   "
   ```
   → `... rows, 0 unparseable`.
   ```bash
   node -e "console.log(new Date('2026-05-03T23:30Z').getTime())"
   python3 -c "from datetime import datetime, timezone; print(int(datetime(2026, 5, 3, 23, 30, tzinfo=timezone.utc).timestamp() * 1000))"
   ```
   → both print the same number (`1777851000000`).
5. `cat public/data/history-archive.json` → `{}` (expected empty at planning time — see "Current state"; if the executor runs this plan more than ~8 months after 2026-07, some sets may legitimately have archived rows after the first scraper run, but the migration itself never archives).

### Step 5: Fix browser caching in the dashboard

In `src/Dashboard.jsx`, inside `useMarketData` (lines 61-75), replace the fetch block quoted in "Current state" with:

```js
      const base = import.meta.env.BASE_URL;
      const m = await fetch(`${base}data/market.json`, { cache: 'no-store' }).then(r => r.json());
      const v = encodeURIComponent(m.updatedAt || Date.now());
      const [h, x] = await Promise.all([
        fetch(`${base}data/history.json?v=${v}`).then(r => r.json()),
        fetch(`${base}data/transactions.json?v=${v}`).then(r => r.json()),
      ]);
```

The small `market.json` is always revalidated; the large `history.json` is keyed to the run that produced it, so a browser revisiting between bot runs gets a normal HTTP cache hit instead of re-downloading ~1.4 MB. Do not fetch `history-archive.json` — it is deliberately not loaded by the page.

**Verify**: `npm ci && npm run build` → exit 0. `grep -n "t=\${Date.now()}" src/Dashboard.jsx` → no matches.

### Step 6: Stage the archive file in the workflow commit step

In `.github/workflows/update-prices.yml` line 83, change:

```
git add public/data/market.json public/data/history.json public/data/transactions.json
```

to:

```
git add public/data/market.json public/data/history.json public/data/transactions.json public/data/history-archive.json
```

**Verify**: `grep -c "history-archive.json" .github/workflows/update-prices.yml` → `1`.

### Step 7: Correct the README

Apply exactly these corrections to `README.md` (line numbers from commit `071b8bb`):

| Line | Currently says | Change to |
|------|----------------|-----------|
| 11 | "20 tracked sets" | "22 tracked sets" |
| 12 | "runs the scraper every 6 hours" | "runs the scraper hourly" |
| 45 | "runs every 6 hours by default" | "runs hourly by default" |
| 62 | diagram header "GitHub Actions (every 6h)" | "GitHub Actions (hourly)" |
| 66 | "scrape TCGPlayer JSON-LD per product" | "query TCGPlayer mp-search-api JSON endpoints per product" |
| 72 | "history.json ← rolling 365 days per set" | "history.json ← last 365d + monthly spine per set" |
| 98 | "Cron: scrapes prices every 6h" | "Cron: scrapes prices hourly" |
| 101 | "365d price history per set (appended)" | "last 365d + monthly spine per set; older rows in history-archive.json" |
| 102 (after) | — | add a line for `history-archive.json  # rows aged out of the 365d window (not fetched by the app)` |
| 122-128 | cron example shows `'15 */6 * * *'   # every 6 hours` as active | make `'15 * * * *'   # hourly` the active example; keep the others commented |
| 164 | "4 runs/day = ~120 minutes/month — well within limits" | "24 runs/day = ~720 minutes/month (public repos get unlimited Actions minutes)" |
| 170 | "**React 18** + **Vite**" | "**React 19** + **Vite**" (matches `package.json`: `"react": "^19.2.5"`) |

**Verify**: `grep -n "every 6 hours\|every 6h\|React 18\|JSON-LD\|rolling 365\|20 tracked" README.md` → no matches.

### Step 8 (optional, requires network): end-to-end scraper run

`DRY_RUN=1 python3 scripts/update-prices.py` → exit 0, ends with `DRY_RUN=1 — not writing files.`; then `git status --porcelain public/data/` shows only the migration's changes from Step 4, nothing newer. If you have no network, the importlib verifications in Steps 2-3 are the accepted substitute; note that in your report.

## Test plan

No test framework exists (do not add one). The gates are: the format census before/after (Step 1/4), the synthetic `prune_history` and `sales_history_points` assertions (Steps 2-3), the cross-runtime epoch equality check (Step 4.4), idempotent re-run (Step 4.3), and `npm run build`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Step 1 census re-run reports `space: 0`, `other: 0`, and a total row count equal to the pre-migration total
- [ ] `python3 scripts/migrate-history-20260713.py` re-run prints `Migrated 0 rows, ...` (idempotent)
- [ ] Node/Python epoch check prints identical numbers
- [ ] `public/data/history-archive.json` exists and is valid JSON
- [ ] `npm run build` exits 0; `grep -n "t=\${Date.now()}" src/Dashboard.jsx` empty
- [ ] `grep -n "every 6 hours\|React 18\|JSON-LD" README.md` empty
- [ ] Everything lands in ONE commit; `git status --porcelain` clean afterward, only in-scope files in the commit
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's census finds `other > 0` — a date format exists that neither the migration nor this plan accounts for. Do not write a partial migration.
- The migration script prints `ABORT` — same situation caught at run time; `history.json` is untouched in that case by design.
- Post-migration row totals differ from pre-migration totals — the migration must be a pure reformat; a count change means a bug, revert `public/data/history.json` via `git checkout -- public/data/history.json` and report.
- The scraper excerpts at lines 372-387, 514, or 641-645 do not match "Current state" (beyond plan 001's known edits elsewhere in the file).
- The Node/Python epoch equality check disagrees — the format assumption about JS parsing is wrong for your Node version; do not ship.
- You cannot rebase onto latest `main` cleanly before finishing (bot conflicts in `public/data/`) — resolve by re-running the migration on the rebased file; if that still conflicts, stop.

## Maintenance notes

- The retention rule prunes only **fully-expired calendar months**, so a month's spine row is chosen exactly once and never churns between runs. If the retention window is ever changed, keep that property.
- `history-archive.json` grows slowly and is committed but never fetched by the app. If an "all-time detail" view is ever wanted, lazily fetch it on demand — do not add it to the initial `Promise.all`.
- The migration script is kept in `scripts/` for audit; it is safe to delete after a few months (it is idempotent and self-documenting).
- Plan 004 (daily-bucketed analytics) builds on the UTC-explicit timestamps introduced here — its day bucketing is wrong without this plan.
- Reviewers should scrutinize: the one-commit atomicity, and that no `transactions.json` bytes changed.
