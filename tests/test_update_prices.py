"""Tests for the pure functions in scripts/update-prices.py.

The scraper owns every value persisted to public/data/market.json
(README.md "Analytics ownership"); these tests pin that arithmetic with
hand-derived expectations. No network path is exercised.

The module filename contains a hyphen, so it is loaded via importlib.
Import is side-effect free: the top level only imports stdlib, resolves
paths, and reads env vars; main() runs solely under the
`if __name__ == '__main__'` guard, and __name__ here is 'update_prices'.
"""

import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    'update_prices', REPO_ROOT / 'scripts' / 'update-prices.py')
up = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(up)

UTC = timezone.utc


# ─── money ─────────────────────────────────────────────────────────────────

def test_money_parses_numeric():
    assert up.money('12.5') == 12.5
    assert up.money(7) == 7.0
    # zero is a value, not "malformed" — the None contract is for absent/bad only
    assert up.money('0') == 0.0
    assert up.money(0) == 0.0


def test_money_malformed_returns_none():
    assert up.money(None) is None
    assert up.money('') is None
    assert up.money('abc') is None
    assert up.money([]) is None


# ─── compute_signal ────────────────────────────────────────────────────────

def test_signal_preorder_wins_over_everything():
    assert up.compute_signal(0, 0, 0, 0, 'preorder') == 'PREORDER'


def test_signal_zero_price_is_hold():
    assert up.compute_signal(0, 10, 200, 100, 'live') == 'HOLD'


def test_signal_strong_buy():
    # range_pos = (120-100)/max(1, 200-100) = 0.2 < 0.6, change 8 > 7
    assert up.compute_signal(120, 8, 200, 100, 'live') == 'STRONG BUY'


def test_signal_buy_when_range_pos_too_high_for_strong():
    # change 8 > 7 but range_pos = (190-100)/100 = 0.9 >= 0.6 -> falls to BUY
    assert up.compute_signal(190, 8, 200, 100, 'live') == 'BUY'
    # plain BUY: 3 < change 5 <= 7
    assert up.compute_signal(120, 5, 200, 100, 'live') == 'BUY'


def test_signal_watch_on_negative_change():
    assert up.compute_signal(150, -5, 200, 100, 'live') == 'WATCH'


def test_signal_watch_on_high_range_pos():
    # range_pos = (195-100)/100 = 0.95 > 0.85
    assert up.compute_signal(195, 0, 200, 100, 'live') == 'WATCH'


def test_signal_hold_default_and_flat_range_guard():
    # range_pos = (150-100)/100 = 0.5, change 0 -> HOLD
    assert up.compute_signal(150, 0, 200, 100, 'live') == 'HOLD'
    # high == low: max(1, 0) guard -> range_pos = 0, no ZeroDivisionError
    assert up.compute_signal(100, 0, 100, 100, 'live') == 'HOLD'


# ─── compute_rsi ───────────────────────────────────────────────────────────

# 15 prices = 14 deltas alternating +2/-1: seven gains of 2, seven losses of 1.
RSI_BASE = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107]


def test_rsi_short_series_returns_neutral_50():
    assert up.compute_rsi([]) == 50
    assert up.compute_rsi([1] * 14) == 50


def test_rsi_all_gains_is_100():
    assert up.compute_rsi(list(range(100, 115))) == 100


def test_rsi_all_losses_is_0():
    # avg_gain = 0 -> rs = 0 -> 100 - 100/1 = 0
    assert up.compute_rsi(list(range(115, 100, -1))) == 0


def test_rsi_flat_series_is_100_current_behavior():
    # Quirk pinned deliberately: all-zero deltas make avg_loss == 0, and the
    # avg_loss guard fires before any "no movement" check -> 100, not 50.
    assert up.compute_rsi([100.0] * 15) == 100


def test_rsi_simple_average_over_first_14_deltas():
    # Exactly 15 prices: the Wilder smoothing loop (range(14, 14)) never runs.
    # avg_gain = 7*2/14 = 1.0, avg_loss = 7*1/14 = 0.5, rs = 2
    # RSI = 100 - 100/3 = 66.67 -> round -> 67
    assert up.compute_rsi(RSI_BASE) == 67


