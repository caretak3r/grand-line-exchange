// Pure browser-side analytics derived from history.json / market.json.
//
// Ownership rule (mirrored in README.md): every value persisted in
// public/data/market.json (price, RSI, signals, ranges, volumes) is computed
// once by scripts/update-prices.py at ingest. Every value derived in the
// browser for display (moving averages, the Grand Line Index, market-pulse
// aggregates) is computed here. Nothing computes the same number in both
// places.

export const parseChartTime = (value) => {
  const ts = new Date(String(value || '').replace(' ', 'T')).getTime();
  return Number.isFinite(ts) ? ts : null;
};

export const pctChange = (start, end) => start ? ((end - start) / start) * 100 : 0;

// MAs use daily closes: per UTC day, the last market snapshot's price if
// present, else the median of that day's sales. Rows stay per-observation
// for the price line, volume bars, and tooltips.
export function buildChartData(historyRows) {
  if (!historyRows.length) return [];
  const rows = historyRows
    .map(row => ({ ...row, ts: parseChartTime(row.date) }))
    .filter(row => row.ts && row.price > 0)
    .sort((a, b) => a.ts - b.ts);
  const byDay = new Map();
  for (const row of rows) {
    const day = new Date(row.ts).toISOString().slice(0, 10);
    const entry = byDay.get(day) || { market: null, sales: [] };
    if (row.source === 'tcgplayer current market') entry.market = row.price;
    else entry.sales.push(row.price);
    byDay.set(day, entry);
  }
  const closes = [...byDay.entries()].map(([day, e]) => {
    if (e.market != null) return { day, close: e.market };
    const s = [...e.sales].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return { day, close: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2 };
  });
  const maOver = (day, windowDays) => {
    const end = Date.parse(day);
    const start = end - (windowDays - 1) * 86400000;
    const w = closes.filter(c => { const t = Date.parse(c.day); return t >= start && t <= end; });
    return w.length ? Math.round(w.reduce((s, c) => s + c.close, 0) / w.length * 100) / 100 : null;
  };
  return rows.map((row, i) => {
    const day = new Date(row.ts).toISOString().slice(0, 10);
    return { ...row, axis: i, ma7: maOver(day, 7), ma30: maOver(day, 30) };
  });
}

// Cutoff timestamp for a trailing window anchored at `anchorTs`. Shared by
// sliceWindow() (chart rows) and sliceTape() (tape fills) so a given
// timeframe cuts the identical wall-clock boundary in both panels.
function windowCutoff(anchorTs, days) {
  return days === null || anchorTs == null ? null : anchorTs - days * 86400000;
}

// Trailing time window over buildChartData() output, re-indexed for the
// chart's positional axis (0..n-1). MAs are already baked into `rows` and
// carry through unchanged. Anchored off the last observation's ts, not
// Date.now(), so a stale set still renders its own trailing window.
// `days === null` returns all rows (identity).
export function sliceWindow(rows, days) {
  if (!rows.length) return [];
  if (days === null) return rows;
  const cutoff = windowCutoff(rows[rows.length - 1].ts, days);
  return rows.filter(row => row.ts >= cutoff).map((row, i) => ({ ...row, axis: i }));
}

// Trailing time window over buildTape() output (already sorted newest
// first — no positional axis to re-index). Anchored at `anchorTs`, the
// caller's choice, not the tape's own last fill — Dashboard.jsx passes the
// chart's last observation so a given timeframe selects the exact same
// window in the chart and the tape. `days === null` returns the tape
// untouched (ALL).
export function sliceTape(tape, days, anchorTs) {
  if (!tape.length || days === null) return tape;
  const cutoff = windowCutoff(anchorTs, days);
  return cutoff == null ? tape : tape.filter(row => row.ts >= cutoff);
}

