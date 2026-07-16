import React from 'react';
import { Anchor, RefreshCw } from 'lucide-react';
import { t } from './theme.js';
import { timeAgo } from './format.js';

export default function HeaderBar({ market, reload }) {
  return (
    <header className="sticky-top" style={{ borderBottom: `1px solid ${t.border}`, background: t.bgSecondary, padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backdropFilter: 'blur(8px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Anchor size={26} style={{ color: t.accent }} />
        <div>
          <div style={{ fontFamily: 'Cinzel, serif', fontSize: 18, fontWeight: 800, letterSpacing: 1.5, color: t.textBright }}>
            GRAND LINE <span style={{ color: t.accent }}>EXCHANGE</span>
          </div>
          <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 1.5, fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>
            One Piece TCG · Sealed Booster Box Trading Terminal
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="blink" style={{ width: 8, height: 8, borderRadius: '50%', background: t.buy, display: 'inline-block' }} />
          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: t.textDim, letterSpacing: 1 }}>
            UPDATED {timeAgo(market.updatedAt)} AGO
          </span>
        </div>
        <button onClick={reload} title="Reload data"
          style={{ background: 'none', border: `1px solid ${t.border}`, color: t.textDim, padding: '6px 8px', cursor: 'pointer' }}>
          <RefreshCw size={12} />
        </button>
        <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: t.textDim }}>
          SOURCE: {market.source?.toUpperCase() || 'TCGPLAYER'}
        </div>
      </div>
    </header>
  );
}
