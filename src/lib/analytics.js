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

// Trailing time window over buildChartData() output, re-indexed for the
// chart's positional axis (0..n-1). MAs are already baked into `rows` and
// carry through unchanged. Anchored off the last observation's ts, not
// Date.now(), so a stale set still renders its own trailing window.
// `days === null` returns all rows (identity).
export function sliceWindow(rows, days) {
  if (!rows.length) return [];
  if (days === null) return rows;
  const cutoff = rows[rows.length - 1].ts - days * 86400000;
  return rows.filter(row => row.ts >= cutoff).map((row, i) => ({ ...row, axis: i }));
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
