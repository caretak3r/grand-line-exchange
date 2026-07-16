import React from 'react';
import { t } from './theme.js';
import { fmt$, fmtPct } from './format.js';

export default function MoversPanel({ title, Icon, color, sets, onSelect }) {
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
