import { describe, it, expect } from 'vitest';
import {
  parseChartTime,
  pctChange,
  buildChartData,
  sliceWindow,
  sliceTape,
  buildIndexData,
  computeMarketStats,
  computeWindowStats,
  buildTape,
} from './analytics.js';

// Day-bucketing asserts UTC calendar days; the `test` script pins TZ=UTC so
// parse (local) and toISOString (UTC) agree regardless of the runner's zone.

describe('parseChartTime', () => {
  it('parses "YYYY-MM-DD HH:MM:SS" by normalizing the space to T', () => {
    expect(parseChartTime('2026-01-01 12:00:00')).toBe(Date.parse('2026-01-01T12:00:00'));
  });
  it('returns null for empty, nullish, or unparseable input', () => {
    expect(parseChartTime('')).toBeNull();
    expect(parseChartTime(null)).toBeNull();
    expect(parseChartTime('not a date')).toBeNull();
  });
});

describe('pctChange', () => {
  it('computes percent change relative to start', () => {
    expect(pctChange(100, 110)).toBe(10);
    expect(pctChange(200, 150)).toBe(-25);
  });
  it('guards a zero/falsy start with 0', () => {
    expect(pctChange(0, 50)).toBe(0);
  });
});

describe('buildChartData', () => {
  // Three UTC days -> daily closes [95, 110, 84]:
  //   01-01: market snapshot wins       -> 95
  //   01-02: median of even sales 100,120 -> 110
  //   01-03: median of odd sales 80,84,90  -> 84
  const rows = [
    { date: '2026-01-02 10:00:00', price: 100, source: 'ebay sale' },
    { date: '2026-01-03 10:00:00', price: 90, source: 'ebay sale' },
    { date: '2026-01-01 10:00:00', price: 95, source: 'tcgplayer current market' },
    { date: '2026-01-02 15:00:00', price: 120, source: 'ebay sale' },
    { date: '2026-01-03 11:00:00', price: 80, source: 'ebay sale' },
    { date: '2026-01-03 12:00:00', price: 84, source: 'ebay sale' },
  ];

  it('returns [] for empty input', () => {
    expect(buildChartData([])).toEqual([]);
  });

  it('keeps one row per observation, sorted, with a sequential axis', () => {
    const out = buildChartData(rows);
    expect(out).toHaveLength(6);
    expect(out.map(r => r.axis)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.map(r => r.ts)).toEqual([...out.map(r => r.ts)].sort((a, b) => a - b));
  });

  it('averages daily closes over the trailing window', () => {
    const out = buildChartData(rows);
    // 01-01 window: [95]                -> 95
    // 01-02 window: [95,110]            -> 102.5
    // 01-03 window: [95,110,84]/3       -> 96.33 (rounded to 2dp)
    expect(out[0].ma7).toBe(95);
    expect(out[1].ma7).toBe(102.5);
    expect(out[5].ma7).toBe(96.33);
    // <7 days of data => ma30 equals ma7 here
    expect(out[5].ma30).toBe(96.33);
  });

  it('drops rows with non-positive price or unparseable date', () => {
    const dirty = [
      { date: '2026-01-01 10:00:00', price: 0, source: 'ebay sale' },
      { date: 'garbage', price: 50, source: 'ebay sale' },
      { date: '2026-01-01 11:00:00', price: 42, source: 'ebay sale' },
    ];
    const out = buildChartData(dirty);
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe(42);
  });
});

