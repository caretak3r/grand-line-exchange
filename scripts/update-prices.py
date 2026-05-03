#!/usr/bin/env python3
"""
update-prices.py — Fetches live booster box prices from TCGPlayer (and optionally eBay),
updates public/data/market.json + history.json + transactions.json, and writes a summary.

Designed to run from GitHub Actions on a schedule. Resilient by design:
  - If a fetch fails for any individual set, it keeps the previous value.
  - If the entire run fails, the existing JSON is left untouched.
  - If the optional EBAY_APP_ID secret is set, eBay sold-comp data is folded in.

Usage:  python scripts/update-prices.py
Env vars (all optional):
  EBAY_APP_ID       — eBay Browse API app ID for real sold-comp data
  TCGPLAYER_BEARER  — TCGPlayer API bearer if you have partner access; otherwise public scrape
  DRY_RUN=1         — print but don't write
"""

import json
import os
import re
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
SETS_JS = ROOT / 'src' / 'data' / 'sets.js'

DRY_RUN = os.environ.get('DRY_RUN') == '1'
EBAY_APP_ID = os.environ.get('EBAY_APP_ID')

# ─── PARSE SET METADATA FROM sets.js ───────────────────────────────────────
def load_sets():
    """Parse the sets.js file to extract {code, tcgProductId, msrp, status}."""
    text = SETS_JS.read_text()
    sets = []
    # Match each {...} block inside SET_METADATA
    for m in re.finditer(r"\{([^}]+)\}", text, re.DOTALL):
        block = m.group(1)
        def find(key):
            mm = re.search(rf"{key}:\s*['\"]?([^,'\"\n]+)['\"]?", block)
            return mm.group(1).strip() if mm else None
        code = find('code')
        pid = find('tcgProductId')
        msrp = find('msrp')
        status = find('status')
        if code and pid:
            sets.append({
                'code': code,
                'tcgProductId': pid,
                'msrp': int(msrp) if msrp and msrp.isdigit() else 144,
                'status': status or 'active',
            })
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


def fetch_tcgplayer_price(product_id):
    """
    Fetch market price from TCGPlayer product page.
    They embed price data in JSON-LD and inline <script> blocks.
    Returns dict {marketPrice, lowPrice, listings} or None.
    """
    url = f'https://www.tcgplayer.com/product/{product_id}'
    try:
        html = http_get(url)
    except (URLError, HTTPError, TimeoutError) as e:
        print(f'  fetch failed for {product_id}: {e}')
        return None

    result = {}

    # 1) JSON-LD with offers
    for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL):
        try:
            obj = json.loads(m.group(1).strip())
            offers = obj.get('offers') if isinstance(obj, dict) else None
            if isinstance(offers, dict):
                if 'lowPrice' in offers:
                    result['lowPrice'] = float(offers['lowPrice'])
                if 'price' in offers:
                    result['marketPrice'] = float(offers['price'])
                if 'offerCount' in offers:
                    result['listings'] = int(offers['offerCount'])
        except (json.JSONDecodeError, ValueError, TypeError):
            continue

    # 2) Inline market price marker
    m = re.search(r'"marketPrice"\s*:\s*([\d.]+)', html)
    if m and 'marketPrice' not in result:
        result['marketPrice'] = float(m.group(1))

    # 3) Listings count fallback
    m = re.search(r'(\d+)\s*Listings?\b', html)
    if m and 'listings' not in result:
        result['listings'] = int(m.group(1))

    return result if result.get('marketPrice') or result.get('lowPrice') else None


# ─── EBAY SOLD COMPS (OPTIONAL) ────────────────────────────────────────────
def fetch_ebay_sold(query, app_id):
    """If EBAY_APP_ID is set, fetch recent sold listings via Browse API. Returns count + avg."""
    if not app_id:
        return None
    # eBay Finding API — completed listings endpoint (deprecated but still works for sold comps)
    url = (
        'https://svcs.ebay.com/services/search/FindingService/v1'
        f'?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.13.0'
        f'&SECURITY-APPNAME={app_id}&RESPONSE-DATA-FORMAT=JSON'
        f'&keywords={query.replace(" ", "%20")}'
        '&itemFilter(0).name=SoldItemsOnly&itemFilter(0).value=true'
        '&paginationInput.entriesPerPage=20&sortOrder=EndTimeSoonest'
    )
    try:
        data = json.loads(http_get(url))
        items = data.get('findCompletedItemsResponse', [{}])[0].get('searchResult', [{}])[0].get('item', [])
        prices = []
        for it in items:
            try:
                p = float(it['sellingStatus'][0]['currentPrice'][0]['__value__'])
                prices.append(p)
            except (KeyError, ValueError, IndexError):
                continue
        if not prices:
            return None
        return {
            'sold_count': len(prices),
            'avg_sold': round(sum(prices) / len(prices), 2),
            'min_sold': min(prices),
            'max_sold': max(prices),
        }
    except Exception as e:
        print(f'  eBay fetch failed: {e}')
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


