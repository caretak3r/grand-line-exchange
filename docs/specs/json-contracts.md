# JSON Contract Specs

Field-by-field contracts for the four files under `public/data/` and the one
under `src/data/`. Derived by reading `scripts/update-prices.py` (the sole
writer of `public/data/*`) and the current committed data files, not
invented. Every field below is traced to the line that produces it.

## `src/data/sets.json` — tracked-set metadata (hand-maintained, not scraper output)

A non-empty JSON array, one object per tracked booster box. Loaded and
strictly validated by `load_sets()` (`update-prices.py:44-61`): missing keys,
non-integer `msrp`, non-numeric-string `tcgProductId`, or a duplicate `code`
all hard-fail the scraper before any network call.

| Field | Type | Semantics |
|---|---|---|
| `code` | string | Unique set identifier used as the key into `market.json.quotes` and `history.json` (e.g. `"OP-01"`, `"OP-01-W2"`). |
| `name` | string | Full display name (e.g. `"Romance Dawn"`). |
| `short` | string | Shortened display name for tight UI space. |
| `released` | string (`YYYY-MM-DD`) | Release date; seeds the `release date` history anchor via `release_anchor()`. |
| `msrp` | integer | MSRP in USD; must be a JSON integer, not a float (enforced). |
| `block` | integer | Set-era grouping (observed values: `0`-`4` across the current 22 sets). |
| `status` | string enum | `"active"` \| `"rotated"` \| `"preorder"` (observed). Feeds `compute_signal()` — `"preorder"` short-circuits to `PREORDER` regardless of price action (`update-prices.py:201-202`). |
| `tier` | string enum | `"grail"` \| `"premium"` \| `"mid"` \| `"value"` (observed). Display-only; not read by the scraper's pricing logic. |
| `tcgProductId` | string of digits | TCGPlayer product ID; must satisfy `.isdigit()`. Used to build every TCGPlayer API URL. |
| `tcgUrl` | string | Direct product page link, shown as "View on TCGPlayer" in the UI. |
| `notes` | string | Freeform display copy. |

## `public/data/market.json` — latest quote snapshot (overwritten in full every run)

```json
{
  "updatedAt": "2026-07-17T12:38:47.962377+00:00",
  "source": "tcgplayer",
  "fetched": 22,
  "kept": 0,
  "quotes": { "OP-01": { "...": "..." } }
}
```

Top level (`update-prices.py:636-642`):

| Field | Type | Semantics |
|---|---|---|
| `updatedAt` | string, ISO-8601 UTC offset | Wall-clock time the file was written — always `datetime.now(timezone.utc).isoformat()`, regardless of any individual set's fetch outcome. |
| `source` | string | `"tcgplayer"` for a normal run, `"tcgplayer initial scrape"` when `INITIAL_SCRAPE=1`. |
| `fetched` | integer | Count of sets that got a fresh live price this run. |
| `kept` | integer | Count of sets that fell back to the previous cached price this run. |
| `quotes` | object, keyed by `code` | One entry per tracked set (write refuses if any tracked `code` is missing — `update-prices.py:630-632`). |

Per-quote object, in write order (`update-prices.py:597-615`):