describe('sliceWindow', () => {
  // Four observations: three consecutive days, then a 40-day gap (31 days
  // left in Jan + 9 in Feb, same time-of-day) before the last one —
  // deliberately irregular so the window must cut on ts, not row count.
  // Daily closes [100, 110, 90, 200] (all 'tcgplayer current market', so
  // close === price, no median math):
  //   ts0 01-01 window<=7d  [100]           -> ma7 100  | window<=30d same    -> ma30 100
  //   ts1 01-02 window<=7d  [100,110]        -> ma7 105  | window<=30d same    -> ma30 105
  //   ts2 01-03 window<=7d  [100,110,90]     -> ma7 100  | window<=30d same    -> ma30 100
  //   ts3 02-10 window<=7d  [200] (alone)    -> ma7 200  | window<=30d [200]   -> ma30 200
  const history = [
    { date: '2026-01-01 10:00:00', price: 100, source: 'tcgplayer current market' },
    { date: '2026-01-02 10:00:00', price: 110, source: 'tcgplayer current market' },
    { date: '2026-01-03 10:00:00', price: 90, source: 'tcgplayer current market' },
    { date: '2026-02-10 10:00:00', price: 200, source: 'tcgplayer current market' },
  ];
  const rows = buildChartData(history);

  it('returns [] for empty input without throwing', () => {
    expect(sliceWindow([], 30)).toEqual([]);
  });

  it('is identity when days is null', () => {
    expect(sliceWindow(rows, null)).toBe(rows);
  });

  it('cuts on the last observation\'s ts, not row count: a 7d window across the 40d gap keeps only the last row', () => {
    // cutoff = ts3 (02-10) - 7d = 02-03, which is after ts0..ts2 (all in January)
    const out = sliceWindow(rows, 7);
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe(200);
    expect(out[0].axis).toBe(0);
  });

  it('re-indexes axis to 0..n-1 and carries ma7/ma30 through unchanged (not recomputed)', () => {
    // ts3 - ts0 is exactly 40 days at matching times, so a 39d window's
    // cutoff lands exactly on ts1 (inclusive) -> keeps [ts1, ts2, ts3].
    const out = sliceWindow(rows, 39);
    expect(out).toHaveLength(3);
    expect(out.map(r => r.axis)).toEqual([0, 1, 2]);
    expect(out[0].ma7).toBe(rows[1].ma7);
    expect(out[0].ma30).toBe(rows[1].ma30);
    expect(out[1].ma7).toBe(rows[2].ma7);
    expect(out[1].ma30).toBe(rows[2].ma30);
    expect(out[2].ma7).toBe(rows[3].ma7);
    expect(out[2].ma30).toBe(rows[3].ma30);
  });

  it('does not mutate the input rows', () => {
    const axesBefore = rows.map(r => r.axis);
    sliceWindow(rows, 39);
    expect(rows.map(r => r.axis)).toEqual(axesBefore);
  });
});

describe('buildIndexData', () => {
  const sets = [{ code: 'OP01' }, { code: 'OP02' }];
  const history = {
    OP01: [
      { date: '2026-01-01 10:00:00', price: 100, source: 'x' },
      { date: '2026-01-03 10:00:00', price: 110, source: 'x' },
    ],
    OP02: [{ date: '2026-01-02 10:00:00', price: 200, source: 'x' }],
  };

  it('returns [] when history or sets is empty', () => {
    expect(buildIndexData(null, sets)).toEqual([]);
    expect(buildIndexData(history, [])).toEqual([]);
  });

  it('base-100 indexes each set to its first price and carries forward', () => {
    const out = buildIndexData(history, sets);
    expect(out).toHaveLength(3);
    // t0: only OP01 seen -> index 100, coverage 1
    expect(out[0].index).toBe(100);
    expect(out[0].coverage).toBe(1);
    // t2: OP01 110/100=110, OP02 flat at 100 -> mean 105, both covered
    expect(out[2].index).toBe(105);
    expect(out[2].coverage).toBe(2);
    expect(out[2].avgPrice).toBe(155); // (110 + 200) / 2
    expect(out[2].changed).toBe('OP01');
  });
});

describe('computeMarketStats', () => {
  const sets = [
    { price: 100, volume30d: 10, change30d: 5, signal: 'BUY' },
    { price: 200, volume30d: 5, change30d: -3, signal: 'HOLD' },
    { price: 0, volume30d: 99, change30d: 99, signal: 'STRONG BUY' }, // inactive
    { price: 50, volume30d: 2, change30d: 0, signal: 'STRONG BUY' },
  ];

  it('aggregates only active (price > 0) sets', () => {
    const s = computeMarketStats(sets);
    expect(s.active).toHaveLength(3);
    expect(s.totalCap).toBe(2100); // 100*10 + 200*5 + 50*2
    expect(s.totalVol).toBe(17); // 10 + 5 + 2
    expect(s.avgChange).toBeCloseTo(2 / 3, 10);
    expect(s.gainers).toBe(1); // change30d > 0
    expect(s.losers).toBe(1); // change30d < 0
    expect(s.buys).toBe(2); // BUY + STRONG BUY, inactive one excluded
  });

  it('ranks top gainers and losers by change30d', () => {
    const s = computeMarketStats(sets);
    expect(s.topGainers.map(x => x.change30d)).toEqual([5, 0, -3]);
    expect(s.topLosers.map(x => x.change30d)).toEqual([-3, 0, 5]);
  });
});

