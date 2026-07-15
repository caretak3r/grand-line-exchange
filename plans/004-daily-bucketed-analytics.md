# Plan 004: Compute MA7/MA30 and RSI over calendar-day buckets instead of raw observation counts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 071b8bb..HEAD -- src/Dashboard.jsx scripts/update-prices.py`
> Expected drift: plans 001 (sets.json import/loader), 002 (timestamps,
> retention, fetch caching), 003 (stale flag, eBay removal, money()→None).
> Any drift in the regions quoted below beyond those plans' documented edits
> is a STOP condition. `public/data/*.json` churns hourly via the bot —
> expected, not drift.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (changes displayed/emitted analytics values, not persisted history)
- **Depends on**: plans/002-utc-timestamps-and-retention-migration.md (**hard** — day bucketing in the browser requires the UTC-explicit timestamps that plan introduces). plans/003-* ordering assumed but not required (the code below is written to work with `money()` returning either `0.0` or `None`).
- **Category**: bug
- **Planned at**: commit `071b8bb`, 2026-07-13

## Why this matters

The history series mixes ~daily market snapshots with per-event sale rows — a liquid set can produce a dozen rows in one afternoon. Yet the UI's "7d MA" and "30d MA" are averages of the last 7 and 30 *rows*, and the scraper's RSI runs Wilder smoothing over the entire row sequence as if rows were evenly spaced periods. So "30d MA" on a busy set can actually describe the last two days, and RSI's meaning varies with sale density rather than time. This plan defines one bucketing rule — per UTC calendar day: the day's last market snapshot price, else the median of that day's sales — and computes the MA lines (frontend) and RSI (scraper) over those daily closes, making the labels "7d"/"30d"/"14-period RSI" truthful. Raw rows are kept for the price line, volume bars, and tooltips.

## Current state

All excerpts from commit `071b8bb` unless noted.

