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