def test_rsi_wilder_smoothing_step():
    # 16th price 109 adds one +2 delta and one smoothing iteration:
    # avg_gain = (1.0*13 + 2)/14 = 15/14, avg_loss = (0.5*13 + 0)/14 = 6.5/14
    # rs = 15/6.5 = 2.3077, RSI = 100 - 100/3.3077 = 69.77 -> round -> 70
    assert up.compute_rsi(RSI_BASE + [109]) == 70


# ─── daily_closes ──────────────────────────────────────────────────────────

# Shared cross-runtime fixture — keep in sync with src/lib/analytics.test.js
# (buildChartData rows): three UTC days -> daily closes [95, 110, 84]:
#   01-01: market snapshot wins            -> 95
#   01-02: median of even sales 100,120    -> 110
#   01-03: median of odd sales 80,84,90    -> 84
JS_PARITY_ROWS = [
    {'date': '2026-01-02 10:00:00', 'price': 100, 'source': 'ebay sale'},
    {'date': '2026-01-03 10:00:00', 'price': 90, 'source': 'ebay sale'},
    {'date': '2026-01-01 10:00:00', 'price': 95, 'source': 'tcgplayer current market'},
    {'date': '2026-01-02 15:00:00', 'price': 120, 'source': 'ebay sale'},
    {'date': '2026-01-03 11:00:00', 'price': 80, 'source': 'ebay sale'},
    {'date': '2026-01-03 12:00:00', 'price': 84, 'source': 'ebay sale'},
]


def test_daily_closes_matches_js_fixture():
    closes = up.daily_closes(JS_PARITY_ROWS)
    assert closes == [95.0, 110.0, 84.0]
    # Same number the JS suite asserts for MA7 over these three days:
    # (95 + 110 + 84) / 3 = 289/3 = 96.333... -> 96.33
    assert round(sum(closes) / len(closes), 2) == 96.33


def test_daily_closes_market_snapshot_beats_same_day_sales():
    rows = [
        {'date': '2026-01-01 09:00:00', 'price': 200, 'source': 'tcgplayer latest sale'},
        {'date': '2026-01-01 10:00:00', 'price': 95, 'source': 'tcgplayer current market'},
    ]
    assert up.daily_closes(rows) == [95.0]


def test_daily_closes_drops_nonpositive_and_unparseable_rows():
    rows = [
        {'date': '2026-01-01 10:00:00', 'price': 0, 'source': 'x'},
        {'date': 'garbage', 'price': 50, 'source': 'x'},
        {'date': '2026-01-01 11:00:00', 'price': 42, 'source': 'x'},
    ]
    assert up.daily_closes(rows) == [42.0]


def test_daily_closes_empty_inputs():
    assert up.daily_closes([]) == []
    assert up.daily_closes(None) == []


# ─── parse_datetime ────────────────────────────────────────────────────────

def test_parse_datetime_rejects_empty():
    assert up.parse_datetime(None) is None
    assert up.parse_datetime('') is None
    assert up.parse_datetime('   ') is None


def test_parse_datetime_space_separator():
    assert up.parse_datetime('2026-01-02 10:00:00') == datetime(2026, 1, 2, 10, tzinfo=UTC)


def test_parse_datetime_zulu_suffix():
    assert up.parse_datetime('2026-01-02T10:00:00Z') == datetime(2026, 1, 2, 10, tzinfo=UTC)


def test_parse_datetime_offset_converted_to_utc():
    assert up.parse_datetime('2026-01-02T05:00:00-05:00') == datetime(2026, 1, 2, 10, tzinfo=UTC)


def test_parse_datetime_date_only_is_utc_midnight():
    assert up.parse_datetime('2026-01-02') == datetime(2026, 1, 2, tzinfo=UTC)


def test_parse_datetime_falls_back_to_date_prefix():
    # '2026-01-02 25:99' -> T-normalized, fromisoformat fails on hour 25,
    # strptime on the first 10 chars salvages the day -> UTC midnight
    assert up.parse_datetime('2026-01-02 25:99') == datetime(2026, 1, 2, tzinfo=UTC)


