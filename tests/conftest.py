# Pin the process to UTC, mirroring the JS suite ("test": "TZ=UTC vitest run"
# in package.json). The scraper's pure functions coerce naive datetimes to UTC
# themselves, so this is defensive: it keeps any future local-time dependence
# from passing on one runner's zone and failing on another's.
import os
import time

os.environ['TZ'] = 'UTC'
if hasattr(time, 'tzset'):
    time.tzset()
