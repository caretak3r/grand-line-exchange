# Plan 003: Honest per-quote freshness, removal of the dead eBay path, and None-semantics for malformed numbers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 071b8bb..HEAD -- scripts/update-prices.py src/Dashboard.jsx .github/workflows/update-prices.yml README.md`
> Expected drift: plan 001's changes (JSON metadata loading) and plan 002's
> changes (timestamp format, retention, fetch caching, README corrections).
> Any drift in the specific regions quoted below is a STOP condition.
> `public/data/*.json` churns hourly via the scheduled bot — expected, not drift.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changes the numeric-parsing contract at ~13 call sites — every site is enumerated below)
- **Depends on**: none hard; execute after plans/002-* per the ordering in plans/README.md. Written against the post-001/002 codebase where noted.
- **Category**: bug + tech-debt
- **Planned at**: commit `071b8bb`, 2026-07-13

## Why this matters

Three provenance defects make the dashboard silently overstate data quality. (1) When a TCGPlayer fetch fails, the scraper correctly keeps the previous price — but stamps the kept quote with a **fresh** `lastUpdated` and no marker, so the UI presents stale cache as live data. (2) The optional eBay enrichment calls `findCompletedItems` on eBay's Finding API — an endpoint eBay decommissioned in early 2025 (the code's own comment already called it deprecated, and its docstring misidentifies it as the "Browse API") — and when it did work, it silently **blended** eBay sold averages into the TCGPlayer market price, and that blended number flowed into history rows labeled `tcgplayer current market` / `verified`. Dead code that poisons provenance when alive should be deleted. (3) `money()` coerces any malformed or absent numeric field to `0.0`, so "missing" and "costs nothing" are indistinguishable; a sale with an unparseable price is currently recorded at the price of its shipping. This plan adds a per-quote `stale` flag with truthful `lastUpdated`, deletes the eBay path end to end, and makes `money()` return `None` with explicit handling at every call site.

## Current state

All excerpts from commit `071b8bb`; plans 001/002 touch other regions of these files but none of the lines quoted here (exception noted inline for `sales_history_points`).

**`scripts/update-prices.py`** (653 lines):

- Docstring mentions eBay at lines 3, 8-9, 13 (`EBAY_APP_ID — eBay Browse API app ID for real sold-comp data`).
- Line 41: `EBAY_APP_ID = os.environ.get('EBAY_APP_ID')`.
- Lines 216-250: the whole `# ─── EBAY SOLD COMPS (OPTIONAL) ───` section with `fetch_ebay_sold()`. Its own comment at line 221: `# eBay Finding API — completed listings endpoint (deprecated but still works for sold comps)` — it no longer works; eBay decommissioned `findCompletedItems` in early 2025.
- Lines 130-134, the zero-coercion:
  ```python
  def money(value):
      try:
          return float(value)
      except (TypeError, ValueError):
          return 0.0
  ```
- Lines 537-542, the kept-quote branch (price preserved, no marker):
  ```python
  else:
      # keep previous price, just refresh derived metrics
      price = prev_quote.get('price', 0)
      listings = prev_quote.get('listings', 0)
      kept += 1
      print(f'  · {code}: kept ${price} (no fresh data)')
  ```
- Lines 544-550, the eBay blend (note it overwrites `price` in place):
  ```python
  # Optional eBay enrichment
  if EBAY_APP_ID and price > 0:
      ebay = fetch_ebay_sold(f'one piece {code} booster box english sealed', EBAY_APP_ID)
      if ebay:
          price = round((price + ebay['avg_sold']) / 2, 2)  # blend
          ebay_updates += 1
  ```
- Lines 590-606, the emitted quote — `lastUpdated` is stamped `now` even for kept quotes:
  ```python
  new_quotes[code] = {
      'price': price,
      ...
      'signal': compute_signal(price, change30d, high52w, low52w, s['status']),
      'lastUpdated': datetime.now(timezone.utc).isoformat(),
  }
  ```
