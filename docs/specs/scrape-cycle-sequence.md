# Sequence Diagram: One Scrape Cycle

One iteration of the `for s in sets:` loop in `scripts/update-prices.py::main()`
(lines 530-615), for a single tracked set. This traces the three TCGPlayer
calls, the fetch-fallback chain (which only exists on one of the three
calls), the per-set-failure fallback, history dedup, and the retention/
archive split.

```mermaid
sequenceDiagram
    participant Main as main() loop
    participant Price as fetch_tcgplayer_price()
    participant List as fetch_tcgplayer_listings()
    participant Sales as fetch_tcgplayer_latest_sales()
    participant Urllib as request_json()\n(urllib)
    participant Curl as curl_json()\n(subprocess curl)
    participant TCG as TCGPlayer API

    Main->>Price: fetch_tcgplayer_price(product_id)
    Price->>Urllib: request_json(details_url)\ncurl_fallback=False
    Urllib->>TCG: GET /v2/product/{id}/details
    alt success
        TCG-->>Urllib: 200 JSON
        Urllib-->>Price: marketPrice, lowPrice, listings, productName
    else HTTPError / URLError / timeout / bad JSON
        TCG-->>Urllib: error
        Urllib-->>Price: raises (no curl fallback here)
        Price-->>Main: None
    end

    alt live price fetched (has_live_price = True)
        Main->>List: fetch_tcgplayer_listings(product_id)
        List->>Urllib: request_json(listings_url, body)\ncurl_fallback=False
        Urllib->>TCG: POST /v1/product/{id}/listings
        TCG-->>Urllib: 200 JSON (or error -> {totalResults:0, listings:[]})
        Urllib-->>List: totalResults, listings
        List-->>Main: listings snapshot

        Main->>Sales: fetch_tcgplayer_latest_sales(product_id, productName)
        Sales->>Urllib: request_json(latestsales_url, body={})\ncurl_fallback=True
        Urllib->>TCG: POST /v2/product/{id}/latestsales
        alt urllib succeeds
            TCG-->>Urllib: 200 JSON
            Urllib-->>Sales: sales data
        else urllib fails (HTTPError/URLError/timeout/bad JSON)
            Urllib-->>Sales: falls back
            Sales->>Curl: curl_json(latestsales_url, body={})
            Curl->>TCG: POST via curl subprocess
            TCG-->>Curl: JSON (or CalledProcessError)
            Curl-->>Sales: sales data (or exception)
        end
        Sales-->>Main: sales filtered to\nUnopened/English/no-photo-listing/name-match\n(or None on total failure)
    else no live price
        Note over Main: listings_snapshot = {totalResults:0, listings:[]}\nlatest_sales = None\n(List and Sales are NOT called)
    end

    Main->>Main: has_live_price?\nyes -> price = live.marketPrice, fetched += 1\nno  -> price = prev_quote.price (or 0), kept += 1\n       (per-set failure keeps previous value)

    Main->>Main: build_verified_history\nexisting, release_date, sales_for_history, price, today
    Note over Main: merge_history_points dedups rows via history_row_key:\nrelease-date and current-market rows collapse to one per UTC day,\nsale rows key on the full source/date/price/volume tuple\nso distinct same-day sales both survive

    Main->>Main: prune_history\nhist, now
    Note over Main: months whose month-end is older than now minus 365 days\nare pruned: keep the last positive-price row as a spine\nplus release anchors, move the rest to the archive

    Main->>Main: compute_rsi(daily_closes(hist)), compute_signal(),\nchange30d, high52w/low52w, bid/ask/spread
    Main-->>Main: new_quotes[code] = {...}, stale = not has_live_price
```

## Key invariants this diagram encodes

1. **Only one of the three TCGPlayer calls has a curl fallback** —
   `fetch_tcgplayer_latest_sales()` passes `curl_fallback=True` to
   `request_json()` (`update-prices.py:182`); `fetch_tcgplayer_price()` and
   `fetch_tcgplayer_listings()` do not, so a urllib failure there is terminal
   for that call (`update-prices.py:127`, `:168`).
2. **A per-set price-fetch failure never blocks the run.** `has_live_price`
   gates the branch; on failure the set keeps `prev_quote.get('price', 0)`
   and `prev_quote.get('listings', 0)`, increments `kept` instead of
   `fetched`, and the resulting quote is marked `stale: True`
   (`update-prices.py:548-553`, `:612`).
3. **Listings and sales are only fetched when the price fetch succeeded** —
   `fetch_tcgplayer_listings(...) if live else {...}` and
   `fetch_tcgplayer_latest_sales(...) if live else None`
   (`update-prices.py:535-536`).
4. **Dedup is key-based, not date-based.** `history_row_key()` collapses
   `release date` and `tcgplayer current market` rows to one per UTC day
   (repeated hourly runs don't pile up duplicate "current market" points),
   while `tcgplayer latest sale` rows key on the full tuple so two distinct
   sales on the same day both survive (`update-prices.py:308-313`).
5. **Retention is month-granular, not row-granular.** `prune_history()`
   buckets by `YYYY-MM`; a month is only pruned once its month-end falls
   before `now - 365 days`, and pruning keeps exactly one spine row (the
   month's last positive-price row) plus any `release date` anchors —
   everything else in that month moves to `history-archive.json`
   (`update-prices.py:326-356`).
6. **Whole-run failure is refuse-to-write, not partial-write.** If zero
   sets fetched live prices *and* there's no cached positive quote to fall
   back on, or if any tracked set ends up with no quote at all, `main()`
   raises before touching disk (`update-prices.py:621-632`) — the "a failed
   run leaves existing JSON untouched" guarantee from the module docstring.
