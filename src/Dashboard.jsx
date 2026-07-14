import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Activity, Star, AlertCircle, Anchor,
  ChevronUp, ChevronDown, Search, Target, DollarSign, Package, RefreshCw,
} from 'lucide-react';
import SET_METADATA from './data/sets.json';
import { buildChartData, buildIndexData, computeMarketStats, pctChange } from './lib/analytics.js';

// ─── STYLE TOKENS ──────────────────────────────────────────────────────────
const t = {
  bgPrimary: '#0a0e14', bgSecondary: '#0f141c', bgTertiary: '#151c26', bgHover: '#1a2330',
  border: '#1f2a38', borderBright: '#2a3a4f',
  text: '#d4dae3', textDim: '#7a8a9e', textBright: '#ffffff',
  accent: '#d4a857', accentDim: '#8a6d33',
  buy: '#26d97f', sell: '#ff4757', warn: '#ffb341', info: '#54aaff',
  grid: '#1a2330',
};

// ─── HELPERS ───────────────────────────────────────────────────────────────
const fmt$ = (n) => !n ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
const fmtPct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const fmtNum = (n) => n.toLocaleString('en-US');
const fmtChartDate = (ts) => {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
};
const fmtShortChartDate = (ts) => {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
};
const fmtAxisDate = (rows, formatter = fmtShortChartDate) => (value) => {
  const row = rows[Math.max(0, Math.min(rows.length - 1, Math.round(value)))];
  return row ? formatter(row.ts) : '—';
};
const observationDomain = (rows) => [0, Math.max(1, rows.length - 1)];
const fmtIndex = (n) => Number.isFinite(n) ? n.toFixed(1) : '—';
const timeAgo = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};
const signalColor = (s) => ({
  'STRONG BUY': t.buy, 'BUY': '#5dd99f', 'HOLD': t.textDim, 'WATCH': t.warn,
  'SELL': t.sell, 'PREORDER': t.info,
}[s] || t.text);
const tierLabel = (x) => ({ grail: 'GRAIL', premium: 'PREMIUM', mid: 'MID-CAP', value: 'VALUE' }[x] || x.toUpperCase());

// ─── DATA LOADER ───────────────────────────────────────────────────────────
function useMarketData() {
  const [data, setData] = useState({ loading: true, error: null, market: null, history: null, txns: [] });
  const load = async () => {
    setData(d => ({ ...d, loading: true }));
    try {
      // Vite injects the correct base path; data lives in /public/data/
      const base = import.meta.env.BASE_URL;
      const m = await fetch(`${base}data/market.json`, { cache: 'no-store' }).then(r => r.json());
      const v = encodeURIComponent(m.updatedAt || Date.now());
      const [h, x] = await Promise.all([
        fetch(`${base}data/history.json?v=${v}`).then(r => r.json()),
        fetch(`${base}data/transactions.json?v=${v}`).then(r => r.json()),
      ]);
      setData({ loading: false, error: null, market: m, history: h, txns: x });
    } catch (e) {
      setData({ loading: false, error: e.message, market: null, history: null, txns: [] });
    }
  };
  useEffect(() => { load(); }, []);
  return { ...data, reload: load };
}

// ─── COMPONENTS ────────────────────────────────────────────────────────────

function Sparkline({ data, color, h = 26, w = 90 }) {
  if (!data || data.length === 0) return <div style={{ width: w, height: h, color: t.textDim, fontSize: 10, textAlign: 'center' }}>—</div>;
  const prices = data.map(d => d.price).filter(p => p > 0);
  if (prices.length < 2) return <div style={{ width: w, height: h, color: t.textDim, fontSize: 10, textAlign: 'center' }}>—</div>;
  const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
  const points = prices.map((p, i) => `${(i / (prices.length - 1) * w).toFixed(1)},${(h - (p - min) / range * h).toFixed(1)}`).join(' ');
  return <svg width={w} height={h} style={{ display: 'block' }}><polyline points={points} fill="none" stroke={color} strokeWidth="1.5" /></svg>;
}

function StatCard({ label, value, sub, color, Icon }) {
  return (
    <div style={{ background: t.bgSecondary, border: `1px solid ${t.border}`, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, color: t.textDim, fontFamily: 'JetBrains Mono, ui-monospace, monospace', textTransform: 'uppercase' }}>{label}</div>
        {Icon && <Icon size={14} style={{ color: color || t.accent, opacity: 0.7 }} />}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color || t.textBright, fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: t.textDim, marginTop: 4, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{sub}</div>}
      <div style={{ position: 'absolute', top: 0, left: 0, height: 2, width: '100%', background: `linear-gradient(90deg, ${color || t.accent}, transparent)` }} />
    </div>
  );
}

