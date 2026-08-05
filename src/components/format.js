import { t } from './theme.js';

// ─── HELPERS ───────────────────────────────────────────────────────────────
export const fmt$ = (n) => !n ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
export const fmtPct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
export const fmtNum = (n) => n.toLocaleString('en-US');
export const fmtChartDate = (ts) => {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
};
export const fmtShortChartDate = (ts) => {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
};
// Explicit UTC — for contexts that must not drift with the viewer's local
// zone (e.g. the per-set tape's absolute fill dates), unlike fmtChartDate.
export const fmtUtcDate = (ts) => {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';
};
export const fmtAxisDate = (rows, formatter = fmtShortChartDate) => (value) => {
  const row = rows[Math.max(0, Math.min(rows.length - 1, Math.round(value)))];
  return row ? formatter(row.ts) : '—';
};
export const observationDomain = (rows) => [0, Math.max(1, rows.length - 1)];
export const fmtIndex = (n) => Number.isFinite(n) ? n.toFixed(1) : '—';
export const timeAgo = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};
export const signalColor = (s) => ({
  'STRONG BUY': t.buy, 'BUY': '#5dd99f', 'HOLD': t.textDim, 'WATCH': t.warn,
  'SELL': t.sell, 'PREORDER': t.info,
}[s] || t.text);
export const tierLabel = (x) => ({ grail: 'GRAIL', premium: 'PREMIUM', mid: 'MID-CAP', value: 'VALUE' }[x] || x.toUpperCase());
