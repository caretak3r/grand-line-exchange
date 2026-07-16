import React from 'react';
import { t } from './theme.js';
import { fmt$, timeAgo } from './format.js';
import { SectionHeader } from './ui.jsx';

export default function LiveTape({ txns }) {
  return (
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
  );
}