function SignalBadge({ signal }) {
  const c = signalColor(signal);
  return <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, padding: '3px 6px', color: c, border: `1px solid ${c}`, fontFamily: 'JetBrains Mono, monospace', background: `${c}12`, whiteSpace: 'nowrap' }}>{signal}</span>;
}

function TierBadge({ tier }) {
  const c = { grail: t.accent, premium: '#c084fc', mid: t.info, value: t.buy }[tier] || t.textDim;
  return <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, padding: '2px 5px', color: c, fontFamily: 'JetBrains Mono, monospace', background: `${c}10` }}>{tierLabel(tier)}</span>;
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
      <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: 14, fontWeight: 700, letterSpacing: 2.5, color: t.accent, margin: 0, textTransform: 'uppercase' }}>{title}</h2>
      {subtitle && <span style={{ fontSize: 11, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.5 }}>{subtitle}</span>}
    </div>
  );
}

function DataRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
      <span style={{ fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 12, color: color || t.textBright, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function PriceVolumeTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter(p => ['price', 'ma7', 'ma30', 'volume'].includes(p.dataKey));
  const labels = { price: 'Price', ma7: '7d MA', ma30: '30d MA', volume: 'Volume' };
  const row = payload[0]?.payload || {};
  return (
    <div style={{ background: t.bgTertiary, border: `1px solid ${t.borderBright}`, padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
      <div style={{ color: t.accent, marginBottom: 6 }}>{fmtChartDate(row.ts || label)}</div>
      {rows.map(r => (
        <div key={r.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 18, color: t.text }}>
          <span style={{ color: r.color || t.textDim }}>{labels[r.dataKey]}</span>
          <span>{r.dataKey === 'volume' ? `${fmtNum(r.value)} units` : fmt$(r.value)}</span>
        </div>
      ))}
      {row.source && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${t.border}`, color: t.textDim }}>
          Source: <span style={{ color: t.text }}>{row.source}</span>
        </div>
      )}
    </div>
  );
}

function IndexTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div style={{ background: t.bgTertiary, border: `1px solid ${t.borderBright}`, padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
      <div style={{ color: t.accent, marginBottom: 6 }}>{fmtChartDate(row.ts)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, color: t.text }}>
        <span style={{ color: t.textDim }}>Index</span>
        <span>{fmtIndex(row.index)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, color: t.text }}>
        <span style={{ color: t.textDim }}>Avg price</span>
        <span>{fmt$(row.avgPrice)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, color: t.text }}>
        <span style={{ color: t.textDim }}>Coverage</span>
        <span>{row.coverage}/{row.totalSets} boxes</span>
      </div>
      {row.changed && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${t.border}`, color: t.textDim }}>
          Last update: <span style={{ color: t.accent }}>{row.changed}</span>
        </div>
      )}
    </div>
  );
}

function Th({ label, sortKey, cur, dir, onSort, align = 'left', w }) {
  const active = sortKey && cur === sortKey;
  return (
    <th onClick={sortKey ? () => onSort(sortKey) : undefined}
      style={{ padding: '10px 8px', textAlign: align, color: active ? t.accent : t.textDim, fontWeight: 600, letterSpacing: 1, fontSize: 10, cursor: sortKey ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap', width: w }}>
      {label}
      {active && (dir === 'asc'
        ? <ChevronUp size={11} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} />
        : <ChevronDown size={11} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} />)}
    </th>
  );
}

