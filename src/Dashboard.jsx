import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import SET_METADATA from './data/sets.json';
import { buildChartData, sliceWindow, buildIndexData, computeMarketStats, pctChange } from './lib/analytics.js';
import { t } from './components/theme.js';
import { LoadingScreen, ErrorScreen } from './components/StatusScreens.jsx';
import HeaderBar from './components/HeaderBar.jsx';
import Ticker from './components/Ticker.jsx';
import MarketPulse from './components/MarketPulse.jsx';
import MoversPanel from './components/MoversPanel.jsx';
import PriceChartSection from './components/PriceChartSection.jsx';
import { TIMEFRAME_WINDOWS } from './components/TimeframeSelector.jsx';
import OrderBook from './components/OrderBook.jsx';
import GrandLineIndex from './components/GrandLineIndex.jsx';
import LiveTape from './components/LiveTape.jsx';
import DecisionMatrix from './components/DecisionMatrix.jsx';
import PageFooter from './components/PageFooter.jsx';

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

// ─── MAIN ──────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { loading, error, market, history, txns, reload } = useMarketData();
  const [selectedSet, setSelectedSet] = useState('OP-13');
  const [timeframe, setTimeframe] = useState(null); // null = ALL
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

  // A window picked for one set is meaningless for another — snap back to ALL.
  useEffect(() => { setTimeframe(null); }, [selectedSet]);

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

  // buildChartData() always runs on the full history first; sliceWindow()
  // then trims + re-indexes for the active timeframe. Never slice history
  // before buildChartData — MAs need the full series to compute correctly.
  const chartData = useMemo(() => buildChartData(selectedHistory), [selectedHistory]);
  const windowedChartData = useMemo(() => sliceWindow(chartData, timeframe), [chartData, timeframe]);
  const windowFirst = windowedChartData[0];
  const windowLast = windowedChartData[windowedChartData.length - 1];

  // All-time change stays anchored to the full series regardless of the
  // active timeframe — the windowed delta is a separate figure (ey9.4).
  const allTimeFirst = chartData[0];
  const allTimeLast = chartData[chartData.length - 1];
  const selectedAllTimeChange = allTimeFirst && allTimeLast ? pctChange(allTimeFirst.price, allTimeLast.price) : 0;

  // A bucket is disabled when it can't cut anything off the full series —
  // i.e. every observation already falls inside the window, so it would
  // render a chart identical to ALL. Truthful data over pretty data.
  const timeframeBuckets = useMemo(() => TIMEFRAME_WINDOWS.map(b => ({
    ...b,
    disabled: b.days !== null && (chartData.length === 0 || sliceWindow(chartData, b.days).length === chartData.length),
  })), [chartData]);

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

      <HeaderBar market={market} reload={reload} />

      <Ticker active={active} />

      <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>

        <MarketPulse totalCap={totalCap} totalVol={totalVol} avgChange={avgChange}
          gainers={gainers} losers={losers} buys={buys}
          active={active} sets={sets} watchlist={watchlist} />

        {/* MOVERS */}
        <section style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <MoversPanel title="TOP GAINERS" Icon={TrendingUp} color={t.buy} sets={topGainers} onSelect={setSelectedSet} />
          <MoversPanel title="TOP LOSERS / WATCH" Icon={TrendingDown} color={t.sell} sets={topLosers} onSelect={setSelectedSet} />
        </section>

        {selected && (
          <PriceChartSection selected={selected} chartData={windowedChartData}
            selectedFirst={windowFirst} selectedLast={windowLast}
            selectedAllTimeChange={selectedAllTimeChange}
            timeframe={timeframe} setTimeframe={setTimeframe} timeframeBuckets={timeframeBuckets} />
        )}

        <OrderBook filtered={filtered} history={history}
          search={search} setSearch={setSearch}
          filterTier={filterTier} setFilterTier={setFilterTier}
          filterSignal={filterSignal} setFilterSignal={setFilterSignal}
          sortKey={sortKey} sortDir={sortDir} setSort={setSort}
          watchlist={watchlist} toggleWatch={toggleWatch}
          selectedSet={selectedSet} setSelectedSet={setSelectedSet} />

        <GrandLineIndex indexData={indexData} indexLast={indexLast} indexAllTimeChange={indexAllTimeChange} />

        <LiveTape txns={txns} />

        <DecisionMatrix active={active} selectedSet={selectedSet} setSelectedSet={setSelectedSet} />

        <PageFooter market={market} sets={sets} />
      </div>
    </div>
  );
}