describe('computeWindowStats', () => {
  // Prices [100, 120, 90, 150]; only rows 1 and 2 are real fills (source
  // 'tcgplayer latest sale'), rows 0 and 3 are current-market snapshots.
  const rows = [
    { ts: 0, price: 100, volume: 1, source: 'tcgplayer current market' },
    { ts: 1, price: 120, volume: 2, source: 'tcgplayer latest sale' },
    { ts: 2, price: 90, volume: 3, source: 'tcgplayer latest sale' },
    { ts: 3, price: 150, volume: 1, source: 'tcgplayer current market' },
  ];

  it('returns a zeroed shape for an empty window', () => {
    expect(computeWindowStats([])).toEqual({
      windowChange: 0, windowHigh: null, windowLow: null,
      windowVolume: 0, windowSales: 0, vwap: null, first: null, last: null,
    });
  });

  it('computes change/high/low across the whole window, volume/vwap/sales from fills only', () => {
    const s = computeWindowStats(rows);
    // windowChange = (150 - 100) / 100 * 100 = 50
    expect(s.windowChange).toBe(50);
    // windowHigh/windowLow span every row, snapshots included: max/min of [100,120,90,150]
    expect(s.windowHigh).toBe(150);
    expect(s.windowLow).toBe(90);
    // fills only: volumes 2 + 3 = 5
    expect(s.windowVolume).toBe(5);
    expect(s.windowSales).toBe(2);
    // vwap = (120*2 + 90*3) / (2+3) = (240 + 270) / 5 = 102
    expect(s.vwap).toBe(102);
    expect(s.first).toBe(rows[0]);
    expect(s.last).toBe(rows[3]);
  });

  it('vwap is null when the window has no fills, but change/high/low still compute', () => {
    const quotesOnly = [
      { ts: 0, price: 100, volume: 1, source: 'tcgplayer current market' },
      { ts: 1, price: 80, volume: 1, source: 'tcgplayer current market' },
    ];
    const s = computeWindowStats(quotesOnly);
    expect(s.vwap).toBeNull();
    expect(s.windowVolume).toBe(0);
    expect(s.windowSales).toBe(0);
    // windowChange = (80 - 100) / 100 * 100 = -20
    expect(s.windowChange).toBe(-20);
    expect(s.windowHigh).toBe(100);
    expect(s.windowLow).toBe(80);
  });
});

describe('sliceTape', () => {
  // Fills newest-first (buildTape's own order), ts expressed as whole days
  // in ms so cutoff arithmetic is readable: day79, day40, day1, day0.
  const day = 86400000;
  const tape = [
    { id: 'd79', ts: 79 * day, price: 400 },
    { id: 'd40', ts: 40 * day, price: 300 },
    { id: 'd1', ts: 1 * day, price: 200 },
    { id: 'd0', ts: 0, price: 100 },
  ];

  it('returns [] for an empty tape', () => {
    expect(sliceTape([], 30, 100 * day)).toEqual([]);
  });

  it('is identity when days is null, regardless of anchorTs', () => {
    expect(sliceTape(tape, null, 79 * day)).toBe(tape);
  });

  it('filters on a cutoff relative to the given anchorTs, not the tape\'s own newest fill', () => {
    // anchorTs = the chart's last observation, here day79 (matches the
    // tape's newest fill). cutoff = 79d - 45d = 34d -> keeps day79, day40.
    const out = sliceTape(tape, 45, 79 * day);
    expect(out.map(r => r.id)).toEqual(['d79', 'd40']);
  });

  it('anchors off the passed anchorTs even when it postdates every fill', () => {
    // Chart's last observation (day90) is 11 days after the tape's newest
    // fill (day79). cutoff = 90d - 10d = 80d -> no fill is that recent.
    expect(sliceTape(tape, 10, 90 * day)).toEqual([]);
  });

  it('returns the tape untouched when anchorTs is unavailable (nothing to cut against)', () => {
    expect(sliceTape(tape, 30, null)).toBe(tape);
  });
});

