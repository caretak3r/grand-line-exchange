import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fmt$, fmtPct, fmtNum, fmtIndex, fmtChartDate, fmtShortChartDate,
  fmtAxisDate, observationDomain, timeAgo, signalColor, tierLabel,
} from './format.js';
import { t } from './theme.js';

// Pure formatters. TZ=UTC is pinned by the npm test script, and every
// toLocale* call passes 'en-US' explicitly, so the date/number output is
// deterministic across runners.

describe('fmt$', () => {
  it('rounds and thousands-separates positive money', () => {
    expect(fmt$(1234.6)).toBe('$1,235');   // Math.round(1234.6)=1235
    expect(fmt$(1000000)).toBe('$1,000,000');
  });
  it('returns the em-dash for falsy input (0 is "no data" here)', () => {
    expect(fmt$(0)).toBe('—');
    expect(fmt$(null)).toBe('—');
    expect(fmt$(undefined)).toBe('—');
  });
});

describe('fmtPct', () => {
  it('always shows 2 decimals and a leading + only when positive', () => {
    expect(fmtPct(5)).toBe('+5.00%');
    expect(fmtPct(-3.2)).toBe('-3.20%');
    expect(fmtPct(0)).toBe('0.00%');       // 0 > 0 is false, no '+'
  });
});

describe('fmtNum', () => {
  it('thousands-separates without rounding', () => {
    expect(fmtNum(1234567)).toBe('1,234,567');
  });
});

describe('fmtIndex', () => {
  it('one decimal for finite, em-dash otherwise', () => {
    expect(fmtIndex(100)).toBe('100.0');
    expect(fmtIndex(96.34)).toBe('96.3');
    expect(fmtIndex(NaN)).toBe('—');
    expect(fmtIndex(Infinity)).toBe('—');
  });
});

describe('chart date formatters', () => {
  const ts = Date.parse('2026-01-15T00:00:00Z');   // UTC midnight, TZ=UTC pinned
  it('long form is "Mon D, YYYY"', () => {
    expect(fmtChartDate(ts)).toBe('Jan 15, 2026');
  });
  it('short form drops the year', () => {
    expect(fmtShortChartDate(ts)).toBe('Jan 15');
  });
  it('non-finite timestamps yield the em-dash', () => {
    expect(fmtChartDate(NaN)).toBe('—');
    expect(fmtShortChartDate(undefined)).toBe('—');
  });
});

describe('fmtAxisDate', () => {
  const rows = [{ ts: Date.parse('2026-01-15T00:00:00Z') }, { ts: Date.parse('2026-02-20T00:00:00Z') }];
  it('maps a numeric axis value to the row it indexes, clamped', () => {
    expect(fmtAxisDate(rows)(0)).toBe('Jan 15');
    expect(fmtAxisDate(rows)(1)).toBe('Feb 20');
    expect(fmtAxisDate(rows)(9)).toBe('Feb 20');   // clamped to last index
  });
  it('empty rows yield the em-dash', () => {
    expect(fmtAxisDate([])(3)).toBe('—');
  });
});

describe('observationDomain', () => {
  it('spans 0..len-1, with a floor of [0,1]', () => {
    expect(observationDomain([1, 2, 3])).toEqual([0, 2]);
    expect(observationDomain([])).toEqual([0, 1]);
    expect(observationDomain([1])).toEqual([0, 1]);
  });
});

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());
  it('buckets an elapsed interval into now/m/h/d', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z'));
    const ago = (mins) => new Date(Date.parse('2026-07-17T12:00:00Z') - mins * 60000).toISOString();
    expect(timeAgo(ago(0))).toBe('now');
    expect(timeAgo(ago(45))).toBe('45m');
    expect(timeAgo(ago(90))).toBe('1h');      // floor(90/60)=1
    expect(timeAgo(ago(60 * 26))).toBe('1d');  // floor(1560/1440)=1
  });
});

describe('signalColor', () => {
  it('maps known signals, falls back to base text color', () => {
    expect(signalColor('STRONG BUY')).toBe(t.buy);
    expect(signalColor('BUY')).toBe('#5dd99f');
    expect(signalColor('SELL')).toBe(t.sell);
    expect(signalColor('WHAT')).toBe(t.text);   // unknown → default
  });
});

describe('tierLabel', () => {
  it('maps known tiers, upper-cases unknowns', () => {
    expect(tierLabel('grail')).toBe('GRAIL');
    expect(tierLabel('mid')).toBe('MID-CAP');
    expect(tierLabel('custom')).toBe('CUSTOM');
  });
});