**Data shape** (verified 2026-07-13): `history.json` rows carry `source: 'tcgplayer current market'` (one per set per day, deduped by the scraper's `history_row_key` on `date[:10]`; these exist from 2026-05-03 onward), `source: 'tcgplayer latest sale'` (many per day possible; these are the only priced rows before 2026-05), and `source: 'release date'` (price `null`, filtered out everywhere). After plan 002, priced-row dates are `YYYY-MM-DDTHH:MMZ` (UTC-explicit).

**`src/Dashboard.jsx`** — the observation-count MAs, lines 284-302:

```js
  // Add moving averages on the fly
  const chartData = useMemo(() => {
    if (!selectedHistory.length) return [];
    return selectedHistory
      .map(row => ({ ...row, ts: parseChartTime(row.date) }))
      .filter(row => row.ts && row.price > 0)
      .sort((a, b) => a.ts - b.ts)
      .map((row, i, rows) => {
        const priced = rows.slice(0, i + 1).filter(p => p.price > 0);
        const w7 = priced.slice(-7);
        const w30 = priced.slice(-30);
        return {
          ...row,
          axis: i,
          ma7: w7.length ? Math.round(w7.reduce((s, p) => s + p.price, 0) / w7.length * 100) / 100 : null,
          ma30: w30.length ? Math.round(w30.reduce((s, p) => s + p.price, 0) / w30.length * 100) / 100 : null,
        };
      });
  }, [selectedHistory]);
```

The labels that this plan makes truthful (no text change needed): tooltip `labels = { price: 'Price', ma7: '7d MA', ma30: '30d MA', volume: 'Volume' }` (line 136) and the chart legend entries `7d MA` / `30d MA` (lines 514-515).

**`scripts/update-prices.py`** — RSI over raw rows:

- Lines 267-285, `compute_rsi(prices)`: Wilder RSI, period 14, seeded on the first 14 deltas then smoothed over the whole input list; returns 50 when `len(prices) < 15`. The function itself is correct — only its *input* is wrong.
- Line 563: `prices = [money(h.get('price')) for h in hist if money(h.get('price')) > 0]` (post-plan-003 this becomes the None-safe generator form) — all positive rows, mixed cadence.
- Line 602: `'rsi': compute_rsi(prices),` — the only call site of `compute_rsi`.
- `prices` remains needed elsewhere: line 564 `if not prices: continue`, line 566 `prices_52w = history_prices_since(hist, 365, now) or prices`, line 573 `elif INITIAL_SCRAPE and len(prices) >= 2`. Do not remove it.
- Already calendar-correct and therefore untouched: `change30d` (`price_at_or_before`, lines 410-419), 52-week range (`history_prices_since`, lines 399-407), `volume30d`/`soldLast7d` (`history_sales_volume_since`, lines 422-431).

**Bucketing rule rationale** (inline so the executor doesn't have to reconstruct it): on a day that has a market snapshot, the snapshot wins — it is TCGPlayer's own smoothed market price and dedupes to one per day; sale medians cover the pre-2026-05 span where only sale rows exist. Median (not mean) so a single mispriced outlier sale doesn't own the day.

**Repo constraints**: stdlib-only Python; no test framework (`package.json` scripts: `dev`, `build`, `preview`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build frontend | `npm ci && npm run build` | exit 0 |
| Python module checks (no network) | importlib one-liners below | as stated |
| Scraper dry run (network) | `DRY_RUN=1 python3 scripts/update-prices.py` | exit 0, no file writes |
| Scope check | `git status --porcelain` | only in-scope files |

## Scope

**In scope** (the only files you should modify):
- `src/Dashboard.jsx` (the `chartData` useMemo only)
- `scripts/update-prices.py` (add `daily_closes()`, change the `compute_rsi` call site)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `compute_rsi` itself — the algorithm is fine; only feed it daily closes.
- `change30d`, 52w range, `volume30d`, `soldLast7d` — already calendar-based.
- The index chart (`indexData`, `Dashboard.jsx:317-359`) — its per-event carry-forward construction is a deliberate design for irregular series; leave it.
- The `Sparkline` component and volume bars — they intentionally show raw observations.
- Tooltip/legend label strings — they become accurate as-is.
- `public/data/*.json`.

## Git workflow

- Branch: `advisor/004-daily-bucketed-analytics`
- Conventional Commits, e.g. `fix: compute MA7/MA30 and RSI over UTC daily closes`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rewrite the chartData useMemo with daily-close MAs

In `src/Dashboard.jsx`, replace the entire `chartData` useMemo (quoted above) with:

```js
  // MAs use daily closes: per UTC day, the last market snapshot's price if
  // present, else the median of that day's sales. Rows stay per-observation
  // for the price line, volume bars, and tooltips.
  const chartData = useMemo(() => {
    if (!selectedHistory.length) return [];
    const rows = selectedHistory
      .map(row => ({ ...row, ts: parseChartTime(row.date) }))
      .filter(row => row.ts && row.price > 0)
      .sort((a, b) => a.ts - b.ts);
    const byDay = new Map();
    for (const row of rows) {
      const day = new Date(row.ts).toISOString().slice(0, 10);
      const entry = byDay.get(day) || { market: null, sales: [] };
      if (row.source === 'tcgplayer current market') entry.market = row.price;
      else entry.sales.push(row.price);
      byDay.set(day, entry);
    }
    const closes = [...byDay.entries()].map(([day, e]) => {
      if (e.market != null) return { day, close: e.market };
      const s = [...e.sales].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return { day, close: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2 };
    });
    const maOver = (day, windowDays) => {
      const end = Date.parse(day);
      const start = end - (windowDays - 1) * 86400000;
      const w = closes.filter(c => { const t = Date.parse(c.day); return t >= start && t <= end; });
      return w.length ? Math.round(w.reduce((s, c) => s + c.close, 0) / w.length * 100) / 100 : null;
    };
    return rows.map((row, i) => {
      const day = new Date(row.ts).toISOString().slice(0, 10);
      return { ...row, axis: i, ma7: maOver(day, 7), ma30: maOver(day, 30) };
    });
  }, [selectedHistory]);
```

Notes for correctness, already accounted for: `rows` is sorted, so `Map` insertion order (and therefore `closes`) is chronological; `Date.parse('YYYY-MM-DD')` is UTC midnight per the ECMAScript spec, matching the `toISOString` day key; a priced row's own day always has a close, so `ma7` is never null on a rendered row; the O(rows × days) filter is fine at this data size (< 10⁴ operations per set).

**Verify**: `npm ci && npm run build` → exit 0. `grep -c "toISOString().slice(0, 10)" src/Dashboard.jsx` → `2`. `grep -n "slice(-7)\|slice(-30)" src/Dashboard.jsx` → no matches.

### Step 2: Add daily_closes() to the scraper and feed RSI from it

In `scripts/update-prices.py`, add next to `compute_rsi` (after line 285):

```python
def daily_closes(rows):
    """Per UTC day: the day's last market-snapshot price, else the median of
    that day's sale prices. Returns closes in day order (RSI input)."""
    days = {}
    for row in rows or []:
        price = money(row.get('price'))
        parsed = parse_datetime(row.get('date'))
        if not price or price <= 0 or not parsed:
            continue
        day = parsed.strftime('%Y-%m-%d')
        entry = days.setdefault(day, {'market': None, 'sales': []})
        if row.get('source') == 'tcgplayer current market':
            entry['market'] = price
        else:
            entry['sales'].append(price)
    closes = []
    for day in sorted(days):
        entry = days[day]
        if entry['market'] is not None:
            closes.append(entry['market'])
        else:
            sales = sorted(entry['sales'])
            mid = len(sales) // 2
            closes.append(sales[mid] if len(sales) % 2 else (sales[mid - 1] + sales[mid]) / 2)
    return closes
```

(The `if not price or price <= 0` guard works whether `money()` returns `0.0` — pre-plan-003 — or `None` — post-plan-003.)

Then change line 602 from `'rsi': compute_rsi(prices),` to:

```python
        'rsi': compute_rsi(daily_closes(hist)),
```

Leave the `prices` list itself alone (still used at lines 564, 566, 573). `compute_rsi` returns a neutral 50 when fewer than 15 daily closes exist — correct for newly released sets.

**Verify** (no network; the fixture encodes every branch: market-wins-over-sales, odd median, even median, garbage price skipped, day ordering):
```bash
python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('up', 'scripts/update-prices.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rows = [
  {'date': '2026-07-02T10:00Z', 'price': 100, 'source': 'tcgplayer latest sale'},
  {'date': '2026-07-01T09:00Z', 'price': 90,  'source': 'tcgplayer latest sale'},
  {'date': '2026-07-01T12:00Z', 'price': 200, 'source': 'tcgplayer latest sale'},
  {'date': '2026-07-01T18:00Z', 'price': 95,  'source': 'tcgplayer current market'},
  {'date': '2026-07-02T11:00Z', 'price': 120, 'source': 'tcgplayer latest sale'},
  {'date': '2026-07-03T11:00Z', 'price': 'garbage', 'source': 'tcgplayer latest sale'},
  {'date': '2026-07-04T11:00Z', 'price': 80, 'source': 'tcgplayer latest sale'},
  {'date': '2026-07-04T12:00Z', 'price': 84, 'source': 'tcgplayer latest sale'},
  {'date': '2026-07-04T13:00Z', 'price': 90, 'source': 'tcgplayer latest sale'},
]
assert m.daily_closes(rows) == [95, 110, 84], m.daily_closes(rows)
assert m.compute_rsi(m.daily_closes(rows)) == 50  # < 15 closes -> neutral
print('OK')
"
```
→ prints `OK` (day 1: market 95 beats the sales; day 2: even count median of [100, 120] = 110; day 3: garbage skipped entirely; day 4: odd median of [80, 84, 90] = 84).

### Step 3 (optional, requires network): end-to-end dry run

`DRY_RUN=1 python3 scripts/update-prices.py` → exit 0 (RSI values in the printed summary may differ from the committed `market.json` — expected, that is the point); `git status --porcelain public/data/` → empty.

## Test plan

No test framework exists (do not add one — real unit tests for this logic are deferred to after plan 005 extracts it into an importable module). Gates: the Python fixture assertion in Step 2 (which exercises market-precedence, odd/even medians, malformed-price skip, and day ordering), the grep assertions in Step 1, and `npm run build`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run build` exits 0
- [ ] `grep -n "slice(-7)\|slice(-30)" src/Dashboard.jsx` → empty (old observation windows gone)
- [ ] Step 2's fixture assertion prints `OK`
- [ ] `grep -c "daily_closes" scripts/update-prices.py` → `2` (definition + RSI call site)
- [ ] `git status --porcelain` shows only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 002 has not landed (check: `grep -c "history-archive" scripts/update-prices.py` → must be ≥ 1). Without UTC-explicit timestamps, browser day bucketing is wrong for every viewer outside UTC — do not proceed.
- The `chartData` useMemo doesn't match the excerpt in "Current state" (beyond whitespace) — the component drifted.
- `compute_rsi` has more than one call site (`grep -n "compute_rsi(" scripts/update-prices.py` shows other uses than the definition and line 602).
- Step 2's fixture assertion fails after one fix attempt — report the actual output rather than adjusting the fixture.

## Maintenance notes

- The bucketing rule (market snapshot beats sales; median for sale-only days) is now defined in two places — `Dashboard.jsx` and `update-prices.py`. Plan 005 moves the JS side into `src/lib/analytics.js`; if the rule ever changes, change both and say so in the commit message.
- If intraday charting is ever added, keep the daily closes for MA/RSI and add a separate intraday series — do not revert MAs to observation windows.
- Reviewers should scrutinize: the median tie-break (even count averages the two middle values) matches between the JS and Python implementations, and that `prices` (line 563) was not removed.
- Deferred: unit tests for `daily_closes`/MA math (after plan 005's extraction makes them importable).
