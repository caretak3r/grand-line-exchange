import React from 'react';
import { t } from './theme.js';

// `days: null` is ALL — the identity window. Order matters for render order
// only; disabled state is computed by the caller (Dashboard.jsx) since it
// depends on the selected set's actual observation span.
export const TIMEFRAME_WINDOWS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y', days: 365 },
  { label: 'ALL', days: null },
];

export default function TimeframeSelector({ buckets, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {buckets.map(b => {
        const active = value === b.days;
        return (
          <button key={b.label} disabled={b.disabled} onClick={() => onChange(b.days)}
            style={{
              padding: '5px 10px',
              background: active ? t.accent : 'transparent',
              color: b.disabled ? t.textDim : active ? t.bgPrimary : t.text,
              border: `1px solid ${active ? t.accent : t.border}`,
              fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
              cursor: b.disabled ? 'not-allowed' : 'pointer',
              letterSpacing: 1, fontWeight: 600,
              opacity: b.disabled ? 0.4 : 1,
            }}>
            {b.label}
          </button>
        );
      })}
    </div>
  );
}
