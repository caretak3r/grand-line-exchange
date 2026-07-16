import React from 'react';
import { Anchor, AlertCircle } from 'lucide-react';
import { t } from './theme.js';

export function LoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', background: t.bgPrimary, color: t.text, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', gap: 16 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      <Anchor size={48} style={{ color: t.accent }} className="spin" />
      <div style={{ fontFamily: 'Cinzel, serif', fontSize: 18, color: t.accent, letterSpacing: 3 }}>LOADING MARKET DATA</div>
      <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 1 }}>FETCHING /data/market.json…</div>
    </div>
  );
}

export function ErrorScreen({ error, onRetry }) {
  return (
    <div style={{ minHeight: '100vh', background: t.bgPrimary, color: t.text, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', gap: 16, padding: 24, textAlign: 'center' }}>
      <AlertCircle size={48} style={{ color: t.sell }} />
      <div style={{ fontFamily: 'Cinzel, serif', fontSize: 18, color: t.sell, letterSpacing: 3 }}>DATA UNAVAILABLE</div>
      <div style={{ fontSize: 12, color: t.textDim, maxWidth: 480 }}>
        Could not load market.json. {error}<br/>
        Run <code style={{ color: t.accent }}>python scripts/update-prices.py</code> or check the Actions tab.
      </div>
      <button onClick={onRetry} style={{ padding: '8px 16px', background: t.accent, color: t.bgPrimary, border: 'none', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>
        RETRY
      </button>
    </div>
  );
}
