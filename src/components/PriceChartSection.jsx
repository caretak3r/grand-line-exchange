import React from 'react';
import {
  Area, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { t } from './theme.js';
import { fmt$, fmtPct, fmtNum, fmtChartDate, fmtAxisDate, observationDomain } from './format.js';
import { SignalBadge, TierBadge, DataRow } from './ui.jsx';

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

export default function PriceChartSection({ selected, chartData, selectedFirst, selectedLast, selectedAllTimeChange }) {
  return (
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
  );
}
