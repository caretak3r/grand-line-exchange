#!/usr/bin/env python3
"""
update-prices.py — Fetches live booster box prices from TCGPlayer,
updates public/data/market.json + history.json + transactions.json, and writes a summary.

Designed to run from GitHub Actions on a schedule. Resilient by design:
  - If a fetch fails for any individual set, it keeps the previous value.
  - If the entire run fails, the existing JSON is left untouched.

Usage:  python scripts/update-prices.py
Env vars (all optional):
  TCGPLAYER_BEARER  — TCGPlayer API bearer if you have partner access; otherwise public scrape
  DRY_RUN=1         — print but don't write
  INITIAL_SCRAPE=1  — rebuild public/data from live TCGPlayer market/listing/sales endpoints
"""

import json
import os
import subprocess
import sys
import time
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ─── PATHS ─────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / 'public' / 'data'
MARKET = DATA_DIR / 'market.json'
HISTORY = DATA_DIR / 'history.json'
TXNS = DATA_DIR / 'transactions.json'
SETS_JSON = ROOT / 'src' / 'data' / 'sets.json'
ARCHIVE = DATA_DIR / 'history-archive.json'
RETENTION_DAYS = 365

DRY_RUN = os.environ.get('DRY_RUN') == '1'
INITIAL_SCRAPE = os.environ.get('INITIAL_SCRAPE') == '1'
TCGPLAYER_BEARER = os.environ.get('TCGPLAYER_BEARER')
TCGPLAYER_MPFEV = '5106'

# ─── LOAD SET METADATA FROM sets.json ──────────────────────────────────────
def load_sets():
    """Load tracked product metadata; fail loudly on any malformed entry."""
    sets = json.loads(SETS_JSON.read_text())
    if not isinstance(sets, list) or not sets:
        raise RuntimeError(f'{SETS_JSON} must be a non-empty JSON array')
    seen = set()
    for s in sets:
        for key in ('code', 'name', 'released', 'msrp', 'status', 'tcgProductId'):
            if key not in s:
                raise RuntimeError(f'sets.json entry missing {key!r}: {s}')
        if not isinstance(s['msrp'], int):
            raise RuntimeError(f"sets.json msrp must be an integer for {s['code']}")
        if not isinstance(s['tcgProductId'], str) or not s['tcgProductId'].isdigit():
            raise RuntimeError(f"sets.json tcgProductId must be a numeric string for {s['code']}")
        if s['code'] in seen:
            raise RuntimeError(f"Duplicate set code in sets.json: {s['code']}")
        seen.add(s['code'])
    return sets

# ─── TCGPLAYER FETCHING ────────────────────────────────────────────────────
USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)

def http_get(url, timeout=15):
    req = Request(url, headers={
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    })
    with urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='replace')


def tcgplayer_headers(product_id=None):
    headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.tcgplayer.com',
    }
    if TCGPLAYER_BEARER:
        headers['Authorization'] = f'Bearer {TCGPLAYER_BEARER}'
    if product_id:
        headers['Referer'] = f'https://www.tcgplayer.com/product/{product_id}'
    return headers


def curl_json(url, body=None, timeout=15, product_id=None):
    headers = tcgplayer_headers(product_id)
    cmd = ['curl', '-sS', '--max-time', str(timeout)]
    if body is not None:
        cmd.extend(['-X', 'POST', '-H', 'Content-Type: application/json'])
    for key, value in headers.items():
        cmd.extend(['-H', f'{key}: {value}'])
    if body is not None:
        cmd.extend(['--data', json.dumps(body)])
    cmd.append(url)
    out = subprocess.check_output(cmd, text=True)
    return json.loads(out)


def request_json(url, body=None, timeout=15, product_id=None, curl_fallback=False):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    headers = tcgplayer_headers(product_id)
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = Request(url, data=data, headers=headers, method='POST' if body is not None else 'GET')
    try:
        with urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8', errors='replace'))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as e:
        if curl_fallback:
            return curl_json(url, body=body, timeout=timeout, product_id=product_id)
        raise e


