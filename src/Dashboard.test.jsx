// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import Dashboard from './Dashboard.jsx';

// recharts' ResponsiveContainer measures 0x0 in jsdom and renders nothing;
// mock the whole module with passthroughs so the integration test exercises
// OUR components and Dashboard's prop wiring, not recharts' SVG layout.
vi.mock('recharts', () => {
  const Passthrough = ({ children }) => children ?? null;
  const names = [
    'AreaChart', 'Area', 'ComposedChart', 'Bar', 'Line', 'XAxis', 'YAxis',
    'CartesianGrid', 'Tooltip', 'ResponsiveContainer', 'ReferenceLine',
  ];
  return Object.fromEntries(names.map(n => [n, Passthrough]));
});

// Faithful trimmed slice of the real public/data shapes. OP-13 is Dashboard's
// default selectedSet, so it must carry a full quote for the chart panel.
const market = {
  updatedAt: '2026-07-17T12:00:00Z',
  source: 'tcgplayer',
  fetched: 20,
  kept: 2,
  quotes: {
    'OP-13': {
      price: 180, prev: 170, change30d: 6.5, high52w: 200, low52w: 150,
      volume30d: 40, soldLast7d: 5, listings: 12, bid: 175, ask: 185,
      spread: 5.4, rsi: 62, momentum: 'bullish', signal: 'BUY', stale: false,
    },
    'OP-01': {
      price: 250, prev: 240, change30d: -1.2, high52w: 300, low52w: 200,
      volume30d: 10, soldLast7d: 2, listings: 4, bid: 245, ask: 255,
      spread: 4.0, rsi: 48, momentum: 'neutral', signal: 'STRONG BUY', stale: false,
    },
  },
};
const history = {
  'OP-13': [
    { date: '2026-06-01T00:00Z', price: 170, source: 'tcgplayer current market', volume: 1 },
    { date: '2026-07-01T00:00Z', price: 180, source: 'tcgplayer current market', volume: 1 },
  ],
  'OP-01': [
    { date: '2026-06-01T00:00Z', price: 240, source: 'tcgplayer current market', volume: 1 },
    { date: '2026-07-01T00:00Z', price: 250, source: 'tcgplayer current market', volume: 1 },
  ],
};
const txns = [
  { id: 'a', set: 'OP-13', type: 'SOLD', price: 180, qty: 1, timestamp: '2026-07-17T11:50:00Z', venue: 'TCGPlayer' },
  { id: 'b', set: 'OP-01', type: 'SOLD', price: 250, qty: 1, timestamp: '2026-07-17T11:55:00Z', venue: 'TCGPlayer' },
];

afterEach(cleanup);

describe('Dashboard integration', () => {
  it('loads fixtures and renders the full component tree', async () => {
    global.fetch = vi.fn((url) => {
      const body = url.includes('market.json') ? market
        : url.includes('history.json') ? history : txns;
      return Promise.resolve({ json: () => Promise.resolve(body) });
    });

    render(<Dashboard />);

    // Renders past LoadingScreen into the loaded tree — proves every
    // component's imports and Dashboard's prop wiring resolve.
    expect(await screen.findByText('MARKET PULSE')).toBeTruthy();
    expect(screen.getByText('DECISION MATRIX')).toBeTruthy();
    expect(screen.getByText(/ORDER BOOK/)).toBeTruthy();
    expect(screen.getByText('LIVE TAPE')).toBeTruthy();
    expect(screen.getByText('GRAND LINE INDEX')).toBeTruthy();
    // OP-13 (default selection) shows up across ticker/movers/table/matrix.
    expect(screen.getAllByText('OP-13').length).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalledTimes(3);   // market + history + txns
  });

  it('renders the error screen when the data fetch fails', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network fail')));
    render(<Dashboard />);
    expect(await screen.findByText('DATA UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText(/network fail/)).toBeTruthy();
  });

  it('selecting a set from the live tape moves the chart selection (ey9.7 binding)', async () => {
    global.fetch = vi.fn((url) => {
      const body = url.includes('market.json') ? market
        : url.includes('history.json') ? history : txns;
      return Promise.resolve({ json: () => Promise.resolve(body) });
    });

    render(<Dashboard />);
    await screen.findByText('MARKET PULSE');

    // Default selection (OP-13) is what the tape's per-set toggle shows —
    // selectedSet lives only in Dashboard.jsx and is threaded to both panels.
    expect(screen.getByRole('button', { name: 'OP-13' })).toBeTruthy();

    // Click the OP-01 row in the tape's ALL SETS feed — this is the tape's
    // one write path (setSelectedSet), not an independent set filter.
    const tapeScroll = screen.getByTestId('tape-scroll');
    fireEvent.click(within(tapeScroll).getByText('OP-01'));

    // Both panels now read OP-01: the tape auto-switches into SET mode for
    // it (its toggle button relabels), proving the chart's selectedSet moved
    // too since both read the exact same Dashboard-owned state.
    expect(screen.getByRole('button', { name: 'OP-01' })).toBeTruthy();
    expect(screen.getByText('No recorded fills for OP-01')).toBeTruthy();
  });
});
