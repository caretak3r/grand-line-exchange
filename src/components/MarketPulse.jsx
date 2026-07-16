import React from 'react';
import { Activity, Star, Target, DollarSign, Package } from 'lucide-react';
import { t } from './theme.js';
import { fmtPct, fmtNum } from './format.js';
import { SectionHeader, StatCard } from './ui.jsx';

export default function MarketPulse({ totalCap, totalVol, avgChange, gainers, losers, buys, active, sets, watchlist }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeader title="MARKET PULSE" subtitle="30-day rolling aggregates across all sealed English booster boxes" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
        <StatCard label="Market Cap (30d Vol×Price)" value={`$${(totalCap / 1000).toFixed(1)}K`} sub={`${fmtNum(totalVol)} boxes traded`} Icon={DollarSign} color={t.accent} />
        <StatCard label="Avg 30d Change" value={fmtPct(avgChange)} sub={`${gainers} up · ${losers} down`} Icon={Activity} color={avgChange >= 0 ? t.buy : t.sell} />
        <StatCard label="Active Buy Signals" value={`${buys}/${active.length}`} sub="Strong + Standard" Icon={Target} color={t.buy} />
        <StatCard label="Tracked Sets" value={sets.length} sub={`${active.length} active`} Icon={Package} color={t.info} />
        <StatCard label="Watchlist" value={watchlist.length} sub="Tap ★ on any row" Icon={Star} color={t.warn} />
      </div>
    </section>
  );
}