| Field | Type | Semantics |
|---|---|---|
| `price` | number | Current market price; live `marketPrice` if fetched, else carried-over previous price (possibly `0`). |
| `prev` | number | Previous run's `price` (the pre-update value), used as the prior-quote baseline; on `INITIAL_SCRAPE` equals `price`. |
| `change30d` | number (%, 1dp) | `(price - price_30d_ago) / price_30d_ago * 100`, from `price_at_or_before(hist, now - 30d)`. If no 30d-ago point exists yet: under `INITIAL_SCRAPE` with 2+ known prices, approximates using the earliest known price as the baseline instead; otherwise falls back to the previous quote's `change30d` (`update-prices.py:577-583`). |
| `high52w` / `low52w` | number | Max/min of positive prices in `history_prices_since(hist, 365, now)` (falls back to all-time prices if the set has less than 365 days of history). |
| `volume30d` | integer | Sum of `tcgplayer latest sale` row volumes in the last 30 days (`history_sales_volume_since`); frozen at the previous value on a run where sales fetch failed entirely (`latest_sales is None`). |
| `soldLast7d` | integer | Same as above, 7-day window. |
| `listings` | integer | Active seller count — `totalResults` from the listings snapshot, or `live.listings`, or the previous quote's count. |
| `bid` | number | `round(min(price, ask) * 0.95, 2)`. |
| `ask` | number | `lowestPriceWithShipping`, else `lowPrice`, else `price * 1.05`, rounded. |
| `spread` | number (%, 1dp) | `(ask - bid) / max(1, (bid+ask)/2) * 100`; `0` when `price` is `0`. |
| `rsi` | integer 0-100 | Wilder RSI-14 over `daily_closes(hist)`; defaults to `50` when fewer than 15 daily closes exist. |
| `momentum` | string enum | `"bullish"` (`change30d > 4`) \| `"bearish"` (`change30d < -3`) \| `"neutral"`. |
| `signal` | string enum | `PREORDER` \| `STRONG BUY` \| `BUY` \| `WATCH` \| `HOLD`, from `compute_signal()` (see the signal table in `README.md`). |
| `stale` | boolean | **In current `update-prices.py` code** (`:612`), `not has_live_price` — true when this run fell back to a cached price. **Not yet present in the currently-committed `public/data/market.json`**: the file on disk was last written by a bot commit whose scraper version predated the `stale` field (merged in afterward via `git merge`); it will appear starting with the next scheduled run. Don't assume its absence today means the field was removed. |
| `lastUpdated` | string, ISO-8601 UTC offset | Timestamp of the live fetch if this run got one, else the previous quote's `lastUpdated` (or now, if that's also missing) — i.e. genuinely tracks "when was this last a real quote," never resets to "now" on a cache-hit. |

## `public/data/history.json` — per-set price history (365d window + monthly spine)

Object keyed by set `code` → array of row objects, sorted by `history_sort_key`
(parsed timestamp, ascending). Three row shapes share one schema
(`release_anchor()`, `current_market_point()`, `sales_history_points()`):

| Field | Type | Semantics |
|---|---|---|
| `date` | string | `YYYY-MM-DD` for the release anchor; `YYYY-MM-DDTHH:MMZ` for market/sale points. Parsed by `parse_datetime()`, which normalizes trailing `Z`, space-separated, and date-only forms, and always returns UTC-aware. |
| `price` | number \| null | `null` only for the `release date` anchor row. Sale/market rows are always a positive rounded float. |
| `volume` | integer | `0` for the release anchor, `1` for a market snapshot, sale quantity (`>= 1`) for a sale row. |
| `source` | string enum | `"release date"` \| `"tcgplayer current market"` \| `"tcgplayer latest sale"`. Drives `daily_closes()`'s market-wins-else-median-of-sales rule and `history_row_key()`'s dedup grouping. |
| `confidence` | string enum | `"reference"` for the release anchor (no real price), `"verified"` for market/sale rows. |

Retention: rows are pruned by `prune_history()` once their `YYYY-MM` bucket's
month-end is older than `now - 365 days` — see
`docs/specs/scrape-cycle-sequence.md` invariant 5. Pruned rows move to
`history-archive.json` (identical schema, keyed by `code`, same row shape);
as of this writing the archive is empty (`{}`) because no set's history has
yet aged past the 365-day cutoff.

## `public/data/transactions.json` — live sale tape (rolling, max 100)

A flat JSON array, most-recent-first, capped at 100 entries by
`compact_transactions()` (`update-prices.py:480-499`). Every entry currently
has `"type": "SOLD"` — `compact_transactions()` filters out any non-`SOLD`
row, so the type field is a vestigial extension point rather than an
observed variant.

| Field | Type | Semantics |
|---|---|---|
| `id` | string | `"{code}-sold-{orderDate}-{qty}-{cents}"`, built by `sale_transaction_id()`; doubles as the dedup key across runs (`existing_txn_ids`). |
| `set` | string | Set `code`. |
| `type` | string | Always `"SOLD"` in current output. |
| `price` | number | `purchasePrice + shippingPrice` (total paid), rounded to 2dp — `sale_total()`. |
| `venue` | string | Always `"TCGPlayer"`. |
| `timestamp` | string, ISO-8601 | The sale's `orderDate` as reported by TCGPlayer, or a fresh `now()` if absent. |
| `qty` | integer | `max(1, quantity)` — `sale_quantity()`. |

New rows are only appended for sales strictly after the previous run's
`updatedAt` (`interval_start`, `update-prices.py:519`, `:459`), so the tape
never re-adds a sale it already recorded, and a full rebuild only happens
under `INITIAL_SCRAPE=1` (`history`/`txns`/`archive` are reset to empty
first — `update-prices.py:513-516`).
