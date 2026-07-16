import React from 'react';
import { t } from './theme.js';
import { fmt$, fmtPct } from './format.js';

export default function Ticker({ active }) {
  return (
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
  );
}
