# Plan 005: Extract browser analytics into src/lib/analytics.js and document the analytics-ownership rule

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: this plan is written against the codebase
> AFTER plans 001-004. First confirm `plans/README.md` shows 001-004 as DONE
> (004 is a hard prerequisite; see STOP conditions). Then run
> `git diff --stat 071b8bb..HEAD -- src/Dashboard.jsx` and confirm the
> changes are only those documented by plans 001-004. Compare the excerpts
> below against the live code; the `indexData` and market-aggregates blocks
> are untouched by plans 001-004 and must match `071b8bb` exactly.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW (pure code movement, no behavior change)
- **Depends on**: plans/004-daily-bucketed-analytics.md (**hard** — extract the corrected math, not the old math). Benefits from 001/002 having landed.
- **Category**: tech-debt
- **Planned at**: commit `071b8bb`, 2026-07-13

## Why this matters

`src/Dashboard.jsx` is an ~800-line component that mixes data fetching, state, styling, rendering, and all browser-side analytics (moving averages, the cross-product index, market-pulse aggregates). Meanwhile the Python scraper owns a different set of analytics (RSI, signals, ranges) persisted in `market.json`. There is no stated rule for which side owns what, and the browser math is untestable because it lives inside a component. This plan extracts the computation blocks into a plain module of pure functions, `src/lib/analytics.js`, and writes the ownership rule into the README: **Python computes everything persisted in `market.json` at ingest; `src/lib/analytics.js` computes everything derived in the browser for display; nothing computes the same number in both places.** No behavior changes; JSX/presentation splitting is explicitly not part of this plan.

## Current state

**`src/Dashboard.jsx`** (line numbers from commit `071b8bb` except where plans 001-004 changed them):

- Lines 26-29 — `parseChartTime` (moves to the new module; after extraction Dashboard has no remaining use of it):
  ```js
  const parseChartTime = (value) => {
    const ts = new Date(String(value || '').replace(' ', 'T')).getTime();
    return Number.isFinite(ts) ? ts : null;
  };
  ```
- Line 43 — `pctChange` (moves; Dashboard still uses it at the `selectedAllTimeChange` and `indexAllTimeChange` lines, so it gets imported back):
  ```js
  const pctChange = (start, end) => start ? ((end - start) / start) * 100 : 0;
  ```
- The `chartData` useMemo — post-plan-004 this is the daily-close version (its exact code is specified verbatim in `plans/004-daily-bucketed-analytics.md` Step 1; that is the code to move).
- Lines 307-315 (unchanged by plans 001-004) — the market-pulse aggregates. `active` is also used directly by the render (ticker, stat cards, decision matrix, footer), so the extracted function must return it:
  ```js
  const active = sets.filter(s => s.price > 0);
  const totalCap = active.reduce((sum, s) => sum + s.price * s.volume30d, 0);
  const totalVol = active.reduce((sum, s) => sum + s.volume30d, 0);
  const avgChange = active.length ? active.reduce((sum, s) => sum + s.change30d, 0) / active.length : 0;
  const gainers = active.filter(s => s.change30d > 0).length;
  const losers = active.filter(s => s.change30d < 0).length;
  const buys = active.filter(s => s.signal === 'BUY' || s.signal === 'STRONG BUY').length;
  const topGainers = [...active].sort((a, b) => b.change30d - a.change30d).slice(0, 5);
  const topLosers = [...active].sort((a, b) => a.change30d - b.change30d).slice(0, 5);
  ```
- Lines 317-359 (unchanged by plans 001-004) — the `indexData` useMemo (equal-weight base-100 index with per-set baselines and carry-forward):
  ```js
  const indexData = useMemo(() => {
    if (!history || !sets.length) return [];
    const trackedCodes = new Set(sets.map(s => s.code));
    const grouped = new Map();
    for (const code of trackedCodes) {
      for (const row of history[code] || []) {
        const price = Number(row.price);
        const ts = parseChartTime(row.date);
        if (!ts || !price || price <= 0) continue;
        const bucket = grouped.get(ts) || [];
        bucket.push({ code, price, source: row.source });
        grouped.set(ts, bucket);
      }
    }
    const latest = new Map();
    const baselines = new Map();
    return [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([ts, events], i) => {
        for (const event of events) {
          if (!baselines.has(event.code)) baselines.set(event.code, event.price);
          latest.set(event.code, event.price);
        }
        const prices = sets.map(s => latest.get(s.code)).filter(p => p > 0);
        const normalized = sets
          .map(s => {
            const price = latest.get(s.code);
            const base = baselines.get(s.code);
            return price && base ? (price / base) * 100 : null;
          })
          .filter(p => p > 0);
        const changed = events.map(e => e.code).join(', ');
        return {
          axis: i,
          ts,
          index: Math.round(normalized.reduce((sum, p) => sum + p, 0) / normalized.length * 100) / 100,
          avgPrice: Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length * 100) / 100,
          coverage: normalized.length,
          totalSets: sets.length,
          changed,
        };
      });
  }, [history, sets]);
  ```