# ─── MAIN UPDATE LOGIC ─────────────────────────────────────────────────────
def main():
    print(f'─── Grand Line Exchange · price update · {datetime.now(timezone.utc).isoformat()} ───')

    # Load existing state
    market = json.loads(MARKET.read_text()) if MARKET.exists() else {'quotes': {}}
    history = json.loads(HISTORY.read_text()) if HISTORY.exists() else {}
    txns = json.loads(TXNS.read_text()) if TXNS.exists() else []
    sets = load_sets()
    print(f'Loaded {len(sets)} tracked sets.')

    today = datetime.now(timezone.utc).date().isoformat()
    new_quotes = {}
    fetched, kept, ebay_updates = 0, 0, 0
    new_txns = []

    for s in sets:
        code = s['code']
        prev_quote = market.get('quotes', {}).get(code, {})

        live = fetch_tcgplayer_price(s['tcgProductId'])
        # polite: small delay between requests
        time.sleep(0.6 + random.random() * 0.4)

        if live and live.get('marketPrice'):
            price = round(live['marketPrice'])
            listings = live.get('listings', prev_quote.get('listings', 0))
            fetched += 1
            print(f'  ✓ {code}: ${price} (listings={listings})')
            # synthesize a transaction event for the tape
            new_txns.append({
                'id': f'{code}-{int(time.time())}',
                'set': code,
                'type': 'LISTED',
                'price': price,
                'venue': 'TCGPlayer',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'qty': 1,
            })
        else:
            # keep previous price, just refresh derived metrics
            price = prev_quote.get('price', 0)
            listings = prev_quote.get('listings', 0)
            kept += 1
            print(f'  · {code}: kept ${price} (no fresh data)')

        # Optional eBay enrichment
        if EBAY_APP_ID and price > 0:
            ebay = fetch_ebay_sold(f'one piece {code} booster box english sealed', EBAY_APP_ID)
            if ebay:
                price = round((price + ebay['avg_sold']) / 2)  # blend
                ebay_updates += 1
                print(f'    eBay blend: avg ${ebay["avg_sold"]} over {ebay["sold_count"]} sales')

        # Append today's price to history
        hist = history.get(code, [])
        if hist and hist[-1].get('date') == today:
            hist[-1]['price'] = price
        elif price > 0:
            hist.append({'date': today, 'price': price, 'volume': prev_quote.get('volume30d', 0) // 30 or 1})
        # Keep last 365 days
        hist = hist[-365:]
        history[code] = hist

        # Compute window metrics
        prices = [h['price'] for h in hist if h.get('price', 0) > 0]
        if not prices:
            continue
        high52w = max(prices[-365:]) if len(prices) >= 1 else price
        low52w = min(prices[-365:]) if len(prices) >= 1 else price
        # 30d change
        if len(prices) >= 30:
            price_30d_ago = prices[-30]
            change30d = round((price - price_30d_ago) / price_30d_ago * 100, 1) if price_30d_ago else 0
        else:
            change30d = prev_quote.get('change30d', 0)

        # Volume estimates: keep prior unless we have better data
        vol30 = prev_quote.get('volume30d', 0)
        sold7 = prev_quote.get('soldLast7d', 0)

        bid = round(price * 0.95) if price else 0
        ask = round(price * 1.05) if price else 0
        spread = round(((ask - bid) / max(1, (bid + ask) / 2)) * 100, 1) if price else 0

        new_quotes[code] = {
            'price': price,
            'prev': prev_quote.get('price', price),
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
    live_updates = fetched + ebay_updates

    if live_updates == 0:
        if existing_positive and new_positive:
            print('\nNo fresh live prices fetched; preserving existing data files instead of rewriting cached data.')
            return
        raise RuntimeError('No fresh prices fetched and no cached positive quotes exist; refusing to write empty market data.')

    if new_positive == 0:
        raise RuntimeError('No positive quotes produced; refusing to write empty market data.')

    # Merge new transactions with existing tape, keep last 100
    txns = (new_txns + txns)[:100]

    out_market = {
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'source': 'tcgplayer' + (' + ebay' if EBAY_APP_ID else ''),
        'fetched': fetched,
        'kept': kept,
        'quotes': new_quotes,
    }

    print(f'\n→ {fetched} fetched, {ebay_updates} eBay-enriched, {kept} kept from cache.')

    if DRY_RUN:
        print('DRY_RUN=1 — not writing files.')
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MARKET.write_text(json.dumps(out_market, indent=2))
    HISTORY.write_text(json.dumps(history, indent=2))
    TXNS.write_text(json.dumps(txns, indent=2))
    print(f'✓ Wrote {MARKET.relative_to(ROOT)}, {HISTORY.relative_to(ROOT)}, {TXNS.relative_to(ROOT)}')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'FATAL: {e}', file=sys.stderr)
        sys.exit(1)