describe('buildTape', () => {
  // Index in this array is preserved as the id tiebreaker, so it matters:
  // 0: fill                              -> kept
  // 1: current-market snapshot           -> dropped (not a fill)
  // 2: fill but price 0                  -> dropped
  // 3: fill but unparseable date         -> dropped
  // 4: release-date anchor               -> dropped (not a fill)
  // 5: fill                              -> kept
  // 6: fill, same date+price+volume as 7 -> kept (real duplicate)
  // 7: fill, same date+price+volume as 6 -> kept (real duplicate)
  const history = {
    OP01: [
      { date: '2026-01-01 10:00:00', price: 100, volume: 2, source: 'tcgplayer latest sale' },
      { date: '2026-01-02 10:00:00', price: 110, volume: 1, source: 'tcgplayer current market' },
      { date: '2026-01-03 10:00:00', price: 0, volume: 5, source: 'tcgplayer latest sale' },
      { date: 'garbage', price: 90, volume: 3, source: 'tcgplayer latest sale' },
      { date: '2026-01-01 09:00:00', price: 95, volume: 1, source: 'release date' },
      { date: '2026-01-04 10:00:00', price: 120, volume: 4, source: 'tcgplayer latest sale' },
      { date: '2026-01-05 10:00:00', price: 130, volume: 2, source: 'tcgplayer latest sale' },
      { date: '2026-01-05 10:00:00', price: 130, volume: 2, source: 'tcgplayer latest sale' },
    ],
    OP02: [{ date: '2026-01-01 10:00:00', price: 50, volume: 1, source: 'tcgplayer current market' }],
  };

  it('returns [] for an unknown code, a set with no sale rows, and null/undefined history', () => {
    expect(buildTape(history, 'NOPE')).toEqual([]);
    expect(buildTape(history, 'OP02')).toEqual([]);
    expect(buildTape({ OP03: [] }, 'OP03')).toEqual([]);
    expect(buildTape(null, 'OP01')).toEqual([]);
    expect(buildTape(undefined, 'OP01')).toEqual([]);
  });

  it('keeps only latest-sale rows with positive price and a parseable date, newest first', () => {
    const out = buildTape(history, 'OP01');
    // 8 rows in -> excluded: 1 (current market), 2 (price 0), 3 (bad date),
    // 4 (release date) = 4 excluded, 4 fills remain: rows 0, 5, 6, 7
    expect(out).toHaveLength(4);
    expect(out.map(r => r.price)).toEqual([130, 130, 120, 100]);
    expect(out.map(r => r.ts)).toEqual([...out.map(r => r.ts)].sort((a, b) => b - a));
  });

  it('maps history fields to tape fields with synthesized venue/type', () => {
    const out = buildTape(history, 'OP01');
    const oldest = out[3]; // row 0: 2026-01-01 10:00:00, 100, qty 2
    expect(oldest).toEqual({
      id: 'OP01-2026-01-01 10:00:00-100-2-0',
      ts: Date.parse('2026-01-01T10:00:00'),
      timestamp: '2026-01-01 10:00:00',
      price: 100,
      qty: 2,
      venue: 'TCGPlayer',
      type: 'SOLD',
    });
  });

  it('retains both duplicate-timestamp fills with distinct ids', () => {
    const out = buildTape(history, 'OP01');
    // rows 6 and 7 share date/price/volume; the index suffix disambiguates
    // and stable-sort keeps their original relative order among the tie
    const [first, second] = out;
    expect(first.timestamp).toBe('2026-01-05 10:00:00');
    expect(second.timestamp).toBe('2026-01-05 10:00:00');
    expect(first.price).toBe(130);
    expect(second.price).toBe(130);
    expect(first.id).toBe('OP01-2026-01-05 10:00:00-130-2-6');
    expect(second.id).toBe('OP01-2026-01-05 10:00:00-130-2-7');
    expect(first.id).not.toBe(second.id);
  });
});
