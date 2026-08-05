// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { LoadingScreen, ErrorScreen } from './StatusScreens.jsx';
import MoversPanel from './MoversPanel.jsx';
import DecisionMatrix from './DecisionMatrix.jsx';
import LiveTape from './LiveTape.jsx';
import MarketPulse from './MarketPulse.jsx';
import PriceChartSection from './PriceChartSection.jsx';
import { SignalBadge, Sparkline, FilterPills } from './ui.jsx';

// No globals in vitest here, so testing-library's auto-cleanup afterEach
// isn't registered — do it explicitly.
afterEach(cleanup);

const DummyIcon = () => <span data-testid="icon" />;

describe('StatusScreens', () => {
  it('LoadingScreen shows the loading copy', () => {
    render(<LoadingScreen />);
    expect(screen.getByText('LOADING MARKET DATA')).toBeTruthy();
  });
  it('ErrorScreen surfaces the message and RETRY fires onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorScreen error="boom" onRetry={onRetry} />);
    expect(screen.getByText(/boom/)).toBeTruthy();
    fireEvent.click(screen.getByText('RETRY'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('MoversPanel', () => {
  const sets = [
    { code: 'OP-13', short: 'Nika', price: 180, change30d: 6.5 },
    { code: 'OP-04', short: 'Kingdoms', price: 90, change30d: -2.1 },
  ];
  it('renders a row per set and reports the clicked code', () => {
    const onSelect = vi.fn();
    render(<MoversPanel title="TOP GAINERS" Icon={DummyIcon} color="#fff" sets={sets} onSelect={onSelect} />);
    expect(screen.getByText('TOP GAINERS')).toBeTruthy();
    expect(screen.getByText('OP-13')).toBeTruthy();
    expect(screen.getByText(/\+6\.50%/)).toBeTruthy();   // rendered as "▲ +6.50%"
    expect(screen.getByText(/-2\.10%/)).toBeTruthy();     // rendered as "▼ -2.10%"
    fireEvent.click(screen.getByText('OP-13'));
    expect(onSelect).toHaveBeenCalledWith('OP-13');
  });
});

describe('DecisionMatrix', () => {
  const active = [
    { code: 'OP-04', price: 90, change30d: -2.1, signal: 'WATCH' },
    { code: 'OP-13', price: 180, change30d: 6.5, signal: 'BUY' },
  ];
  it('sorts tiles by 30d change descending', () => {
    render(<DecisionMatrix active={active} selectedSet="OP-13" setSelectedSet={() => {}} />);
    const codes = screen.getAllByText(/^OP-\d+$/).map(el => el.textContent);
    expect(codes).toEqual(['OP-13', 'OP-04']);   // +6.5 before -2.1
  });
  it('clicking a tile selects that set', () => {
    const setSelectedSet = vi.fn();
    render(<DecisionMatrix active={active} selectedSet="OP-13" setSelectedSet={setSelectedSet} />);
    fireEvent.click(screen.getByText('OP-04'));
    expect(setSelectedSet).toHaveBeenCalledWith('OP-04');
  });
});

describe('LiveTape', () => {
  const txns = Array.from({ length: 35 }, (_, i) => ({
    id: `t${i}`, set: `OP-${i}`, type: 'SOLD', price: 100 + i, qty: 1,
    timestamp: '2026-07-17T12:00:00Z', venue: 'TCGPlayer',
  }));
  it('caps the tape at 30 rows', () => {
    render(<LiveTape txns={txns} />);
    // 30 data rows → 30 SOLD badges
    expect(screen.getAllByText('SOLD')).toHaveLength(30);
  });
  it('tolerates an empty/undefined feed', () => {
    render(<LiveTape txns={undefined} />);
    expect(screen.getByText('LIVE TAPE')).toBeTruthy();
  });
});

describe('MarketPulse', () => {
  it('renders the aggregate stat cards', () => {
    render(<MarketPulse totalCap={2100000} totalVol={1200} avgChange={3.1}
      gainers={8} losers={4} buys={5} active={[1, 2, 3]} sets={new Array(22)} watchlist={['OP-13']} />);
    expect(screen.getByText('$2100.0K')).toBeTruthy();     // 2_100_000/1000
    expect(screen.getByText('5/3')).toBeTruthy();           // buys/active.length
    expect(screen.getByText('8 up · 4 down')).toBeTruthy();
    expect(screen.getByText('22')).toBeTruthy();            // tracked sets
  });
});

describe('PriceChartSection', () => {
  const selected = {
    code: 'OP-13', tier: 'grail', signal: 'BUY', name: 'The Three Captains',
    released: '2025-01-01', msrp: 144, block: 'EXTRA', price: 180, change30d: 6.5, prev: 169,
    bid: 175, ask: 185, spread: 5.4, high52w: 200, low52w: 140, volume30d: 40, soldLast7d: 5,
    listings: 12, rsi: 55, momentum: 'bullish', notes: 'steady climb', tcgUrl: 'https://example.com',
  };
  const chartData = [
    { axis: 0, ts: Date.parse('2026-01-01T10:00:00Z'), price: 170, volume: 3, ma7: 170, ma30: 170, source: 'tcgplayer current market' },
    { axis: 1, ts: Date.parse('2026-01-08T10:00:00Z'), price: 180, volume: 5, ma7: 175, ma30: 175, source: 'tcgplayer current market' },
  ];
  const timeframeBuckets = [
    { label: '7D', days: 7, disabled: false },
    { label: '30D', days: 30, disabled: true },
    { label: '90D', days: 90, disabled: true },
    { label: '1Y', days: 365, disabled: true },
    { label: 'ALL', days: null, disabled: false },
  ];

  it('clicking an enabled bucket reports the chosen window; disabled buckets are greyed out but still rendered', () => {
    const setTimeframe = vi.fn();
    render(<PriceChartSection selected={selected} chartData={chartData}
      selectedFirst={chartData[0]} selectedLast={chartData[1]} selectedAllTimeChange={5.9}
      timeframe={null} setTimeframe={setTimeframe} timeframeBuckets={timeframeBuckets} />);
    fireEvent.click(screen.getByText('7D'));
    expect(setTimeframe).toHaveBeenCalledWith(7);
    const thirtyDay = screen.getByText('30D');
    expect(thirtyDay).toBeTruthy();
    expect(thirtyDay.disabled).toBe(true);
  });

  it('the header states the active window and its real observation bounds', () => {
    const { rerender } = render(<PriceChartSection selected={selected} chartData={chartData}
      selectedFirst={chartData[0]} selectedLast={chartData[1]} selectedAllTimeChange={5.9}
      timeframe={null} setTimeframe={() => {}} timeframeBuckets={timeframeBuckets} />);
    expect(screen.getByText(/ALL window/)).toBeTruthy();

    const windowed = [chartData[1]];
    rerender(<PriceChartSection selected={selected} chartData={windowed}
      selectedFirst={windowed[0]} selectedLast={windowed[0]} selectedAllTimeChange={5.9}
      timeframe={7} setTimeframe={() => {}} timeframeBuckets={timeframeBuckets} />);
    expect(screen.getByText(/7D window/)).toBeTruthy();
  });
});

describe('ui primitives', () => {
  it('SignalBadge prints the signal', () => {
    render(<SignalBadge signal="STRONG BUY" />);
    expect(screen.getByText('STRONG BUY')).toBeTruthy();
  });
  it('Sparkline degrades to em-dash with fewer than 2 positive prices', () => {
    const { container } = render(<Sparkline data={[{ price: 100 }]} color="#fff" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('—');
  });
  it('Sparkline draws a polyline with enough points', () => {
    const { container } = render(<Sparkline data={[{ price: 100 }, { price: 120 }, { price: 90 }]} color="#fff" />);
    expect(container.querySelector('polyline')).toBeTruthy();
  });
  it('FilterPills reports the chosen option', () => {
    const onChange = vi.fn();
    render(<FilterPills label="Tier" options={['all', 'grail']} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByText('GRAIL'));
    expect(onChange).toHaveBeenCalledWith('grail');
  });
});