def test_parse_datetime_garbage_is_none():
    assert up.parse_datetime('garbage') is None


# ─── sale_total / sale_quantity / sale_date ────────────────────────────────

def test_sale_total_sums_purchase_and_shipping():
    assert up.sale_total({'purchasePrice': 100.5, 'shippingPrice': 4.25}) == 104.75
    assert up.sale_total({'purchasePrice': 100}) == 100.0          # shipping defaults 0.0
    assert up.sale_total({'purchasePrice': 100, 'shippingPrice': 'abc'}) == 100.0


def test_sale_total_missing_purchase_price_is_none():
    assert up.sale_total({}) is None
    assert up.sale_total({'purchasePrice': 'abc', 'shippingPrice': 5}) is None


def test_sale_quantity_floors_at_one():
    assert up.sale_quantity({'quantity': 3}) == 3
    assert up.sale_quantity({'quantity': '2'}) == 2
    assert up.sale_quantity({'quantity': 2.9}) == 2   # int() truncates
    assert up.sale_quantity({'quantity': 0}) == 1
    assert up.sale_quantity({'quantity': -5}) == 1
    assert up.sale_quantity({}) == 1


def test_sale_date_takes_first_ten_chars_or_none():
    assert up.sale_date({'orderDate': '2026-01-02T10:00:00Z'}) == '2026-01-02'
    assert up.sale_date({'orderDate': '2026-01-02'}) == '2026-01-02'
    assert up.sale_date({'orderDate': 'short'}) is None
    assert up.sale_date({}) is None


# ─── history_sort_key / history_row_key ────────────────────────────────────

def test_history_sort_key_is_utc_epoch():
    # 2026-01-01T00:00:00Z = 1767225600 (2020-01-01 = 1577836800, plus
    # 2192 days across 2020..2025 incl. two leap years = 189388800)
    assert up.history_sort_key({'date': '2026-01-01T00:00Z'}) == 1767225600.0
    assert up.history_sort_key({'date': None}) == 0
    assert up.history_sort_key({'date': 'garbage'}) == 0
    assert up.history_sort_key({}) == 0


def test_history_row_key_day_keyed_sources():
    # market/release rows dedupe per UTC day: date truncated to 10 chars
    row = {'source': 'tcgplayer current market', 'date': '2026-01-02T10:30Z', 'price': 95}
    assert up.history_row_key(row) == ('tcgplayer current market', '2026-01-02')
    anchor = {'source': 'release date', 'date': '2026-01-02', 'price': None}
    assert up.history_row_key(anchor) == ('release date', '2026-01-02')


def test_history_row_key_sales_and_legacy_keep_full_identity():
    sale = {'source': 'tcgplayer latest sale', 'date': '2026-01-02T10:30Z',
            'price': 95, 'volume': 2}
    assert up.history_row_key(sale) == ('tcgplayer latest sale', '2026-01-02T10:30Z', 95, 2)
    # missing source defaults to 'legacy'; missing volume -> None in the tuple
    assert up.history_row_key({'date': '2026-01-02', 'price': 5}) == ('legacy', '2026-01-02', 5, None)


# ─── merge_history_points ──────────────────────────────────────────────────

def test_merge_dedupes_by_key_and_sorts_chronologically():
    a = {'date': '2026-01-02T05:00Z', 'price': 90, 'source': 'tcgplayer current market'}
    b = {'date': '2026-01-02T18:00Z', 'price': 95, 'source': 'tcgplayer current market'}
    c = {'date': '2026-01-01T00:00Z', 'price': None, 'volume': 0, 'source': 'release date'}
    d = {'date': '', 'price': 1}
    e = {'date': '2026-01-03T00:00Z', 'price': 50, 'volume': 1, 'source': 'tcgplayer latest sale'}
    # a and b share the day key -> later group wins (b); d has no date -> dropped;
    # dict(e) duplicates e's full identity key -> deduped to one row
    out = up.merge_history_points([a, d, e], [b, c, dict(e)])
    assert out == [c, b, e]


