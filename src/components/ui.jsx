import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { t } from './theme.js';
import { signalColor, tierLabel } from './format.js';

export function Sparkline({ data, color, h = 26, w = 90 }) {
  if (!data || data.length === 0) return <div style={{ width: w, height: h, color: t.textDim, fontSize: 10, textAlign: 'center' }}>—</div>;
  const prices = data.map(d => d.price).filter(p => p > 0);
  if (prices.length < 2) return <div style={{ width: w, height: h, color: t.textDim, fontSize: 10, textAlign: 'center' }}>—</div>;
  const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
  const points = prices.map((p, i) => `${(i / (prices.length - 1) * w).toFixed(1)},${(h - (p - min) / range * h).toFixed(1)}`).join(' ');
  return <svg width={w} height={h} style={{ display: 'block' }}><polyline points={points} fill="none" stroke={color} strokeWidth="1.5" /></svg>;
}

export function StatCard({ label, value, sub, color, Icon }) {
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

export function SignalBadge({ signal }) {
  const c = signalColor(signal);
  return <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, padding: '3px 6px', color: c, border: `1px solid ${c}`, fontFamily: 'JetBrains Mono, monospace', background: `${c}12`, whiteSpace: 'nowrap' }}>{signal}</span>;
}

export function TierBadge({ tier }) {
  const c = { grail: t.accent, premium: '#c084fc', mid: t.info, value: t.buy }[tier] || t.textDim;
  return <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, padding: '2px 5px', color: c, fontFamily: 'JetBrains Mono, monospace', background: `${c}10` }}>{tierLabel(tier)}</span>;
}

export function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
      <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: 14, fontWeight: 700, letterSpacing: 2.5, color: t.accent, margin: 0, textTransform: 'uppercase' }}>{title}</h2>
      {subtitle && <span style={{ fontSize: 11, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.5 }}>{subtitle}</span>}
    </div>
  );
}

export function DataRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
      <span style={{ fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 12, color: color || t.textBright, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export function Th({ label, sortKey, cur, dir, onSort, align = 'left', w }) {
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

export function FilterPills({ label, options, value, onChange }) {
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