def money(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def fetch_tcgplayer_price(product_id):
    """
    Fetch market data from TCGPlayer's marketplace endpoint.
    Returns dict {marketPrice, lowPrice, lowestPriceWithShipping, listings, productName} or None.
    """
    url = f'https://mp-search-api.tcgplayer.com/v2/product/{product_id}/details?mpfev={TCGPLAYER_MPFEV}'
    try:
        data = request_json(url, product_id=product_id)
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError) as e:
        print(f'  fetch failed for {product_id}: {e}')
        return None

    market_price = money(data.get('marketPrice'))
    low_price = money(data.get('lowestPrice'))
    low_with_shipping = money(data.get('lowestPriceWithShipping'))
    if not market_price and (low_with_shipping or low_price):
        market_price = low_with_shipping or low_price
    if not market_price:
        return None
    return {
        'marketPrice': market_price,
        'lowPrice': low_price,
        'lowestPriceWithShipping': low_with_shipping,
        'listings': int(money(data.get('sellers'))),
        'productName': data.get('productName', ''),
        'sku': (data.get('skus') or [{}])[0].get('sku'),
    }


def fetch_tcgplayer_listings(product_id, size=3):
    url = f'https://mp-search-api.tcgplayer.com/v1/product/{product_id}/listings?mpfev={TCGPLAYER_MPFEV}'
    body = {
        'from': 0,
        'size': size,
        'sort': {'field': 'price+shipping', 'order': 'asc'},
        'filters': {
            'term': {
                'sellerStatus': 'Live',
                'channelId': 0,
                'language': ['English'],
                'listingType': 'standard',
            },
            'range': {'quantity': {'gte': 1}},
            'exclude': {'listingType': 'custom'},
        },
        'context': {'cart': {}, 'shippingCountry': 'US'},
    }
    try:
        data = request_json(url, body=body, product_id=product_id)
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError) as e:
        print(f'  listings fetch failed for {product_id}: {e}')
        return {'totalResults': 0, 'listings': []}
    result = (data.get('results') or [{}])[0]
    return {
        'totalResults': int(money(result.get('totalResults'))),
        'listings': result.get('results') or [],
    }


def fetch_tcgplayer_latest_sales(product_id, product_name=''):
    url = f'https://mpapi.tcgplayer.com/v2/product/{product_id}/latestsales?mpfev={TCGPLAYER_MPFEV}'
    try:
        data = request_json(url, body={}, product_id=product_id, curl_fallback=True)
        product_name = product_name.strip().lower()
        sales = []
        for sale in data.get('data') or []:
            if sale.get('condition') != 'Unopened' or sale.get('language') != 'English':
                continue
            if sale.get('listingType') != 'ListingWithoutPhotos' or str(sale.get('customListingId')) != '0':
                continue
            if product_name and sale.get('title', '').strip().lower() != product_name:
                continue
            sales.append(sale)
        return sales
    except (subprocess.CalledProcessError, URLError, HTTPError, TimeoutError, json.JSONDecodeError) as e:
        print(f'  latest sales fetch failed for {product_id}: {e}')
        return None


# ─── ANALYTICS ─────────────────────────────────────────────────────────────
def compute_signal(price, change30d, high52w, low52w, status):
    if status == 'preorder':
        return 'PREORDER'
    if price == 0:
        return 'HOLD'
    range_pos = (price - low52w) / max(1, (high52w - low52w))
    if change30d > 7 and range_pos < 0.6: return 'STRONG BUY'
    if change30d > 3: return 'BUY'
    if change30d < -4: return 'WATCH'
    if range_pos > 0.85: return 'WATCH'
    return 'HOLD'


def compute_rsi(prices):
    """Real Wilder RSI over the last 14 periods."""
    if len(prices) < 15:
        return 50
    gains, losses = [], []
    for i in range(1, len(prices)):
        d = prices[i] - prices[i-1]
        gains.append(max(0, d))
        losses.append(abs(min(0, d)))
    period = 14
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)))


