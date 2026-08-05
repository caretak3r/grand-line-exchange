import React, { useState, useEffect } from 'react';
import { t } from './theme.js';
import { fmt$, fmtNum, fmtUtcDate, timeAgo } from './format.js';
import { SectionHeader } from './ui.jsx';

// Rendered-row cap for per-set mode. A set can carry 3k+ fills — the DOM
// only ever holds this many rows at once; scrolling near the bottom lazily
// raises it. No virtualization lib, just a manual slice.
export const PAGE_SIZE = 60;

function modeButtonStyle(active) {
  return {
    padding: '5px 10px',
    background: active ? t.accent : 'transparent',
    color: active ? t.bgPrimary : t.text,
    border: `1px solid ${active ? t.accent : t.border}`,
    fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
    cursor: 'pointer', letterSpacing: 1, fontWeight: 600,
  };
}

// Tape's own set + window binding is read-only by design: `tape` arrives
// pre-built and pre-windowed from Dashboard.jsx (buildTape + sliceTape,
// keyed off the same selectedSet/timeframe the chart uses) so this
// component never forks its own copy of either. Clicking a set in ALL SETS
// mode is the tape's one write path — it calls setSelectedSet, which moves
// the chart too.
export default function LiveTape({ txns, tape = [], selectedSet, setSelectedSet, timeframe, timeframeBuckets }) {
  const [mode, setMode] = useState('ALL'); // 'ALL' | 'SET' — code always tracks selectedSet
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [mode, selectedSet, timeframe]);

  const handleScroll = (e) => {
    if (mode !== 'SET') return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setVisibleCount(v => Math.min(v + PAGE_SIZE, tape.length));
    }
  };

  const jumpToSet = (code) => {
    if (!setSelectedSet || !code) return;
    setSelectedSet(code);
    setMode('SET');
  };

  const allRows = (txns || []).slice(0, 30);
  const setRows = mode === 'SET' ? tape.slice(0, visibleCount) : [];

  // Active timeframe bucket, same lookup PriceChartSection uses — a label
  // only, not a re-derivation of the window itself (that already happened
  // in Dashboard.jsx before `tape` ever reached this component).
  const activeBucket = timeframeBuckets?.find(b => b.days === timeframe);
  const windowLabel = activeBucket && activeBucket.days !== null ? activeBucket.label : null;

  // First→last fill date span — history is bounded (365d + monthly spine),
  // so this is the true retained coverage, not a claim of continuous data.
  const span = tape.length ? `${fmtUtcDate(tape[tape.length - 1].ts)} → ${fmtUtcDate(tape[0].ts)}` : null;
  const subtitle = mode === 'SET'
    ? (tape.length
        ? `${fmtNum(tape.length)} fills${windowLabel ? ` · ${windowLabel} window` : ''} · ${span}`
        : `No recorded fills for ${selectedSet}${windowLabel ? ` in the ${windowLabel} window` : ''}`)
    : 'Recent fills across major venues';

  return (
    <section style={{ marginBottom: 24, background: t.bgSecondary, border: `1px solid ${t.border}`, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <SectionHeader title="LIVE TAPE" subtitle={subtitle} />
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setMode('ALL')} style={modeButtonStyle(mode === 'ALL')}>ALL SETS</button>
          <button onClick={() => setMode('SET')} style={modeButtonStyle(mode === 'SET')}>{selectedSet || 'SET'}</button>
        </div>
      </div>

      {mode === 'SET' && (
        <div style={{ fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', marginTop: 8, letterSpacing: 1 }}>
          Every row: <span style={{ color: t.buy, fontWeight: 700 }}>SOLD</span> · TCGPlayer
        </div>
      )}

      <div data-testid="tape-scroll" style={{ maxHeight: 340, overflow: 'auto', marginTop: 12 }} onScroll={handleScroll}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
          {mode === 'ALL' ? (
            <>
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
                {allRows.map(tx => (
                  <tr key={tx.id} className="row-hover" style={{ borderBottom: `1px solid ${t.border}` }}>
                    <td style={{ padding: '7px 8px', color: t.textDim }}>{timeAgo(tx.timestamp)}</td>
                    <td onClick={() => jumpToSet(tx.set)}
                      style={{ padding: '7px 8px', color: t.accent, fontWeight: 600, cursor: setSelectedSet ? 'pointer' : 'default' }}>
                      {tx.set}
                    </td>
                    <td style={{ padding: '7px 8px' }}>
                      <span style={{ fontSize: 9, padding: '2px 5px', letterSpacing: 1, fontWeight: 700, color: tx.type === 'SOLD' ? t.buy : tx.type === 'LISTED' ? t.sell : t.warn, background: `${tx.type === 'SOLD' ? t.buy : tx.type === 'LISTED' ? t.sell : t.warn}10` }}>{tx.type}</span>
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: t.textBright, fontWeight: 600 }}>{fmt$(tx.price)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: t.text }}>{tx.qty}</td>
                    <td style={{ padding: '7px 8px', color: t.textDim }}>{tx.venue}</td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.border}`, color: t.textDim }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500, letterSpacing: 1 }}>DATE (UTC)</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 500, letterSpacing: 1 }}>PRICE</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 500, letterSpacing: 1 }}>QTY</th>
                </tr>
              </thead>
              <tbody>
                {setRows.map(fill => (
                  <tr key={fill.id} className="row-hover" style={{ borderBottom: `1px solid ${t.border}` }}>
                    <td style={{ padding: '7px 8px', color: t.textDim }}>{fmtUtcDate(fill.ts)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: t.textBright, fontWeight: 600 }}>{fmt$(fill.price)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: t.text }}>{fill.qty}</td>
                  </tr>
                ))}
                {tape.length === 0 && (
                  <tr><td colSpan={3} style={{ padding: 30, textAlign: 'center', color: t.textDim }}>No recorded fills for {selectedSet}.</td></tr>
                )}
              </tbody>
            </>
          )}
        </table>
        {mode === 'SET' && visibleCount < tape.length && (
          <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 10, color: t.textDim, fontFamily: 'JetBrains Mono, monospace' }}>
            Showing {fmtNum(visibleCount)} of {fmtNum(tape.length)} · scroll for more
          </div>
        )}
      </div>
    </section>
  );
}