# ─── prune_history (365d retention, pure split — archive IO lives in main) ─

def test_prune_splits_old_months_keeping_spine_and_anchors():
    now = datetime(2026, 7, 15, tzinfo=UTC)          # cutoff = 2025-07-15
    a = {'date': '2024-05-01T00:00Z', 'price': None, 'volume': 0, 'source': 'release date'}
    b = {'date': '2024-05-02T10:00Z', 'price': 100, 'volume': 1, 'source': 'tcgplayer latest sale'}
    c = {'date': '2024-05-20T10:00Z', 'price': 110, 'volume': 1, 'source': 'tcgplayer latest sale'}
    # December exercises the year-wrap: month_end = 2025-01-01 (< cutoff);
    # price 0 means the month has no spine, so the row is archived
    d = {'date': '2024-12-10T10:00Z', 'price': 0, 'volume': 1, 'source': 'tcgplayer latest sale'}
    e = {'date': '2026-07-01T00:00Z', 'price': 120, 'volume': 1, 'source': 'tcgplayer current market'}
    kept, archived = up.prune_history([a, b, c, d, e], now)
    # 2024-05 is fully old: keep the release anchor (a) and the month's last
    # positive-price row (c, the spine); archive b. 2026-07 is recent: keep e.
    assert kept == [a, c, e]
    assert archived == [b, d]


def test_prune_month_ending_exactly_on_cutoff_is_kept():
    now = datetime(2026, 7, 1, tzinfo=UTC)           # cutoff = 2025-07-01
    g1 = {'date': '2025-05-10T00:00Z', 'price': 80, 'volume': 1, 'source': 'tcgplayer latest sale'}
    g2 = {'date': '2025-05-15T00:00Z', 'price': 85, 'volume': 1, 'source': 'tcgplayer latest sale'}
    # 2025-06's month_end (2025-07-01) == cutoff -> kept whole (>= comparison);
    # 2025-05's month_end (2025-06-01) < cutoff -> spine g2 kept, g1 archived
    f = {'date': '2025-06-15T00:00Z', 'price': 90, 'volume': 1, 'source': 'tcgplayer latest sale'}
    kept, archived = up.prune_history([g1, g2, f], now)
    assert kept == [g2, f]
    assert archived == [g1]


def test_prune_unparseable_dates_and_empty_input():
    now = datetime(2026, 7, 15, tzinfo=UTC)
    bad = {'date': 'nope', 'price': 5}
    assert up.prune_history([bad], now) == ([bad], [])
    assert up.prune_history([], now) == ([], [])
    assert up.prune_history(None, now) == ([], [])


# ─── history point constructors ────────────────────────────────────────────

def test_release_anchor():
    assert up.release_anchor('2024-05-01') == {
        'date': '2024-05-01', 'price': None, 'volume': 0,
        'source': 'release date', 'confidence': 'reference',
    }
    assert up.release_anchor(None) is None
    assert up.release_anchor('') is None


def test_current_market_point():
    assert up.current_market_point(95.5, '2026-07-15T00:00Z') == {
        'date': '2026-07-15T00:00Z', 'price': 95.5, 'volume': 1,
        'source': 'tcgplayer current market', 'confidence': 'verified',
    }
    assert up.current_market_point(0, '2026-07-15T00:00Z') is None
    assert up.current_market_point(-1, '2026-07-15T00:00Z') is None


def test_sales_history_points_builds_minute_labels_and_skips_bad_sales():
    sales = [
        # 100.5 + 4.25 = 104.75; label drops seconds -> '...T15:30Z'
        {'orderDate': '2026-07-10T15:30:45Z', 'purchasePrice': 100.5,
         'shippingPrice': 4.25, 'quantity': 2},
        {'purchasePrice': 50},                                        # no date -> skipped
        {'orderDate': '2026-07-10T15:30:45Z', 'purchasePrice': 0},    # zero total -> skipped
        {'orderDate': '2026-07-10T15:30:45Z'},                        # no price -> skipped
    ]
    assert up.sales_history_points(sales) == [{
        'date': '2026-07-10T15:30Z', 'price': 104.75, 'volume': 2,
        'source': 'tcgplayer latest sale', 'confidence': 'verified',
    }]
    assert up.sales_history_points(None) == []


