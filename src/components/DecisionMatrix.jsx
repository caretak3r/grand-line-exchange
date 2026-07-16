import React from 'react';
import { t } from './theme.js';
import { fmt$, fmtPct } from './format.js';
import { SectionHeader, SignalBadge } from './ui.jsx';

export default function DecisionMatrix({ active, selectedSet, setSelectedSet }) {
  return (
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
  );
}