- Staying in `Dashboard.jsx` (presentation, do not move): `fmt$`, `fmtPct`, `fmtNum`, `fmtChartDate`, `fmtShortChartDate`, `fmtAxisDate`, `observationDomain`, `fmtIndex`, `timeAgo`, `signalColor`, `tierLabel`, `useMarketData`, the `sets`/`filtered` useMemos, and all components/JSX.

**`README.md`** — the Architecture section ends with the "Key idea" paragraph (`README.md:88`: "**Key idea:** the dashboard is a pure static site... The repo itself is the database."). The ownership rule goes right after it. There is no `src/lib/` directory yet; `README.md:92-112` has a project-structure tree listing `src/` contents — add the new file there.

**Repo constraints**: `package.json` has `"type": "module"` (so `node -e "import('./src/lib/analytics.js')"` works for verification), and no test framework — **do not add vitest in this plan**; it is a deferred follow-up (see Maintenance notes).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build frontend | `npm ci && npm run build` | exit 0 |
| Module unit checks | `node -e "import('./src/lib/analytics.js').then(m => { ... })"` one-liners below | as stated |
| Scope check | `git status --porcelain` | only in-scope files |

## Scope

**In scope** (the only files you should modify):
- `src/lib/analytics.js` (create)
- `src/Dashboard.jsx` (remove moved code, add imports, thin useMemo wrappers)
- `README.md` (ownership rule + project-structure line)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `scripts/update-prices.py` — its analytics stay where they are; that is the point of the ownership rule.
- Splitting `Dashboard.jsx` into presentational components — cosmetic, explicitly deferred.
- Any change to computed values — this plan is movement only; if a number would change, something is wrong.
- Adding vitest or any devDependency.
- `public/data/*.json`.

## Git workflow

- Branch: `advisor/005-extract-analytics-module`
- Single commit, Conventional Commits: `refactor: extract browser analytics into src/lib/analytics.js`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create src/lib/analytics.js

Create the file with this structure (bodies are the exact code being moved — copy from the live `Dashboard.jsx`, not from memory):

```js
// Pure browser-side analytics derived from history.json / market.json.
//
// Ownership rule (mirrored in README.md): every value persisted in
// public/data/market.json (price, RSI, signals, ranges, volumes) is computed
// once by scripts/update-prices.py at ingest. Every value derived in the
// browser for display (moving averages, the Grand Line Index, market-pulse
// aggregates) is computed here. Nothing computes the same number in both
// places.

export const parseChartTime = (value) => {
  const ts = new Date(String(value || '').replace(' ', 'T')).getTime();
  return Number.isFinite(ts) ? ts : null;
};

export const pctChange = (start, end) => start ? ((end - start) / start) * 100 : 0;

// Body: the post-plan-004 chartData useMemo body, with `selectedHistory`
// renamed to the `historyRows` parameter. Includes the internal empty-input
// guard (`if (!historyRows.length) return [];`).
export function buildChartData(historyRows) { /* moved code */ }

// Body: the indexData useMemo body, unchanged, including its own guard
// `if (!history || !sets.length) return [];`
export function buildIndexData(history, sets) { /* moved code */ }

// Body: the nine aggregate lines from Dashboard.jsx:307-315, returned as an
// object. `active` is included — the render uses it directly.
export function computeMarketStats(sets) {
  const active = sets.filter(s => s.price > 0);
  /* ...the other eight lines, verbatim... */
  return { active, totalCap, totalVol, avgChange, gainers, losers, buys, topGainers, topLosers };
}
```

**Verify** (pure-module smoke test, mirrors the Python fixture from plan 004 so the two implementations are checked against the same expectations):
```bash
node -e "
import('./src/lib/analytics.js').then(m => {
  const assert = require('assert');
  const rows = [
    { date: '2026-07-02T10:00Z', price: 100, source: 'tcgplayer latest sale' },
    { date: '2026-07-01T09:00Z', price: 90,  source: 'tcgplayer latest sale' },
    { date: '2026-07-01T12:00Z', price: 200, source: 'tcgplayer latest sale' },
    { date: '2026-07-01T18:00Z', price: 95,  source: 'tcgplayer current market' },
    { date: '2026-07-02T11:00Z', price: 120, source: 'tcgplayer latest sale' },
    { date: '2026-07-04T11:00Z', price: 80,  source: 'tcgplayer latest sale' },
    { date: '2026-07-04T12:00Z', price: 84,  source: 'tcgplayer latest sale' },
    { date: '2026-07-04T13:00Z', price: 90,  source: 'tcgplayer latest sale' },
  ];
  const chart = m.buildChartData(rows);
  assert.strictEqual(chart.length, 8);
  assert.strictEqual(chart[chart.length - 1].ma7, 96.33); // mean of daily closes [95, 110, 84]
  assert.deepStrictEqual(m.buildChartData([]), []);
  const stats = m.computeMarketStats([
    { price: 100, volume30d: 2, change30d: 5,  signal: 'BUY' },
    { price: 0,   volume30d: 9, change30d: -1, signal: 'HOLD' },
    { price: 50,  volume30d: 4, change30d: -3, signal: 'HOLD' },
  ]);
  assert.strictEqual(stats.active.length, 2);
  assert.strictEqual(stats.totalCap, 400);
  assert.strictEqual(stats.buys, 1);
  const idx = m.buildIndexData({ A: [{ date: '2026-07-01T10:00Z', price: 100 }, { date: '2026-07-02T10:00Z', price: 110 }] }, [{ code: 'A' }]);
  assert.strictEqual(idx.length, 2);
  assert.strictEqual(idx[1].index, 110);
  assert.ok(Math.abs(m.pctChange(100, 110) - 10) < 1e-9);
  console.log('OK');
});
"
```
→ prints `OK`. (Expected `ma7` derivation: daily closes are 95 on 07-01 — the market snapshot beats that day's sales — 110 on 07-02 — even-count median of [100, 120] — and 84 on 07-04 — odd median of [80, 84, 90]; the last row's 7-day window covers all three: (95 + 110 + 84) / 3 = 96.333… → 96.33.)