function FilterPills({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1, marginRight: 4 }}>{label}:</span>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          style={{ padding: '5px 10px', background: value === o ? t.accent : 'transparent', color: value === o ? t.bgPrimary : t.text, border: `1px solid ${value === o ? t.accent : t.border}`, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', letterSpacing: 1, fontWeight: 600 }}>
          {o.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function MoversPanel({ title, Icon, color, sets, onSelect }) {
  return (
    <div style={{ background: t.bgSecondary, border: `1px solid ${t.border}`, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon size={16} style={{ color }} />
        <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: 13, fontWeight: 700, letterSpacing: 2, color, margin: 0, textTransform: 'uppercase' }}>{title}</h3>
      </div>
      {sets.map(s => (
        <button key={s.code} onClick={() => onSelect(s.code)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${t.border}`, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', textAlign: 'left' }}
          className="row-hover">
          <div>
            <div style={{ fontSize: 11, color: t.accent, fontWeight: 700 }}>{s.code}</div>
            <div style={{ fontSize: 11, color: t.text, marginTop: 2 }}>{s.short}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: t.textBright, fontWeight: 600 }}>{fmt$(s.price)}</div>
            <div style={{ fontSize: 11, color: s.change30d >= 0 ? t.buy : t.sell, fontWeight: 600 }}>
              {s.change30d >= 0 ? '▲' : '▼'} {fmtPct(s.change30d)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { loading, error, market, history, txns, reload } = useMarketData();
  const [selectedSet, setSelectedSet] = useState('OP-13');
  const [sortKey, setSortKey] = useState('change30d');
  const [sortDir, setSortDir] = useState('desc');
  const [filterTier, setFilterTier] = useState('all');
  const [filterSignal, setFilterSignal] = useState('all');
  const [search, setSearch] = useState('');
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem('op_watchlist') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    try { localStorage.setItem('op_watchlist', JSON.stringify(watchlist)); } catch {}
  }, [watchlist]);

  // Merge metadata + live quotes
  const sets = useMemo(() => {
    if (!market) return [];
    return SET_METADATA.map(meta => ({
      ...meta,
      ...(market.quotes[meta.code] || { price: 0, change30d: 0, high52w: 0, low52w: 0, volume30d: 0, listings: 0, soldLast7d: 0, bid: 0, ask: 0, spread: 0, rsi: 50, momentum: 'neutral', signal: 'HOLD', stale: true }),
    }));
  }, [market]);

  const toggleWatch = (code) => setWatchlist(w => w.includes(code) ? w.filter(c => c !== code) : [...w, code]);
  const setSort = (k) => { sortKey === k ? setSortDir(d => d === 'asc' ? 'desc' : 'asc') : (setSortKey(k), setSortDir('desc')); };

  const filtered = useMemo(() => {
    let l = sets;
    if (filterTier !== 'all') l = l.filter(s => s.tier === filterTier);
    if (filterSignal !== 'all') l = l.filter(s => s.signal === filterSignal);
    if (search) {
      const q = search.toLowerCase();
      l = l.filter(s => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    }
    return [...l].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [sets, sortKey, sortDir, filterTier, filterSignal, search]);

  const selected = sets.find(s => s.code === selectedSet) || sets[0];
  const selectedHistory = selected ? (history?.[selected.code] || []) : [];

  const chartData = useMemo(() => buildChartData(selectedHistory), [selectedHistory]);
  const selectedFirst = chartData[0];
  const selectedLast = chartData[chartData.length - 1];
  const selectedAllTimeChange = selectedFirst && selectedLast ? pctChange(selectedFirst.price, selectedLast.price) : 0;

  const { active, totalCap, totalVol, avgChange, gainers, losers, buys, topGainers, topLosers } = computeMarketStats(sets);

  const indexData = useMemo(() => buildIndexData(history, sets), [history, sets]);
  const indexFirst = indexData[0];
  const indexLast = indexData[indexData.length - 1];
  const indexAllTimeChange = indexFirst && indexLast ? pctChange(indexFirst.index, indexLast.index) : 0;

  // ─── LOADING / ERROR STATES ────────────────────────────────────────────
  if (loading) return <LoadingScreen />;
  if (error || !market) return <ErrorScreen error={error || 'No market data'} onRetry={reload} />;

  // ─── RENDER ────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', background: t.bgPrimary, color: t.text,
      fontFamily: '"Inter Tight", -apple-system, sans-serif',
      backgroundImage: `radial-gradient(circle at 20% 0%, ${t.accent}08 0%, transparent 50%), radial-gradient(circle at 80% 100%, ${t.info}06 0%, transparent 50%)`,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Cinzel:wght@600;700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: ${t.bgSecondary}; }
        ::-webkit-scrollbar-thumb { background: ${t.borderBright}; }
        ::-webkit-scrollbar-thumb:hover { background: ${t.accentDim}; }
        .row-hover:hover { background: ${t.bgHover} !important; }
        .blink { animation: blink 1.5s ease-in-out infinite; }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .ticker-scroll { animation: scroll 90s linear infinite; }
        @keyframes scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .sticky-top { position: sticky; top: 0; z-index: 50; }
        .sticky-ticker { position: sticky; top: 65px; z-index: 45; }
        @media (max-width: 900px) {
          .sticky-top, .sticky-ticker { position: static; }
        }
      `}</style>

      <header className="sticky-top" style={{ borderBottom: `1px solid ${t.border}`, background: t.bgSecondary, padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backdropFilter: 'blur(8px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Anchor size={26} style={{ color: t.accent }} />
          <div>
            <div style={{ fontFamily: 'Cinzel, serif', fontSize: 18, fontWeight: 800, letterSpacing: 1.5, color: t.textBright }}>
              GRAND LINE <span style={{ color: t.accent }}>EXCHANGE</span>
            </div>
            <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 1.5, fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>
              One Piece TCG · Sealed Booster Box Trading Terminal
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="blink" style={{ width: 8, height: 8, borderRadius: '50%', background: t.buy, display: 'inline-block' }} />
            <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: t.textDim, letterSpacing: 1 }}>
              UPDATED {timeAgo(market.updatedAt)} AGO
            </span>
          </div>
          <button onClick={reload} title="Reload data"
            style={{ background: 'none', border: `1px solid ${t.border}`, color: t.textDim, padding: '6px 8px', cursor: 'pointer' }}>
            <RefreshCw size={12} />
          </button>
          <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: t.textDim }}>
            SOURCE: {market.source?.toUpperCase() || 'TCGPLAYER'}
          </div>
        </div>
      </header>

      {/* TICKER */}
      <div className="sticky-ticker" style={{ borderBottom: `1px solid ${t.border}`, background: t.bgPrimary, overflow: 'hidden', height: 32 }}>
        <div className="ticker-scroll" style={{ display: 'inline-flex', whiteSpace: 'nowrap', height: '100%', alignItems: 'center' }}>
          {[...active, ...active].map((s, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 24px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
              <span style={{ color: t.accent, fontWeight: 600 }}>{s.code}</span>
              <span style={{ color: t.textBright }}>{fmt$(s.price)}</span>
              <span style={{ color: s.change30d >= 0 ? t.buy : t.sell, fontWeight: 600 }}>
                {s.change30d >= 0 ? '▲' : '▼'} {fmtPct(s.change30d)}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>

        {/* MARKET PULSE */}
        <section style={{ marginBottom: 24 }}>
          <SectionHeader title="MARKET PULSE" subtitle="30-day rolling aggregates across all sealed English booster boxes" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
            <StatCard label="Market Cap (30d Vol×Price)" value={`$${(totalCap / 1000).toFixed(1)}K`} sub={`${fmtNum(totalVol)} boxes traded`} Icon={DollarSign} color={t.accent} />
            <StatCard label="Avg 30d Change" value={fmtPct(avgChange)} sub={`${gainers} up · ${losers} down`} Icon={Activity} color={avgChange >= 0 ? t.buy : t.sell} />
            <StatCard label="Active Buy Signals" value={`${buys}/${active.length}`} sub="Strong + Standard" Icon={Target} color={t.buy} />
            <StatCard label="Tracked Sets" value={sets.length} sub={`${active.length} active`} Icon={Package} color={t.info} />
            <StatCard label="Watchlist" value={watchlist.length} sub="Tap ★ on any row" Icon={Star} color={t.warn} />
          </div>
        </section>

        {/* MOVERS */}
        <section style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <MoversPanel title="TOP GAINERS" Icon={TrendingUp} color={t.buy} sets={topGainers} onSelect={setSelectedSet} />
          <MoversPanel title="TOP LOSERS / WATCH" Icon={TrendingDown} color={t.sell} sets={topLosers} onSelect={setSelectedSet} />
        </section>

        {/* CHART + DETAIL */}
        {selected && (
          <section style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 16 }}>
            <div style={{ background: t.bgSecondary, border: `1px solid ${t.border}`, padding: 20, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: t.accent, fontWeight: 700, letterSpacing: 1 }}>{selected.code}</span>
                    <TierBadge tier={selected.tier} />
                    <SignalBadge signal={selected.signal} />
                  </div>
                  <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: 22, fontWeight: 700, color: t.textBright, margin: 0, letterSpacing: 0.5 }}>{selected.name}</h2>
                  <div style={{ fontSize: 11, color: t.textDim, marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                    Released {selected.released} · MSRP {fmt$(selected.msrp)} · Block {selected.block || 'EXTRA'}
                  </div>
                  <div style={{ fontSize: 10, color: t.textDim, marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                    All-time observation view · {fmtNum(chartData.length)} verified points · {selectedFirst ? fmtChartDate(selectedFirst.ts) : '—'} → {selectedLast ? fmtChartDate(selectedLast.ts) : '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 32, fontWeight: 700, color: t.textBright, letterSpacing: -0.5 }}>{fmt$(selected.price)}</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, color: selected.change30d >= 0 ? t.buy : t.sell }}>
                    {selected.change30d >= 0 ? '▲' : '▼'} {fmt$(Math.abs(selected.price - (selected.prev || selected.price)))} ({fmtPct(selected.change30d)})
                  </div>
                  <div style={{ fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', marginTop: 4 }}>30d change</div>
                </div>
              </div>

              <div style={{ height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <defs>
                      <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={t.accent} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={t.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="axis" type="number" domain={observationDomain(chartData)} tick={{ fill: t.textDim, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} stroke={t.border} tickFormatter={fmtAxisDate(chartData)} />
                    <YAxis yAxisId="price" tick={{ fill: t.textDim, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} stroke={t.border} domain={['dataMin - 20', 'dataMax + 20']} tickFormatter={(v) => `$${v}`} />
                    <YAxis yAxisId="volume" orientation="right" hide domain={[0, dataMax => Math.max(1, dataMax * 3.5)]} />
                    <Tooltip content={<PriceVolumeTooltip />} cursor={{ fill: `${t.accent}08` }} />
                    <Bar yAxisId="volume" dataKey="volume" name="Volume" fill={t.accentDim} fillOpacity={0.38} barSize={14} />
                    <Area yAxisId="price" type="monotone" dataKey="price" name="Price" stroke={t.accent} fill="url(#priceGrad)" strokeWidth={2} dot={false} />
                    <Line yAxisId="price" type="monotone" dataKey="ma7" name="7d MA" stroke={t.info} strokeWidth={1} dot={false} strokeDasharray="3 3" />
                    <Line yAxisId="price" type="monotone" dataKey="ma30" name="30d MA" stroke={t.sell} strokeWidth={1} dot={false} strokeDasharray="5 3" />
                    <ReferenceLine yAxisId="price" y={selected.msrp} stroke={t.textDim} strokeDasharray="2 6" label={{ value: 'MSRP', fill: t.textDim, fontSize: 9, position: 'right' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'flex', gap: 16, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: t.textDim, marginTop: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <span><span style={{ color: t.accentDim }}>▮</span> Volume</span>
                <span><span style={{ color: t.accent }}>━</span> Price</span>
                <span><span style={{ color: t.info }}>┄</span> 7d MA</span>
                <span><span style={{ color: t.sell }}>┄</span> 30d MA</span>
                <span><span style={{ color: t.textDim }}>┄</span> MSRP</span>
                <span>All-time Δ <span style={{ color: selectedAllTimeChange >= 0 ? t.buy : t.sell }}>{fmtPct(selectedAllTimeChange)}</span></span>
              </div>
            </div>

            <div style={{ background: t.bgSecondary, border: `1px solid ${t.border}`, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 1.5, fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>QUOTE BOOK</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <DataRow label="Bid" value={fmt$(selected.bid)} color={t.buy} />
                  <DataRow label="Ask" value={fmt$(selected.ask)} color={t.sell} />
                  <DataRow label="Spread" value={`${(selected.spread || 0).toFixed(1)}%`} color={selected.spread > 12 ? t.warn : t.text} />
                  <DataRow label="Mid" value={fmt$((selected.bid + selected.ask) / 2)} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 1.5, fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>RANGE</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <DataRow label="52w High" value={fmt$(selected.high52w)} />
                  <DataRow label="52w Low" value={fmt$(selected.low52w)} />
                  <DataRow label="From High" value={selected.high52w ? fmtPct((selected.price - selected.high52w) / selected.high52w * 100) : '—'} color={t.sell} />
                  <DataRow label="From Low" value={selected.low52w ? fmtPct((selected.price - selected.low52w) / selected.low52w * 100) : '—'} color={t.buy} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 1.5, fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>VOLUME & LIQUIDITY</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <DataRow label="30d Vol" value={fmtNum(selected.volume30d)} />
                  <DataRow label="7d Sold" value={fmtNum(selected.soldLast7d)} />
                  <DataRow label="Listings" value={fmtNum(selected.listings)} />
                  <DataRow label="Vs MSRP" value={selected.price ? fmtPct((selected.price - selected.msrp) / selected.msrp * 100) : '—'} color={t.accent} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 1.5, fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>TECHNICAL</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', minWidth: 40 }}>RSI</span>
                  <div style={{ flex: 1, height: 6, background: t.bgTertiary, position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${selected.rsi}%`, background: selected.rsi > 70 ? t.sell : selected.rsi < 30 ? t.buy : t.accent }} />
                    <div style={{ position: 'absolute', left: '30%', top: 0, height: '100%', width: 1, background: t.border }} />
                    <div style={{ position: 'absolute', left: '70%', top: 0, height: '100%', width: 1, background: t.border }} />
                  </div>
                  <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: t.text, minWidth: 24, textAlign: 'right' }}>{selected.rsi}</span>
                </div>
                <div style={{ fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono, monospace' }}>
                  Momentum: <span style={{ color: selected.momentum === 'bullish' ? t.buy : selected.momentum === 'bearish' ? t.sell : t.warn, fontWeight: 600, textTransform: 'uppercase' }}>{selected.momentum}</span>
                </div>
              </div>
              <div style={{ padding: 12, background: t.bgTertiary, borderLeft: `3px solid ${t.accent}`, fontSize: 11, lineHeight: 1.5, color: t.text }}>
                <div style={{ fontSize: 9, color: t.accent, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1.5, marginBottom: 4 }}>ANALYST NOTE</div>
                {selected.notes}
              </div>
              <a href={selected.tcgUrl} target="_blank" rel="noopener noreferrer"
                style={{ padding: '10px 14px', background: t.accent, color: t.bgPrimary, textAlign: 'center', fontSize: 11, fontWeight: 700, letterSpacing: 2, fontFamily: 'JetBrains Mono, monospace', textDecoration: 'none', textTransform: 'uppercase' }}>
                View on TCGPlayer ↗
              </a>
            </div>
          </section>
        )}

        {/* ORDER BOOK */}
        <section style={{ marginBottom: 24 }}>
          <SectionHeader title="ORDER BOOK · ALL BOOSTER BOXES" subtitle="Click any row to load chart · ★ to add to watchlist · Click headers to sort" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: t.textDim }} />
              <input placeholder="Search code or name..." value={search} onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%', padding: '8px 12px 8px 30px', background: t.bgSecondary, border: `1px solid ${t.border}`, color: t.text, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', outline: 'none' }} />
            </div>
            <FilterPills label="Tier" options={['all', 'grail', 'premium', 'mid', 'value']} value={filterTier} onChange={setFilterTier} />
            <FilterPills label="Signal" options={['all', 'STRONG BUY', 'BUY', 'HOLD', 'WATCH', 'PREORDER']} value={filterSignal} onChange={setFilterSignal} />
          </div>
          <div style={{ background: t.bgSecondary, border: `1px solid ${t.border}`, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
              <thead>
                <tr style={{ background: t.bgTertiary, borderBottom: `1px solid ${t.borderBright}` }}>
                  <Th label="" w={36} />
                  <Th label="CODE" sortKey="code" cur={sortKey} dir={sortDir} onSort={setSort} w={92} />
                  <Th label="NAME / TIER" w={220} />
                  <Th label="PRICE" sortKey="price" cur={sortKey} dir={sortDir} onSort={setSort} align="right" />
                  <Th label="30D %" sortKey="change30d" cur={sortKey} dir={sortDir} onSort={setSort} align="right" />
                  <Th label="BID/ASK" align="right" w={120} />
                  <Th label="52W RANGE" w={140} />
                  <Th label="VOL 30D" sortKey="volume30d" cur={sortKey} dir={sortDir} onSort={setSort} align="right" />
                  <Th label="VS MSRP" align="right" />
                  <Th label="TREND" w={110} />
                  <Th label="SIGNAL" w={110} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const watched = watchlist.includes(s.code);
                  const sel = selectedSet === s.code;
                  const rangePct = s.high52w === s.low52w ? 50 : ((s.price - s.low52w) / Math.max(1, s.high52w - s.low52w)) * 100;
                  const vsMsrp = s.price ? (s.price - s.msrp) / s.msrp * 100 : 0;
                  return (
                    <tr key={s.code} className="row-hover" onClick={() => setSelectedSet(s.code)}
                      style={{ borderBottom: `1px solid ${t.border}`, cursor: 'pointer', background: sel ? t.bgHover : 'transparent' }}>
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        <button onClick={(e) => { e.stopPropagation(); toggleWatch(s.code); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          <Star size={14} fill={watched ? t.warn : 'none'} stroke={watched ? t.warn : t.textDim} />
                        </button>
                      </td>
                      <td style={{ padding: '10px 8px', color: t.accent, fontWeight: 600 }}>{s.code}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{ color: t.textBright, fontWeight: 500, marginBottom: 2 }}>{s.short}</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <TierBadge tier={s.tier} />
                          {s.status === 'rotated' && <span style={{ fontSize: 9, color: t.textDim, padding: '2px 5px', background: t.bgTertiary }}>ROTATED</span>}
                          {s.status === 'preorder' && <span style={{ fontSize: 9, color: t.info, padding: '2px 5px', background: `${t.info}10` }}>PREORDER</span>}
                          {s.stale && s.price > 0 && <span style={{ fontSize: 9, color: t.warn, padding: '2px 5px', background: `${t.warn}10` }}>CACHED</span>}
                        </div>
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: t.textBright, fontWeight: 600, fontSize: 13 }}>{fmt$(s.price)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: s.change30d >= 0 ? t.buy : t.sell, fontWeight: 600 }}>
                        {s.price ? `${s.change30d >= 0 ? '▲' : '▼'} ${fmtPct(s.change30d)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: t.textDim, fontSize: 11 }}>
                        {s.bid ? <><span style={{ color: t.buy }}>{fmt$(s.bid)}</span> · <span style={{ color: t.sell }}>{fmt$(s.ask)}</span></> : '—'}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        {s.high52w ? (
                          <div>
                            <div style={{ height: 4, background: t.bgTertiary, position: 'relative', marginBottom: 3 }}>
                              <div style={{ position: 'absolute', left: `${rangePct}%`, top: -2, width: 2, height: 8, background: t.accent }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: t.textDim }}>
                              <span>{fmt$(s.low52w)}</span><span>{fmt$(s.high52w)}</span>
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: t.text }}>{s.volume30d ? fmtNum(s.volume30d) : '—'}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: vsMsrp >= 0 ? t.buy : t.sell, fontWeight: 600 }}>
                        {s.price ? fmtPct(vsMsrp) : '—'}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <Sparkline data={history?.[s.code]} color={s.change30d >= 0 ? t.buy : t.sell} />
                      </td>
                      <td style={{ padding: '10px 8px' }}><SignalBadge signal={s.signal} /></td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={11} style={{ padding: 40, textAlign: 'center', color: t.textDim }}>No sets match current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* GRAND LINE INDEX */}
        <section style={{ marginBottom: 24, background: t.bgSecondary, border: `1px solid ${t.border}`, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <SectionHeader title="GRAND LINE INDEX" subtitle="All-time equal-weighted index · each booster box starts at 100 on first verified price" />
            {indexData.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(90px, 1fr))', gap: 12, minWidth: 420 }}>
                <DataRow label="Index Lvl" value={fmtIndex(indexLast.index)} color={t.accent} />
                <DataRow label="All-time Δ" value={fmtPct(indexAllTimeChange)} color={indexAllTimeChange >= 0 ? t.buy : t.sell} />
                <DataRow label="Coverage" value={`${indexLast.coverage}/${indexLast.totalSets}`} color={indexLast.coverage === indexLast.totalSets ? t.buy : t.warn} />
                <DataRow label="Avg Box" value={fmt$(indexLast.avgPrice)} color={t.info} />
              </div>
            )}
          </div>
          <div style={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={indexData}>
                <defs>
                  <linearGradient id="idxGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={t.buy} stopOpacity={0.34} />
                    <stop offset="100%" stopColor={t.buy} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="axis" type="number" domain={observationDomain(indexData)} tick={{ fill: t.textDim, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} stroke={t.border} tickFormatter={fmtAxisDate(indexData)} minTickGap={28} />
                <YAxis tick={{ fill: t.textDim, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} stroke={t.border} domain={['dataMin - 5', 'dataMax + 5']} tickFormatter={(v) => fmtIndex(v)} />
                <Tooltip content={<IndexTooltip />} cursor={{ fill: `${t.buy}08` }} />
                <Area type="monotone" dataKey="index" stroke={t.buy} fill="url(#idxGrad)" strokeWidth={2.4} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: t.textDim, marginTop: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <span><span style={{ color: t.buy }}>━</span> Base-100 equal-weight index</span>
            <span>Observation-spaced axis keeps all-time points readable</span>
            <span>Tooltip preserves real TCGPlayer timestamps</span>
          </div>
        </section>

        {/* LIVE TAPE */}
        <section style={{ marginBottom: 24, background: t.bgSecondary, border: `1px solid ${t.border}`, padding: 18 }}>
          <SectionHeader title="LIVE TAPE" subtitle="Recent fills across major venues" />
          <div style={{ maxHeight: 340, overflow: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.border}`, color: t.textDim }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500, letterSpacing: 1 }}>TIME</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500, letterSpacing: 1 }}>SET</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500, letterSpacing: 1 }}>TYPE</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 500, letterSpacing: 1 }}>PRICE</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 500, letterSpacing: 1 }}>QTY</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500, letterSpacing: 1 }}>VENUE</th>
                </tr>
              </thead>
              <tbody>
                {(txns || []).slice(0, 30).map(tx => (
                  <tr key={tx.id} className="row-hover" style={{ borderBottom: `1px solid ${t.border}` }}>
                    <td style={{ padding: '7px 8px', color: t.textDim }}>{timeAgo(tx.timestamp)}</td>
                    <td style={{ padding: '7px 8px', color: t.accent, fontWeight: 600 }}>{tx.set}</td>
                    <td style={{ padding: '7px 8px' }}>
                      <span style={{ fontSize: 9, padding: '2px 5px', letterSpacing: 1, fontWeight: 700, color: tx.type === 'SOLD' ? t.buy : tx.type === 'LISTED' ? t.sell : t.warn, background: `${tx.type === 'SOLD' ? t.buy : tx.type === 'LISTED' ? t.sell : t.warn}10` }}>{tx.type}</span>
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: t.textBright, fontWeight: 600 }}>{fmt$(tx.price)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: t.text }}>{tx.qty}</td>
                    <td style={{ padding: '7px 8px', color: t.textDim }}>{tx.venue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* DECISION MATRIX */}
        <section style={{ marginBottom: 24 }}>
          <SectionHeader title="DECISION MATRIX" subtitle="At-a-glance buy/sell zones based on momentum" />
          <div style={{ background: t.bgSecondary, border: `1px solid ${t.border}`, padding: 18, marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {[...active].sort((a, b) => b.change30d - a.change30d).map(s => {
                const intensity = Math.min(1, Math.abs(s.change30d) / 15);
                const bg = s.change30d >= 0 ? `rgba(38, 217, 127, ${intensity * 0.5 + 0.05})` : `rgba(255, 71, 87, ${intensity * 0.5 + 0.05})`;
                return (
                  <button key={s.code} onClick={() => setSelectedSet(s.code)}
                    style={{ padding: 12, background: bg, border: `1px solid ${selectedSet === s.code ? t.accent : t.border}`, cursor: 'pointer', textAlign: 'left', color: t.text, fontFamily: 'JetBrains Mono, monospace' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ color: t.accent, fontWeight: 700, fontSize: 11 }}>{s.code}</span>
                      <SignalBadge signal={s.signal} />
                    </div>
                    <div style={{ fontSize: 14, color: t.textBright, fontWeight: 600, marginBottom: 2 }}>{fmt$(s.price)}</div>
                    <div style={{ fontSize: 11, color: s.change30d >= 0 ? t.buy : t.sell, fontWeight: 600 }}>
                      {s.change30d >= 0 ? '▲' : '▼'} {fmtPct(s.change30d)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section style={{ padding: 16, background: t.bgSecondary, border: `1px solid ${t.border}`, fontSize: 11, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertCircle size={14} style={{ color: t.warn, flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ color: t.warn }}>DATA NOTE:</strong> Prices auto-updated by GitHub Actions hourly from TCGPlayer. Last refresh: <strong style={{ color: t.text }}>{new Date(market.updatedAt).toLocaleString()}</strong>. Volume figures are 30-day estimates. Always verify the live TCGPlayer/eBay quote before placing a trade — sealed TCG product is illiquid and prices can move sharply on reprint announcements. Not financial advice.
            </div>
          </div>
        </section>

        <footer style={{ textAlign: 'center', padding: 24, color: t.textDim, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1.5 }}>
          GRAND LINE EXCHANGE · TRACKING {sets.length} BOOSTER BOXES · DATA: {market.fetched || 0} LIVE / {market.kept || 0} CACHED
        </footer>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', background: t.bgPrimary, color: t.text, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', gap: 16 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      <Anchor size={48} style={{ color: t.accent }} className="spin" />
      <div style={{ fontFamily: 'Cinzel, serif', fontSize: 18, color: t.accent, letterSpacing: 3 }}>LOADING MARKET DATA</div>
      <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 1 }}>FETCHING /data/market.json…</div>
    </div>
  );
}

function ErrorScreen({ error, onRetry }) {
  return (
    <div style={{ minHeight: '100vh', background: t.bgPrimary, color: t.text, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', gap: 16, padding: 24, textAlign: 'center' }}>
      <AlertCircle size={48} style={{ color: t.sell }} />
      <div style={{ fontFamily: 'Cinzel, serif', fontSize: 18, color: t.sell, letterSpacing: 3 }}>DATA UNAVAILABLE</div>
      <div style={{ fontSize: 12, color: t.textDim, maxWidth: 480 }}>
        Could not load market.json. {error}<br/>
        Run <code style={{ color: t.accent }}>python scripts/update-prices.py</code> or check the Actions tab.
      </div>
      <button onClick={onRetry} style={{ padding: '8px 16px', background: t.accent, color: t.bgPrimary, border: 'none', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>
        RETRY
      </button>
    </div>
  );
}