def count_positive_quotes(quotes):
    return sum(1 for q in quotes.values() if q.get('price', 0) > 0)


def sale_total(sale):
    return money(sale.get('purchasePrice')) + money(sale.get('shippingPrice'))


def sale_quantity(sale):
    return max(1, int(money(sale.get('quantity')) or 1))


def parse_datetime(value):
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    if ' ' in text and 'T' not in text:
        text = text.replace(' ', 'T')
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text[:10], '%Y-%m-%d')
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def sale_date(sale):
    order_date = sale.get('orderDate') or ''
    return order_date[:10] if len(order_date) >= 10 else None


def history_sort_key(row):
    parsed = parse_datetime(row.get('date'))
    return parsed.timestamp() if parsed else 0


def history_row_key(row):
    source = row.get('source', 'legacy')
    date = str(row.get('date') or '')
    if source in ('release date', 'tcgplayer current market'):
        return (source, date[:10])
    return (source, date, row.get('price'), row.get('volume'))


def merge_history_points(*groups):
    merged = {}
    for group in groups:
        for row in group or []:
            if not row.get('date'):
                continue
            merged[history_row_key(row)] = row
    return sorted(merged.values(), key=history_sort_key)


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


def release_anchor(release_date):
    return {
        'date': release_date,
        'price': None,
        'volume': 0,
        'source': 'release date',
        'confidence': 'reference',
    } if release_date else None


def current_market_point(price, today):
    if price <= 0:
        return None
    return {
        'date': today,
        'price': price,
        'volume': 1,
        'source': 'tcgplayer current market',
        'confidence': 'verified',
    }


def sales_history_points(sales):
    points = []
    for sale in sales or []:
        parsed = parse_datetime(sale.get('orderDate'))
        label = parsed.strftime('%Y-%m-%dT%H:%MZ') if parsed else sale_date(sale)
        price = sale_total(sale)
        if not label or price <= 0:
            continue
        points.append({
            'date': label,
            'price': round(price, 2),
            'volume': sale_quantity(sale),
            'source': 'tcgplayer latest sale',
            'confidence': 'verified',
        })
    return points


def build_verified_history(existing, release_date, sales, current_price, today, reset=False):
    additions = [p for p in [
        release_anchor(release_date),
        current_market_point(current_price, today),
    ] if p]
    additions.extend(sales_history_points(sales or []))
    return merge_history_points([] if reset else existing, additions)


def history_prices_since(rows, days, now):
    cutoff = now - timedelta(days=days)
    prices = []
    for row in rows or []:
        price = money(row.get('price'))
        parsed = parse_datetime(row.get('date'))
        if price > 0 and parsed and parsed >= cutoff:
            prices.append(price)
    return prices


def price_at_or_before(rows, cutoff):
    candidates = []
    for row in rows or []:
        price = money(row.get('price'))
        parsed = parse_datetime(row.get('date'))
        if price > 0 and parsed and parsed <= cutoff:
            candidates.append((parsed, price))
    if not candidates:
        return None
    return sorted(candidates, key=lambda x: x[0])[-1][1]


def history_sales_volume_since(rows, days, now):
    cutoff = now - timedelta(days=days)
    total = 0
    for row in rows or []:
        if row.get('source') != 'tcgplayer latest sale':
            continue
        parsed = parse_datetime(row.get('date'))
        if parsed and parsed >= cutoff:
            total += max(0, int(money(row.get('volume'))))
    return total


def sale_transaction_id(code, sale, idx=0):
    order_date = sale.get('orderDate') or f'unknown-{idx}'
    cents = int(round(sale_total(sale) * 100))
    qty = sale_quantity(sale)
    return f'{code}-sold-{order_date}-{qty}-{cents}'


def transaction_sort_key(txn):
    parsed = parse_datetime(txn.get('timestamp'))
    return parsed.timestamp() if parsed else 0