### Step 2: Rewire Dashboard.jsx

1. Add the import at the top (after the existing imports):
   ```js
   import { buildChartData, buildIndexData, computeMarketStats, pctChange } from './lib/analytics.js';
   ```
2. Delete the local `parseChartTime` (lines 26-29) and `pctChange` (line 43) definitions.
3. Replace the `chartData` useMemo body:
   ```js
   const chartData = useMemo(() => buildChartData(selectedHistory), [selectedHistory]);
   ```
4. Replace lines 307-315 with:
   ```js
   const { active, totalCap, totalVol, avgChange, gainers, losers, buys, topGainers, topLosers } = computeMarketStats(sets);
   ```
5. Replace the `indexData` useMemo body:
   ```js
   const indexData = useMemo(() => buildIndexData(history, sets), [history, sets]);
   ```
6. Delete the now-empty moved code. Everything else in the component stays byte-identical.

**Verify**: `npm ci && npm run build` → exit 0.
`grep -n "parseChartTime\|slice(0, 10)" src/Dashboard.jsx` → no matches (all moved).
`grep -c "useMemo" src/Dashboard.jsx` → `3` (sets merge, filtered, chartData — plus indexData = 4 if you kept both wrappers; the expected count is: same number as before this plan).
`grep -n "buildChartData\|buildIndexData\|computeMarketStats" src/Dashboard.jsx` → exactly the import line plus the three call sites.

### Step 3: Document the ownership rule in README.md

After the "Key idea" paragraph (`README.md:88`), add:

```markdown
**Analytics ownership:** every value persisted in `public/data/market.json`
(price, RSI, signals, 52-week ranges, volumes) is computed once by
`scripts/update-prices.py` at ingest. Every value derived in the browser for
display (moving averages, the Grand Line Index, market-pulse aggregates) is
computed in `src/lib/analytics.js`. Nothing computes the same number in both
places — if you need a value in a new place, import it from its owner.
```

Also add `│   ├── lib/analytics.js    # Browser-side derived analytics (MAs, index, aggregates)` to the project-structure tree in the `src/` block (`README.md:105-108` region).

**Verify**: `grep -c "analytics.js" README.md` → `2`.

## Test plan

No test framework exists and this plan must not add one. The Step 1 node fixture is the unit test (median rules, market-precedence, index base-100, aggregates); `npm run build` is the integration gate. Real vitest tests are the named deferred follow-up.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `src/lib/analytics.js` exists; Step 1's node fixture prints `OK`
- [ ] `npm run build` exits 0
- [ ] `grep -n "parseChartTime" src/Dashboard.jsx` → empty
- [ ] `grep -c "analytics.js" README.md` → `2`
- [ ] `git diff --stat` for this change touches only the four in-scope files
- [ ] Visual spot check available to a human reviewer: `npm run dev`, chart values identical before/after (this plan changes no numbers)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 004 has not landed (`grep -n "slice(-7)" src/Dashboard.jsx` still matches, or `plans/README.md` shows 004 not DONE) — extracting the old observation-window math would enshrine exactly the bug 004 fixes.
- The `indexData` or aggregates excerpts don't match the live code — some other change touched them and this plan's "pure movement" premise is broken.
- Step 1's node fixture fails after one fix attempt and the failure implicates the *moved* code rather than the fixture — that means the move changed behavior; report instead of patching the math.
- `npm run build` reports a missing export or circular import you cannot resolve by adjusting the import list alone.

## Maintenance notes

- The ownership rule is the durable artifact here; hold future PRs to it. A change that computes an already-persisted value in the browser (or vice versa) should be rejected in review.
- **Deferred follow-up (explicitly out of this plan)**: add vitest + unit tests for `analytics.js` — it is now a pure module, so tests are trivial to write; skipped now to avoid growing devDependencies without operator sign-off.
- Deferred: splitting `Dashboard.jsx`'s ~650 remaining lines of JSX into components — cosmetic, do only if the file keeps growing.
- Reviewers should scrutinize: that the moved bodies are byte-identical to the pre-move code (a `git diff --color-moved` view makes this obvious), and that `active` still reaches the ticker/decision-matrix/footer render paths.
