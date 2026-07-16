import React from 'react';
import { Star, Search } from 'lucide-react';
import { t } from './theme.js';
import { fmt$, fmtPct, fmtNum } from './format.js';
import { Sparkline, SignalBadge, TierBadge, SectionHeader, Th, FilterPills } from './ui.jsx';

export default function OrderBook({
  filtered, history, search, setSearch, filterTier, setFilterTier, filterSignal, setFilterSignal,
  sortKey, sortDir, setSort, watchlist, toggleWatch, selectedSet, setSelectedSet,
}) {
  return (
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
  );
}
