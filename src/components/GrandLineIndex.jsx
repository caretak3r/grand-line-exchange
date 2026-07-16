import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { t } from './theme.js';
import { fmt$, fmtPct, fmtChartDate, fmtAxisDate, observationDomain, fmtIndex } from './format.js';
import { SectionHeader, DataRow } from './ui.jsx';

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

export default function GrandLineIndex({ indexData, indexLast, indexAllTimeChange }) {
  return (
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
  );
}
