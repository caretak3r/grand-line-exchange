import React from 'react';
import { AlertCircle } from 'lucide-react';
import { t } from './theme.js';

export default function PageFooter({ market, sets }) {
  return (
    <>
      <section style={{ padding: 16, background: t.bgSecondary, border: `1px solid ${t.border}`, fontSize: 11, color: t.textDim, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <AlertCircle size={14} style={{ color: t.warn, flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong style={{ color: t.warn }}>DATA NOTE:</strong> Prices auto-updated by GitHub Actions hourly from TCGPlayer. Last refresh: <strong style={{ color: t.text }}>{new Date(market.updatedAt).toLocaleString()}</strong>. Volume figures are 30-day estimates. Always verify the live TCGPlayer/eBay quote before placing a trade — sealed TCG product is illiquid and prices can move sharply on reprint announcements. Not financial advice.
          </div>
        </div>
      </section>

      <footer style={{ textAlign: 'center', padding: 24, color: t.textDim, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1.5 }}>
        GRAND LINE EXCHANGE · TRACKING {sets.length} BOOSTER BOXES · DATA: {market.fetched || 0} LIVE / {market.kept || 0} CACHED
      </footer>
    </>
  );
}