def sale_transactions_for_interval(code, sales, interval_start, existing_ids):
    txns = []
    for idx, sale in enumerate(sales or []):
        sold_at = parse_datetime(sale.get('orderDate'))
        if interval_start and (not sold_at or sold_at <= interval_start):
            continue
        total = sale_total(sale)
        if total <= 0:
            continue
        txn_id = sale_transaction_id(code, sale, idx)
        if txn_id in existing_ids:
            continue
        existing_ids.add(txn_id)
        txns.append({
            'id': txn_id,
            'set': code,
            'type': 'SOLD',
            'price': round(total, 2),
            'venue': 'TCGPlayer',
            'timestamp': sale.get('orderDate') or datetime.now(timezone.utc).isoformat(),
            'qty': sale_quantity(sale),
        })
    return txns


def compact_transactions(txns, limit=100):
    compacted = []
    seen = set()
    for txn in sorted(txns or [], key=transaction_sort_key, reverse=True):
        if txn.get('type') != 'SOLD':
            continue
        key = txn.get('id') or (
            txn.get('set'),
            txn.get('type'),
            txn.get('timestamp'),
            txn.get('price'),
            txn.get('qty'),
        )
        if key in seen:
            continue
        seen.add(key)
        compacted.append(txn)
        if len(compacted) >= limit:
            break
    return compacted


