/**
 * Landing copy, English (the source language: its shape is the `Dict` type every other
 * language must match). `{name}` placeholders are filled with `fill()`.
 */
import { authEn } from './authEn';

export const en = {
  meta: {
    title: 'Screenerix — Real-time crypto screener & trading terminal',
    description: 'Market map, order book densities, 80+ filters and instant alerts across Binance, Bybit, OKX, Bitget, Gate and Coinbase — in one fast terminal for scalpers and day traders.',
  },
  promo: {
    text: 'Try 3 days free — no credit card required',
    cta: 'Claim trial',
    label: 'Announcement',
    close: 'Dismiss announcement',
  },
  preloader: {
    label: 'Loading Screenerix',
    steps: ['Connecting to market streams…', 'Syncing order books…', 'Initializing terminal…'],
  },
  nav: {
    features: 'Features',
    how: 'How it works',
    pricing: 'Pricing',
    faq: 'FAQ',
    contact: 'Contact',
    signIn: 'Sign in',
    register: 'Register',
    openTerminal: 'Open terminal',
    language: 'Language',
    home: 'Screenerix home',
  },
  hero: {
    badge: '6 exchanges · spot & futures · live',
    title: 'Capture crypto market moves in real time',
    subtitle: 'Market map, order book densities, volume spikes and funding — streamed from every major exchange into one fast, focused terminal.',
    launch: 'Launch Terminal',
    trial: 'Start 3-day free trial',
    note: 'No credit card required',
    openPreview: 'Open the live terminal',
    spike: 'Volume spike',
  },
  exchanges: {
    label: 'Live data from',
  },
  features: {
    kicker: 'Features',
    title: 'Our key features',
    subtitle: 'The tools a scalper or day trader keeps open all session, in one terminal.',
    items: [
      { title: 'Market Map', body: 'A dynamic map of every market on every exchange: price movement, volume, volatility, volume and trade spikes, funding and more.' },
      { title: 'Market Review', body: 'Scan thousands of coins at once with custom watchlists, color rules and live charts.' },
      { title: 'Densities', body: 'Large order book walls tracked live, with size and distance to price — for bounce and breakout setups.' },
      { title: 'Filters and Alerts', body: '80+ filter options and instant alerts in the browser or Telegram the moment a condition hits.' },
      { title: 'Watchlists for TradingView', body: 'Filter the market and export the result as a TradingView watchlist in one click.' },
      { title: 'Automatic proxy, low ping', body: 'Connections from the terminal to each exchange are tuned automatically for the lowest latency.' },
    ],
  },
  preview: {
    kicker: 'Live preview',
    title: 'See it before you sign up',
    subtitle: 'A simulated feed of the real modules. Switch tabs to look around.',
    tabs: { map: 'Market Map', densities: 'Densities', review: 'Market Review' },
    captions: {
      map: 'Every coin as a live card — sorted by movement, volume or spikes.',
      densities: 'Bid and ask walls highlighted by size, with distance to price.',
      review: 'One sortable table for thousands of coins, refreshed every tick.',
    },
    cols: { symbol: 'Symbol', price: 'Price', change: '5m', volume: 'Volume', spike: 'Spike', size: 'Size', distance: 'Distance' },
    wall: 'Wall',
  },
  how: {
    kicker: 'How it works',
    title: 'From sign-up to your first setup in minutes',
    steps: [
      { title: 'Pick exchanges and markets', body: 'Choose venues and spot or futures. The terminal connects straight to each exchange stream.' },
      { title: 'Filter the market', body: 'Start from presets or build your own from 80+ filters: volume, volatility, spikes, funding, densities.' },
      { title: 'Watch it move', body: 'The market map, review list and densities update every tick, so you see the move as it starts.' },
      { title: 'Get alerted, act on the chart', body: 'Alerts reach the browser or Telegram. Open the chart, draw, measure and decide.' },
    ],
  },
  pricing: {
    kicker: 'Pricing',
    title: 'Simple pricing. Everything included.',
    subtitle: 'One plan with every feature. Try it free for 3 days first.',
    monthly: 'Monthly',
    yearly: 'Yearly',
    save: 'Save {pct}%',
    everything: 'Everything included',
    popular: 'Best value',
    trialName: 'Free Trial',
    trialPeriod: 'for 3 days',
    trialBlurb: 'Full access to the whole terminal. No credit card required.',
    trialCta: 'Start free trial',
    proName: 'Pro',
    perMonth: '/ month',
    billedYearly: 'billed {total} yearly',
    billedMonthly: 'paid monthly, no auto-renewal',
    proBlurb: 'The complete terminal for active traders.',
    proCta: 'Get Pro',
    features: [
      'Market Map, Market Review and Densities',
      'Binance, Bybit, OKX, Bitget, Gate, Coinbase',
      'Spot and perpetual futures',
      '80+ filters and color rules',
      'Browser and Telegram alerts',
      'TradingView watchlist export',
      'Saved layouts and watchlists',
    ],
  },
  faq: {
    kicker: 'FAQ',
    title: 'Questions traders ask',
    items: [
      { q: 'How fast is the data?', a: 'The terminal connects to each exchange’s live WebSocket streams, so prices, trades and order books update as the exchange sends them — usually within a fraction of a second. There is no delayed-data tier.' },
      { q: 'Which exchanges and markets are supported?', a: 'Binance, Bybit, OKX, Bitget, Gate and Coinbase — spot and perpetual futures wherever the exchange offers them.' },
      { q: 'What is included in the free trial?', a: 'Everything, for 3 days. No credit card is needed, and nothing is charged when the trial ends — you decide whether to continue on Pro.' },
      { q: 'How do I pay, and is there a subscription to cancel?', a: 'Pro costs $8 per month or $80 per year, paid in USDT on Tron, BNB Chain, Solana, Polygon, Ethereum or Arbitrum. Each payment is one-time and never renews by itself; paying again extends your current period. See the Refund Policy for details.' },
      { q: 'How do Telegram alerts work?', a: 'Create an alert on a chart or a filter, choose browser and/or Telegram delivery, and connect the Screenerix bot once in Settings. The alert fires the moment the condition is met.' },
      { q: 'Do I need to connect my exchange account?', a: 'No. Screenerix works on public market data only. It never asks for exchange keys and never touches your funds.' },
      { q: 'What do I need to run it?', a: 'A modern desktop browser — Chrome, Edge, Firefox or Safari. The terminal is built for large screens; the site and alerts also work on mobile.' },
    ],
  },
  contact: {
    kicker: 'Contact',
    title: 'Talk to the team',
    subtitle: 'Questions about the terminal, billing or a payment? Write to us directly — every message is read by a person.',
    telegram: { label: 'Telegram', note: 'The quickest way to reach us.', badge: 'Fastest response' },
    email: { label: 'Email', note: 'For detailed requests, billing and refunds.' },
  },
  cta: {
    title: 'The market moves in seconds. So should you.',
    button: 'Start free trial',
  },
  footer: {
    product: 'Product',
    legal: 'Legal',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    refunds: 'Refund Policy',
    cookies: 'Cookie Policy',
    disclaimer: 'Screenerix provides market data and analytics tools, not financial advice. Trading crypto assets carries a high risk of loss.',
  },
  auth: authEn,
};

export type Dict = typeof en;
