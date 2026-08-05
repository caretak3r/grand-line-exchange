import { describe, it, expect } from 'vitest';
import {
  parseChartTime,
  pctChange,
  buildChartData,
  sliceWindow,
  buildIndexData,
  computeMarketStats,
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