- Line 516: `fetched, kept, ebay_updates = 0, 0, 0`; line 610: `live_updates = fetched + ebay_updates`; line 629: `'source': 'tcgplayer initial scrape' if INITIAL_SCRAPE else 'tcgplayer' + (' + ebay' if EBAY_APP_ID else '')`; line 635 prints `{ebay_updates} eBay-enriched`.
- `money()` appears exactly **14 times** in the file (1 def + 13 uses): lines 149, 150, 151 (`fetch_tcgplayer_price`), 160 (`sellers`), 191 (`totalResults`), 293 ×2 (`sale_total`), 297 (`sale_quantity`), 404 (`history_prices_since`), 414 (`price_at_or_before`), 430 (`history_sales_volume_since`), 563 ×2 (main-loop `prices`). Check: `grep -o "money(" scripts/update-prices.py | wc -l` → `14`. (`fetch_ebay_sold` uses raw `float()`, not `money()`, so its deletion does not change this count; plan 002's `prune_history` adds two more None-safe uses — see Step 3 note.)

**`src/Dashboard.jsx`**:

- Lines 257-260, the metadata/quote merge with fallback defaults:
  ```js
  return SET_METADATA.map(meta => ({
    ...meta,
    ...(market.quotes[meta.code] || { price: 0, change30d: 0, high52w: 0, low52w: 0, volume30d: 0, listings: 0, soldLast7d: 0, bid: 0, ask: 0, spread: 0, rsi: 50, momentum: 'neutral', signal: 'HOLD' }),
  }));
  ```
- Lines 622-626, the order-book status badges (the pattern the CACHED badge should match):
  ```js
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
    <TierBadge tier={s.tier} />
    {s.status === 'rotated' && <span style={{ fontSize: 9, color: t.textDim, padding: '2px 5px', background: t.bgTertiary }}>ROTATED</span>}
    {s.status === 'preorder' && <span style={{ fontSize: 9, color: t.info, padding: '2px 5px', background: `${t.info}10` }}>PREORDER</span>}
  </div>
  ```
- Line 766, the data note, claims eBay blending: `...auto-updated by GitHub Actions hourly from TCGPlayer (and eBay sold comps if EBAY_APP_ID secret is configured).`

**`.github/workflows/update-prices.yml`** line 37: `EBAY_APP_ID: ${{ secrets.EBAY_APP_ID }}` (a secret *reference* — the value lives only in GitHub repo settings; after removal, ask the operator to also delete the secret from Settings → Secrets, which you cannot do from the CLI without push access).

**`README.md`**: eBay claims at line 14 ("Live tape ... across TCGPlayer, eBay, Cardmarket" — the tape is TCGPlayer-only in reality), line 68 (diagram: "(optional) eBay Browse API for sold comps"), and the section at lines 138-143 ("### Enable real eBay sold-comp data"). Line 163's "verify the live quote on TCGPlayer/eBay" is buyer guidance, not a feature claim — keep it.

**Repo constraints**: stdlib-only Python scraper; no test/lint scripts (`package.json`: `dev`, `build`, `preview`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build frontend | `npm ci && npm run build` | exit 0 |
| Scraper dry run (network) | `DRY_RUN=1 python3 scripts/update-prices.py` | exit 0, no file writes (write calls sit after the `if DRY_RUN: return` guard) |
| Module-level checks (no network) | `python3 -c "import importlib.util; ..."` one-liners below | as stated per step |
| Scope check | `git status --porcelain` | only in-scope files |

## Scope

**In scope** (the only files you should modify):
- `scripts/update-prices.py`
- `src/Dashboard.jsx` (defaults object, one badge, one sentence in the data note)
- `.github/workflows/update-prices.yml` (one env line)
- `README.md` (the three eBay claims listed above)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `public/data/*.json` — the new `stale` field appears in `market.json` only via future bot runs; never hand-edit.
- The refuse-to-write safety guards at `scripts/update-prices.py:612-623` — they are correct; keep them exactly.
- `compute_signal`, `compute_rsi`, history/retention logic — plans 002/004 own those.
- `market.source` display in the header (`Dashboard.jsx:420`) — works as-is once the source string is simplified.
- README line 163's buyer guidance mentioning eBay.

## Git workflow

- Branch: `advisor/003-provenance-staleness-ebay-removal`
- Three logical commits, Conventional Commits style: `refactor: remove dead eBay Finding API path`, `fix: truthful lastUpdated and stale flag for cached quotes`, `fix: money() returns None for malformed numbers`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Delete the eBay path

In `scripts/update-prices.py`:
1. Delete the entire `# ─── EBAY SOLD COMPS (OPTIONAL) ───` section (lines 216-250, `fetch_ebay_sold` inclusive).
2. Delete line 41 (`EBAY_APP_ID = os.environ.get('EBAY_APP_ID')`).
3. Delete the enrichment block (lines 544-550, quoted in "Current state").
4. Line 516: `fetched, kept, ebay_updates = 0, 0, 0` → `fetched, kept = 0, 0`.
5. Line 610: `live_updates = fetched + ebay_updates` → `live_updates = fetched`.
6. Line 629: source becomes `'source': 'tcgplayer initial scrape' if INITIAL_SCRAPE else 'tcgplayer',`.
7. Line 635: drop `{ebay_updates} eBay-enriched, ` from the summary print.
8. Docstring: remove the eBay mentions at lines 3, 8-9, 13 (keep the rest of the docstring intact).

In `.github/workflows/update-prices.yml`: delete line 37 (`EBAY_APP_ID: ${{ secrets.EBAY_APP_ID }}`).

In `README.md`: line 14 → "Live tape of recent sales from TCGPlayer"; line 68 → delete the diagram row about eBay; delete the whole "### Enable real eBay sold-comp data" section (lines 138-143).

In `src/Dashboard.jsx` line 766: change "...hourly from TCGPlayer (and eBay sold comps if EBAY_APP_ID secret is configured)." to "...hourly from TCGPlayer."

**Verify**:
```bash
grep -rin "EBAY_APP_ID" scripts src .github README.md
```
→ no output.
```bash
grep -ci "ebay" scripts/update-prices.py .github/workflows/update-prices.yml
```
→ `0` for both files.
```bash
python3 -c "import importlib.util; spec=importlib.util.spec_from_file_location('up','scripts/update-prices.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print('OK')"
```
→ `OK` (no NameError from a missed `ebay_updates`/`EBAY_APP_ID` reference).

Report to the operator: the `EBAY_APP_ID` repo secret (GitHub Settings → Secrets and variables → Actions) is now unused and should be deleted there. Do not attempt this yourself.

### Step 2: Truthful lastUpdated + stale flag

In `scripts/update-prices.py`, in the quote dict (lines 590-606 region), replace the `lastUpdated` line and add `stale`:

```python
        'signal': compute_signal(price, change30d, high52w, low52w, s['status']),
        'stale': not has_live_price,
        'lastUpdated': (datetime.now(timezone.utc).isoformat() if has_live_price
                        else prev_quote.get('lastUpdated') or datetime.now(timezone.utc).isoformat()),
    }
```

Semantics: a live fetch stamps now; a kept quote carries the timestamp of the run that actually observed its price (falling back to now only if the previous quote predates this field). The run-level `updatedAt`/`fetched`/`kept` fields (lines 627-632) stay as they are.

In `src/Dashboard.jsx`:
1. In the defaults object (line 259), add `stale: true` (a set with no quote at all is by definition not live data):
   ```js
   ...(market.quotes[meta.code] || { price: 0, ..., signal: 'HOLD', stale: true }),
   ```
2. In the order-book badges block (lines 622-626, quoted above), add after the PREORDER badge:
   ```js
   {s.stale && s.price > 0 && <span style={{ fontSize: 9, color: t.warn, padding: '2px 5px', background: `${t.warn}10` }}>CACHED</span>}
   ```
   (`s.price > 0` keeps zero-price placeholder rows, which already render `—`, from collecting a noise badge. Style matches the sibling badges exactly.)

**Verify**: `npm ci && npm run build` → exit 0. `grep -n "stale" src/Dashboard.jsx` → exactly 2 matches (defaults + badge). `grep -n "stale" scripts/update-prices.py` → 1 match. Note: existing `market.json` quotes have no `stale` key until the next bot run; `undefined` is falsy so no badge shows — correct behavior for pre-migration data.

### Step 3: money() returns None — enumerated call-site changes

First confirm the enumeration is still complete: `grep -o "money(" scripts/update-prices.py | wc -l` → `14` at commit `071b8bb`. **If plan 002 landed first, expect `16`** (its `prune_history` adds two already-None-safe uses: `price = money(row.get('price'))` guarded by `if price and price > 0`). Any other count → STOP.

1. Redefine (lines 130-134):
   ```python
   def money(value):
       """Parse a numeric field; None when absent or malformed (never 0.0)."""
       try:
           return float(value)
       except (TypeError, ValueError):
           return None
   ```

2. `fetch_tcgplayer_price` (lines 149-163): the `if not market_price` guards already treat `None` and `0.0` alike; normalize only the returned record so downstream keeps its falsy-means-absent contract:
   ```python
   return {
       'marketPrice': market_price,
       'lowPrice': low_price or 0.0,
       'lowestPriceWithShipping': low_with_shipping or 0.0,
       'listings': int(money(data.get('sellers')) or 0),
       'productName': data.get('productName', ''),
       'sku': (data.get('skus') or [{}])[0].get('sku'),
   }
   ```
   (Inside an emitted record, `0.0` legitimately means "not offered/absent" — downstream at line 585 already treats it as falsy. The point of this plan is that *parsing* no longer invents zeros; boundary normalization here is explicit and commented by the `or 0.0`.)

3. `fetch_tcgplayer_listings` line 191: `'totalResults': int(money(result.get('totalResults')) or 0),`

4. `sale_total` (lines 292-293) — the actual bug fix; a sale with unparseable price must be dropped, not priced at shipping:
   ```python
   def sale_total(sale):
       price = money(sale.get('purchasePrice'))
       if price is None:
           return None
       return price + (money(sale.get('shippingPrice')) or 0.0)
   ```

5. `sale_quantity` (line 297): unchanged — `int(money(sale.get('quantity')) or 1)` already handles `None`.

6. `sales_history_points`: the filter line (currently `if not label or price <= 0: continue`, line 378) becomes:
   ```python
   if not label or not price or price <= 0:
       continue
   ```

7. `sale_transactions_for_interval` (line 452): `if total <= 0: continue` becomes:
   ```python
   if not total or total <= 0:
       continue
   ```
   (`sale_transaction_id` at lines 434-438 also calls `sale_total`, but only ever after this positive check at line 455 — leave it as is.)

8. `history_prices_since` (lines 404-405): `if price > 0 and parsed and parsed >= cutoff:` becomes `if price and price > 0 and parsed and parsed >= cutoff:` (short-circuit prevents `None > 0`).

9. `price_at_or_before` (line 415): same pattern → `if price and price > 0 and parsed and parsed <= cutoff:`

10. `history_sales_volume_since` (line 430): `total += max(0, int(money(row.get('volume')) or 0))`

11. Main loop (line 563): replace
    ```python
    prices = [money(h.get('price')) for h in hist if money(h.get('price')) > 0]
    ```
    with
    ```python
    prices = [p for p in (money(h.get('price')) for h in hist) if p and p > 0]
    ```

12. If plan 002 landed: confirm `prune_history` uses the guarded pattern `price = money(row.get('price'))` / `if price and price > 0:` — it does per that plan; no change.

**Verify** (no network):
```bash
python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('up', 'scripts/update-prices.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
assert m.money(None) is None and m.money('garbage') is None and m.money('3.5') == 3.5 and m.money(0) == 0.0
assert m.sale_total({'purchasePrice': 'garbage', 'shippingPrice': '13.99'}) is None
assert m.sale_total({'purchasePrice': '400', 'shippingPrice': None}) == 400.0
assert m.sale_quantity({'quantity': 'garbage'}) == 1
assert m.sales_history_points([{'orderDate': '2026-07-13T16:30:01.19+00:00', 'purchasePrice': 'garbage', 'quantity': 1}]) == []
assert m.history_prices_since([{'date': '2026-07-01T10:00Z', 'price': 'garbage'}], 30, __import__('datetime').datetime(2026, 7, 13, tzinfo=__import__('datetime').timezone.utc)) == []
print('OK')
"
```
→ prints `OK`. (The `2026-07-01T10:00Z` date format assumes plan 002 landed; if running pre-002, use `'2026-07-01 10:00'` instead.)

### Step 4 (optional, requires network): end-to-end dry run

`DRY_RUN=1 python3 scripts/update-prices.py` → exit 0; summary line no longer mentions eBay; `git status --porcelain public/data/` → empty.

## Test plan

No test framework exists (do not add one). Gates: the importlib assertions above (they cover: malformed price dropped, shipping-only sale no longer synthesized, garbage quantity defaults to 1, garbage history price filtered), the grep assertions for eBay removal, and `npm run build`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rin "EBAY_APP_ID" scripts src .github README.md` → empty
- [ ] `grep -ci "ebay" scripts/update-prices.py` → `0`
- [ ] Step 3's importlib assertion block prints `OK`
- [ ] `grep -o "money(" scripts/update-prices.py | wc -l` → same count as pre-change (14, or 16 post-plan-002) — no call site added or lost
- [ ] `npm run build` exits 0
- [ ] `grep -c "stale" scripts/update-prices.py` → `1`; `grep -c "stale" src/Dashboard.jsx` → `2`
- [ ] `git status --porcelain` shows only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `money(` occurrence count is anything other than 14 (or 16 post-plan-002) — an unenumerated call site exists whose 0.0-vs-None semantics this plan has not decided. Do not guess; report the site.
- Any call site's intended semantics is ambiguous to you after reading its surrounding code — e.g. you cannot tell whether a `0` there means "absent" or "genuinely zero". Report the exact line instead of choosing.
- The quote-dict excerpt (lines 590-606) or the kept-branch excerpt (lines 537-542) doesn't match the live code beyond plans 001/002's documented edits.
- The importlib module-load check fails after Step 1 — a dangling eBay reference remains somewhere this plan didn't list.
- You find any *hardcoded* credential while editing (none exist at planning time — `EBAY_APP_ID`/`TCGPLAYER_BEARER` are env-var references only). Reference its location and type in your report; never copy the value.

## Maintenance notes

- If a second price source is ever added, it must be a **separate field** on the quote (e.g. `ebayAvgSold`), never blended into `price` — blending is what poisoned history provenance before.
- The `stale` flag is per-quote; the run-level `fetched`/`kept` counts in `market.json` and the footer (`Dashboard.jsx:772`) remain the aggregate view. A reviewer should check that a simulated fetch failure (e.g. run with networking blocked after warming the cache) yields `stale: true` with an old `lastUpdated`.
- Deferred: surfacing per-quote `lastUpdated` in the detail panel UI — nice-to-have, not part of this plan.
- Deferred: the operator must delete the now-unused `EBAY_APP_ID` GitHub secret.