# ─── MAIN UPDATE LOGIC ─────────────────────────────────────────────────────
def main():
    now = datetime.now(timezone.utc)
    print(f'─── Grand Line Exchange · price update · {now.isoformat()} ───')

    # Load existing state
    market = json.loads(MARKET.read_text()) if MARKET.exists() else {'quotes': {}}
    history = json.loads(HISTORY.read_text()) if HISTORY.exists() else {}
    txns = json.loads(TXNS.read_text()) if TXNS.exists() else []
    archive = json.loads(ARCHIVE.read_text()) if ARCHIVE.exists() else {}
    sets = load_sets()
    if INITIAL_SCRAPE:
        history = {}
        txns = []
        archive = {}
    else:
        txns = compact_transactions(txns)
    interval_start = None if INITIAL_SCRAPE else parse_datetime(market.get('updatedAt'))
    existing_txn_ids = {txn.get('id') for txn in txns if txn.get('id')}
    print(f'Loaded {len(sets)} tracked sets.')
    if interval_start:
        print(f'Only adding TCGPlayer sales after previous run: {interval_start.isoformat()}')

    today = now.strftime('%Y-%m-%dT%H:%MZ')
    new_quotes = {}
    fetched, kept = 0, 0
    new_txns = []

    for s in sets:
        code = s['code']
        prev_quote = market.get('quotes', {}).get(code, {})

        live = fetch_tcgplayer_price(s['tcgProductId'])
        listings_snapshot = fetch_tcgplayer_listings(s['tcgProductId']) if live else {'totalResults': 0, 'listings': []}
        latest_sales = fetch_tcgplayer_latest_sales(s['tcgProductId'], live.get('productName', '')) if live else None
        sales_for_history = latest_sales or []
        # polite: small delay between requests
        time.sleep(0.25 + random.random() * 0.25)

        has_live_price = bool(live and live.get('marketPrice'))
        if has_live_price:
            price = round(live['marketPrice'], 2)
            listings = listings_snapshot.get('totalResults') or live.get('listings') or prev_quote.get('listings', 0)
            fetched += 1
            print(f'  ✓ {code}: ${price} (listings={listings}) — {live.get("productName", "TCGPlayer")}')
            new_txns.extend(sale_transactions_for_interval(code, sales_for_history, interval_start, existing_txn_ids))
        else:
            # keep previous price, just refresh derived metrics
            price = prev_quote.get('price', 0)
            listings = prev_quote.get('listings', 0)
            kept += 1
            print(f'  · {code}: kept ${price} (no fresh data)')

        hist = build_verified_history(
            history.get(code, []),
            s.get('released'),
            sales_for_history,
            price if has_live_price else 0,
            today,
            reset=INITIAL_SCRAPE,
        )
        history[code] = hist
        hist, archived_rows = prune_history(hist, now)
        history[code] = hist
        if archived_rows:
            archive[code] = merge_history_points(archive.get(code, []), archived_rows)

        # Compute window metrics
        prices = [money(h.get('price')) for h in hist if money(h.get('price')) > 0]
        if not prices:
            continue
        prices_52w = history_prices_since(hist, 365, now) or prices
        high52w = max(prices_52w)
        low52w = min(prices_52w)
        # 30d change
        price_30d_ago = price_at_or_before(hist, now - timedelta(days=30))
        if price_30d_ago:
            change30d = round((price - price_30d_ago) / price_30d_ago * 100, 1) if price_30d_ago else 0
        elif INITIAL_SCRAPE and len(prices) >= 2:
            change30d = round((price - prices[0]) / prices[0] * 100, 1) if prices[0] else 0
        else:
            change30d = prev_quote.get('change30d', 0)

        if latest_sales is None:
            vol30 = prev_quote.get('volume30d', history_sales_volume_since(hist, 30, now))
            sold7 = prev_quote.get('soldLast7d', history_sales_volume_since(hist, 7, now))
        else:
            vol30 = history_sales_volume_since(hist, 30, now)
            sold7 = history_sales_volume_since(hist, 7, now)

        ask = round((live or {}).get('lowestPriceWithShipping') or (live or {}).get('lowPrice') or price * 1.05, 2) if price else 0
        bid_basis = min(price, ask) if ask else price
        bid = round(bid_basis * 0.95, 2) if bid_basis else 0
        spread = round(((ask - bid) / max(1, (bid + ask) / 2)) * 100, 1) if price else 0

        new_quotes[code] = {
            'price': price,
            'prev': price if INITIAL_SCRAPE else prev_quote.get('price', price),
            'change30d': change30d,
            'high52w': high52w,
            'low52w': low52w,
            'volume30d': vol30,
            'soldLast7d': sold7,
            'listings': listings,
            'bid': bid,
            'ask': ask,
            'spread': spread,
            'rsi': compute_rsi(prices),
            'momentum': 'bullish' if change30d > 4 else 'bearish' if change30d < -3 else 'neutral',
            'signal': compute_signal(price, change30d, high52w, low52w, s['status']),
            'lastUpdated': datetime.now(timezone.utc).isoformat(),
        }

    existing_positive = count_positive_quotes(market.get('quotes', {}))
    new_positive = count_positive_quotes(new_quotes)
    live_updates = fetched

    if live_updates == 0:
        if existing_positive and new_positive:
            print('\nNo fresh live prices fetched; preserving existing data files instead of rewriting cached data.')
            return
        raise RuntimeError('No fresh prices fetched and no cached positive quotes exist; refusing to write empty market data.')

    if new_positive == 0:
        raise RuntimeError('No positive quotes produced; refusing to write empty market data.')

    missing_quotes = [s['code'] for s in sets if s['code'] not in new_quotes]
    if missing_quotes:
        raise RuntimeError(f'Missing market quotes for tracked sets: {", ".join(missing_quotes)}')

    txns = compact_transactions(new_txns if INITIAL_SCRAPE else new_txns + txns)

    out_market = {
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'source': 'tcgplayer initial scrape' if INITIAL_SCRAPE else 'tcgplayer',
        'fetched': fetched,
        'kept': kept,
        'quotes': new_quotes,
    }

    print(f'\n→ {fetched} fetched, {kept} kept from cache, {len(new_txns)} new sales added.')

    if DRY_RUN:
        print('DRY_RUN=1 — not writing files.')
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MARKET.write_text(json.dumps(out_market, indent=2) + '\n')
    HISTORY.write_text(json.dumps(history, indent=2) + '\n')
    ARCHIVE.write_text(json.dumps(archive, indent=2) + '\n')
    TXNS.write_text(json.dumps(txns, indent=2) + '\n')
    print(f'✓ Wrote {MARKET.relative_to(ROOT)}, {HISTORY.relative_to(ROOT)}, {TXNS.relative_to(ROOT)}')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'FATAL: {e}', file=sys.stderr)
        sys.exit(1)