def test_sales_history_points_date_only_order_date():
    out = up.sales_history_points([{'orderDate': '2026-07-10', 'purchasePrice': 10}])
    assert out == [{
        'date': '2026-07-10T00:00Z', 'price': 10.0, 'volume': 1,
        'source': 'tcgplayer latest sale', 'confidence': 'verified',
    }]


# ─── build_verified_history ────────────────────────────────────────────────

EXISTING_SALE = {'date': '2026-07-01T00:00Z', 'price': 100, 'volume': 1,
                 'source': 'tcgplayer latest sale', 'confidence': 'verified'}
NEW_SALE = {'orderDate': '2026-07-10T15:30:45Z', 'purchasePrice': 100.5,
            'shippingPrice': 4.25, 'quantity': 2}


def test_build_verified_history_composes_and_sorts():
    out = up.build_verified_history(
        [dict(EXISTING_SALE)], '2024-05-01', [NEW_SALE], 120.0, '2026-07-15T10:00Z')
    assert [r['date'] for r in out] == [
        '2024-05-01', '2026-07-01T00:00Z', '2026-07-10T15:30Z', '2026-07-15T10:00Z']
    assert out[0] == {'date': '2024-05-01', 'price': None, 'volume': 0,
                      'source': 'release date', 'confidence': 'reference'}
    assert out[2]['price'] == 104.75 and out[2]['volume'] == 2
    assert out[3] == {'date': '2026-07-15T10:00Z', 'price': 120.0, 'volume': 1,
                      'source': 'tcgplayer current market', 'confidence': 'verified'}


def test_build_verified_history_reset_drops_existing_and_zero_price_adds_nothing():
    out = up.build_verified_history(
        [dict(EXISTING_SALE)], '2024-05-01', [NEW_SALE], 120.0, '2026-07-15T10:00Z',
        reset=True)
    assert [r['date'] for r in out] == [
        '2024-05-01', '2026-07-10T15:30Z', '2026-07-15T10:00Z']
    assert up.build_verified_history([], None, [], 0, '2026-07-15T10:00Z') == []


def test_build_verified_history_new_market_point_replaces_same_day_snapshot():
    stale = {'date': '2026-07-15T08:00Z', 'price': 118, 'volume': 1,
             'source': 'tcgplayer current market', 'confidence': 'verified'}
    out = up.build_verified_history([stale], None, [], 120.0, '2026-07-15T10:00Z')
    # same ('tcgplayer current market', '2026-07-15') key: additions win
    assert out == [{'date': '2026-07-15T10:00Z', 'price': 120.0, 'volume': 1,
                    'source': 'tcgplayer current market', 'confidence': 'verified'}]


# ─── window queries ────────────────────────────────────────────────────────

NOW = datetime(2026, 7, 15, tzinfo=UTC)


def test_history_prices_since_inclusive_cutoff():
    rows = [
        {'date': '2026-06-14T23:59Z', 'price': 100},   # 1 min before cutoff -> out
        {'date': '2026-06-15T00:00Z', 'price': 105},   # exactly at cutoff -> in (>=)
        {'date': '2026-07-01', 'price': 110},          # date-only, in window
        {'date': '2026-07-02', 'price': 0},            # non-positive -> out
        {'date': 'bad', 'price': 50},                  # unparseable -> out
    ]
    assert up.history_prices_since(rows, 30, NOW) == [105.0, 110.0]
    assert up.history_prices_since(None, 30, NOW) == []