// Equal-weight base-100 index across the tracked sets, with per-set baselines
// and carry-forward between events.
export function buildIndexData(history, sets) {
  if (!history || !sets.length) return [];
  const trackedCodes = new Set(sets.map(s => s.code));
  const grouped = new Map();
  for (const code of trackedCodes) {
    for (const row of history[code] || []) {
      const price = Number(row.price);
      const ts = parseChartTime(row.date);
      if (!ts || !price || price <= 0) continue;
      const bucket = grouped.get(ts) || [];
      bucket.push({ code, price, source: row.source });
      grouped.set(ts, bucket);
    }
  }
  const latest = new Map();
  const baselines = new Map();
  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ts, events], i) => {
      for (const event of events) {
        if (!baselines.has(event.code)) baselines.set(event.code, event.price);
        latest.set(event.code, event.price);
      }
      const prices = sets.map(s => latest.get(s.code)).filter(p => p > 0);
      const normalized = sets
        .map(s => {
          const price = latest.get(s.code);
          const base = baselines.get(s.code);
          return price && base ? (price / base) * 100 : null;
        })
        .filter(p => p > 0);
      const changed = events.map(e => e.code).join(', ');
      return {
        axis: i,
        ts,
        index: Math.round(normalized.reduce((sum, p) => sum + p, 0) / normalized.length * 100) / 100,
        avgPrice: Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length * 100) / 100,
        coverage: normalized.length,
        totalSets: sets.length,
        changed,
      };
    });
}

// Market-pulse aggregates. `active` is returned because the render uses it
// directly (ticker, stat cards, decision matrix, footer).
export function computeMarketStats(sets) {
  const active = sets.filter(s => s.price > 0);
  const totalCap = active.reduce((sum, s) => sum + s.price * s.volume30d, 0);
  const totalVol = active.reduce((sum, s) => sum + s.volume30d, 0);
  const avgChange = active.length ? active.reduce((sum, s) => sum + s.change30d, 0) / active.length : 0;
  const gainers = active.filter(s => s.change30d > 0).length;
  const losers = active.filter(s => s.change30d < 0).length;
  const buys = active.filter(s => s.signal === 'BUY' || s.signal === 'STRONG BUY').length;
  const topGainers = [...active].sort((a, b) => b.change30d - a.change30d).slice(0, 5);
  const topLosers = [...active].sort((a, b) => a.change30d - b.change30d).slice(0, 5);
  return { active, totalCap, totalVol, avgChange, gainers, losers, buys, topGainers, topLosers };
}

// Window-scoped metrics for the chart's active timeframe. `rows` is the
// output of sliceWindow(buildChartData(...)) — every row already carries
// price/volume/source/ts. Only 'tcgplayer latest sale' rows are real fills;
// 'tcgplayer current market' snapshots carry a placeholder volume (same rule
// buildTape() uses) and are excluded from volume/vwap/fill-count so a quote
// row never gets counted as a sale.
export function computeWindowStats(rows) {
  if (!rows.length) {
    return { windowChange: 0, windowHigh: null, windowLow: null, windowVolume: 0, windowSales: 0, vwap: null, first: null, last: null };
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const prices = rows.map(r => r.price);
  const sales = rows.filter(r => r.source === 'tcgplayer latest sale');
  const saleVolume = sales.reduce((sum, r) => sum + (r.volume || 0), 0);
  const saleValue = sales.reduce((sum, r) => sum + r.price * (r.volume || 0), 0);
  return {
    windowChange: pctChange(first.price, last.price),
    windowHigh: Math.max(...prices),
    windowLow: Math.min(...prices),
    windowVolume: saleVolume,
    windowSales: sales.length,
    vwap: saleVolume ? Math.round((saleValue / saleVolume) * 100) / 100 : null,
    first,
    last,
  };
}

// Every recorded fill for one set, newest first. Fills are history rows
// written by the 'tcgplayer latest sale' source; 'tcgplayer current market'
// snapshots and 'release date' anchors aren't sales and are excluded. History
// carries no venue/type/id (only one source has ever existed) so those are
// synthesized here; the id's index suffix is a React-key tiebreaker only —
// (date, price, volume) genuinely collides on same-minute duplicate fills.
export function buildTape(history, code) {
  const rows = history?.[code] || [];
  return rows
    .map((row, i) => ({ ...row, ts: parseChartTime(row.date), i }))
    .filter(row => row.ts && row.price > 0 && row.source === 'tcgplayer latest sale')
    .map(row => ({
      id: `${code}-${row.date}-${row.price}-${row.volume}-${row.i}`,
      ts: row.ts,
      timestamp: row.date,
      price: row.price,
      qty: row.volume,
      venue: 'TCGPlayer',
      type: 'SOLD',
    }))
    .sort((a, b) => b.ts - a.ts);
}