def test_price_at_or_before_picks_latest_candidate():
    rows = [   # deliberately unsorted
        {'date': '2026-06-10', 'price': 105},
        {'date': '2026-06-01', 'price': 100},
        {'date': '2026-06-20', 'price': 110},
    ]
    assert up.price_at_or_before(rows, datetime(2026, 6, 15, tzinfo=UTC)) == 105.0
    # inclusive: 06-10 parses to UTC midnight == cutoff
    assert up.price_at_or_before(rows, datetime(2026, 6, 10, tzinfo=UTC)) == 105.0
    assert up.price_at_or_before(rows, datetime(2026, 5, 1, tzinfo=UTC)) is None
    assert up.price_at_or_before([{'date': '2026-06-01', 'price': 0}],
                                 datetime(2026, 6, 15, tzinfo=UTC)) is None
    assert up.price_at_or_before(None, datetime(2026, 6, 15, tzinfo=UTC)) is None


def test_history_sales_volume_since():
    rows = [   # cutoff = NOW - 7d = 2026-07-08T00:00Z
        {'date': '2026-07-10T00:00Z', 'volume': 2, 'source': 'tcgplayer latest sale'},   # +2
        {'date': '2026-07-09T00:00Z', 'volume': '3', 'source': 'tcgplayer latest sale'}, # +3 (string)
        {'date': '2026-07-08T00:00Z', 'volume': 1, 'source': 'tcgplayer latest sale'},   # +1 (inclusive)
        {'date': '2026-07-10T00:00Z', 'volume': 5, 'source': 'tcgplayer current market'},# wrong source
        {'date': '2026-07-01T00:00Z', 'volume': 4, 'source': 'tcgplayer latest sale'},   # too old
        {'date': '2026-07-11T00:00Z', 'volume': -2, 'source': 'tcgplayer latest sale'},  # max(0,·)=0
        {'date': '2026-07-11T00:00Z', 'source': 'tcgplayer latest sale'},                # no volume
    ]
    assert up.history_sales_volume_since(rows, 7, NOW) == 6
    assert up.history_sales_volume_since(None, 7, NOW) == 0


# ─── transactions ──────────────────────────────────────────────────────────

def test_sale_transaction_id():
    sale = {'orderDate': '2026-07-10T15:30:45Z', 'purchasePrice': 100.5,
            'shippingPrice': 4.25, 'quantity': 2}
    # cents = int(round(104.75 * 100)) = 10475
    assert up.sale_transaction_id('OP01', sale) == 'OP01-sold-2026-07-10T15:30:45Z-2-10475'
    # no orderDate -> 'unknown-<idx>'; qty floors to 1; 10.0 -> 1000 cents
    assert up.sale_transaction_id('OP01', {'purchasePrice': 10}, idx=3) == 'OP01-sold-unknown-3-1-1000'


def test_transaction_sort_key():
    assert up.transaction_sort_key({'timestamp': '2026-01-01T00:00:00Z'}) == 1767225600.0
    assert up.transaction_sort_key({}) == 0
    assert up.transaction_sort_key({'timestamp': 'bad'}) == 0


def test_sale_transactions_for_interval_filters_and_mutates_ids():
    interval = up.parse_datetime('2026-07-10T00:00:00Z')
    s_new = {'orderDate': '2026-07-11T10:00:00Z', 'purchasePrice': 100.5,
             'shippingPrice': 4.25, 'quantity': 2}
    s_old = {'orderDate': '2026-07-09T10:00:00Z', 'purchasePrice': 50}
    s_boundary = {'orderDate': '2026-07-10T00:00:00Z', 'purchasePrice': 50}   # == interval -> excluded
    s_zero = {'orderDate': '2026-07-12T10:00:00Z', 'purchasePrice': 0}
    s_dup = dict(s_new)
    s_undated = {'purchasePrice': 60}
    ids = set()
    out = up.sale_transactions_for_interval(
        'OP01', [s_new, s_old, s_boundary, s_zero, s_dup, s_undated], interval, ids)
    assert out == [{
        'id': 'OP01-sold-2026-07-11T10:00:00Z-2-10475', 'set': 'OP01', 'type': 'SOLD',
        'price': 104.75, 'venue': 'TCGPlayer',
        'timestamp': '2026-07-11T10:00:00Z', 'qty': 2,
    }]
    # caller relies on in-place mutation for cross-set dedup in main()
    assert ids == {'OP01-sold-2026-07-11T10:00:00Z-2-10475'}


def test_sale_transactions_without_interval_takes_everything_priced():
    s1 = {'orderDate': '2026-07-11T10:00:00Z', 'purchasePrice': 100.5,
          'shippingPrice': 4.25, 'quantity': 2}
    s2 = {'orderDate': '2026-07-09T10:00:00Z', 'purchasePrice': 50}
    out = up.sale_transactions_for_interval('OP01', [s1, s2], None, set())
    assert [t['price'] for t in out] == [104.75, 50.0]


def test_sale_transactions_skips_preexisting_ids():
    s1 = {'orderDate': '2026-07-11T10:00:00Z', 'purchasePrice': 100.5,
          'shippingPrice': 4.25, 'quantity': 2}
    ids = {'OP01-sold-2026-07-11T10:00:00Z-2-10475'}
    assert up.sale_transactions_for_interval('OP01', [s1], None, ids) == []


def test_compact_transactions_dedupes_filters_and_sorts_desc():
    t1 = {'id': 'a', 'type': 'SOLD', 'timestamp': '2026-01-01T00:00:00Z', 'price': 10, 'qty': 1}
    t2 = {'id': 'b', 'type': 'SOLD', 'timestamp': '2026-01-03T00:00:00Z', 'price': 12, 'qty': 1}
    t3 = dict(t1)                                                        # dup id -> dropped
    t4 = {'id': 'c', 'type': 'BUY', 'timestamp': '2026-01-04T00:00:00Z'} # not SOLD -> dropped
    t5 = {'type': 'SOLD', 'set': 'OP01', 'timestamp': '2026-01-02T00:00:00Z',
          'price': 9, 'qty': 2}                                          # no id -> tuple key
    out = up.compact_transactions([t1, t2, t3, t4, t5])
    assert out == [t2, t5, t1]      # newest first


def test_compact_transactions_limit_and_empty():
    t1 = {'id': 'a', 'type': 'SOLD', 'timestamp': '2026-01-01T00:00:00Z'}
    t2 = {'id': 'b', 'type': 'SOLD', 'timestamp': '2026-01-03T00:00:00Z'}
    t5 = {'id': 'e', 'type': 'SOLD', 'timestamp': '2026-01-02T00:00:00Z'}
    assert up.compact_transactions([t1, t2, t5], limit=2) == [t2, t5]
    assert up.compact_transactions([]) == []
    assert up.compact_transactions(None) == []


# ─── count_positive_quotes ─────────────────────────────────────────────────

def test_count_positive_quotes():
    assert up.count_positive_quotes({'A': {'price': 10}, 'B': {'price': 0}, 'C': {}}) == 1
    assert up.count_positive_quotes({}) == 0


# ─── load_sets (file IO via tmp_path; SETS_JSON swapped on the module) ─────

VALID_SET = {'code': 'OP01', 'name': 'Romance Dawn', 'released': '2022-12-02',
             'msrp': 120, 'status': 'live', 'tcgProductId': '453437'}


def _write_sets(tmp_path, monkeypatch, payload):
    path = tmp_path / 'sets.json'
    path.write_text(json.dumps(payload))
    monkeypatch.setattr(up, 'SETS_JSON', path)


def test_load_sets_valid(tmp_path, monkeypatch):
    _write_sets(tmp_path, monkeypatch, [VALID_SET])
    assert up.load_sets() == [VALID_SET]


def test_load_sets_rejects_malformed(tmp_path, monkeypatch):
    bad_payloads = [
        {},                                             # not a list
        [],                                             # empty list
        [{k: v for k, v in VALID_SET.items() if k != 'msrp'}],   # missing key
        [dict(VALID_SET, msrp=120.5)],                  # msrp must be int
        [dict(VALID_SET, tcgProductId='abc')],          # non-numeric product id
        [VALID_SET, dict(VALID_SET)],                   # duplicate code
    ]
    for payload in bad_payloads:
        _write_sets(tmp_path, monkeypatch, payload)
        with pytest.raises(RuntimeError):
            up.load_sets()
