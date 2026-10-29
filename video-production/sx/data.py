"""Deterministic market data for the film — seeds from src/lib/market/constants.ts, PRNG from src/lib/format.ts."""
import math
from functools import lru_cache

from .core import Rng

# [symbol, seed price, 24h volume $M]; the first 16 are the repo's SEED list.
COINS = [
    ('BTC', 67420.5, 28400), ('ETH', 3512.4, 14200), ('SOL', 172.38, 3900), ('BNB', 584.2, 1650),
    ('XRP', 0.5231, 1420), ('DOGE', 0.14122, 980), ('TON', 6.912, 410), ('AVAX', 36.82, 520),
    ('LINK', 15.432, 610), ('SUI', 1.8634, 720), ('ARB', 1.1124, 380), ('WIF', 2.8412, 690),
    ('PEPE', 0.000012134, 840), ('OP', 2.312, 290), ('NEAR', 6.124, 330), ('APT', 9.042, 260),
    ('INJ', 24.18, 210), ('TIA', 6.42, 240), ('SEI', 0.4123, 180), ('JUP', 0.9821, 160),
    ('ONDO', 1.0544, 230), ('FET', 1.432, 270), ('ENA', 0.6217, 310), ('WLD', 2.214, 205), ('RNDR', 7.512, 190),
]
PRICE = {s: p for s, p, _ in COINS}
VOL = {s: v for s, _, v in COINS}

EXCHANGES = ['binance', 'bybit', 'okx', 'bitget', 'gate', 'coinbase']
EX_NAME = {'binance': 'Binance', 'bybit': 'Bybit', 'okx': 'OKX', 'bitget': 'Bitget', 'gate': 'Gate', 'coinbase': 'Coinbase'}


def seed_of(s):
    h = 7
    for ch in s:
        h = (h * 31 + ord(ch)) % 2147483000
    return h


@lru_cache(maxsize=None)
def candles(sym, n=44, vol=0.0028, drift=0.0, seed=0):
    """Random-walk candles ending at the coin's seed price (o, h, l, c, v)."""
    r = Rng(seed_of(sym) + seed)
    out = []
    close = PRICE.get(sym, 100.0)
    for _ in range(n):
        o = close / (1 + (r() - 0.5 + drift) * vol * 2)
        h = max(o, close) * (1 + r() * vol * 0.7)
        lo = min(o, close) * (1 - r() * vol * 0.7)
        out.append((o, h, lo, close, 0.25 + r() ** 1.6))
        close = o
    return tuple(reversed(out))


def live(sym, f, amp=0.0011):
    """Deterministic live tick multiplier for the forming candle."""
    k = seed_of(sym) % 997
    return 1 + amp * (0.6 * math.sin(f * 0.071 + k) + 0.3 * math.sin(f * 0.193 + k * 1.7) + 0.1 * math.sin(f * 0.517 + k * 0.3))


def stat(sym, key):
    """Stable per-coin header readings."""
    r = Rng(seed_of(sym) + seed_of(key) % 1000)
    r()
    if key == 'range5m':
        return 0.004 + r() * 0.03
    if key == 'fund':
        return (r() - 0.35) * 0.0002
    if key == 'chg':
        return (r() - 0.42) * 0.12
    return r()


# ── Densities: SOL on Binance futures (hero card) ──
SOL_LAST = 172.38
SOL_ROWS = [  # price, side, notional, lifetime seconds
    (173.90, 'ask', 612_000, 760),
    (173.25, 'ask', 340_000, 65),
    (172.80, 'ask', 455_000, 38),
    (171.66, 'bid', 2_400_000, 252),   # the wall: size2 tier, 4m 12s
    (171.20, 'bid', 520_000, 451),
    (170.45, 'bid', 1_100_000, 1388),
]
HERO_ROW = 3

DENSITY_NEIGHBOURS = {  # symbol: [(price, side, notional, life)]
    'BTC': [(67_612.0, 'ask', 8_400_000, 1840), (67_380.0, 'bid', 3_100_000, 420), (67_150.0, 'bid', 5_600_000, 2950)],
    'ETH': [(3_540.0, 'ask', 2_900_000, 610), (3_498.5, 'bid', 1_400_000, 95), (3_470.0, 'bid', 760_000, 1210)],
    'WIF': [(2.9100, 'ask', 540_000, 300), (2.8020, 'bid', 830_000, 145)],
    'XRP': [(0.5300, 'ask', 1_200_000, 2400), (0.5180, 'bid', 690_000, 380)],
    'DOGE': [(0.14400, 'ask', 950_000, 1500), (0.13950, 'bid', 2_200_000, 3300)],
    'BNB': [(590.0, 'ask', 1_300_000, 880), (579.4, 'bid', 610_000, 75)],
    'AVAX': [(37.40, 'ask', 520_000, 205), (36.10, 'bid', 780_000, 990)],
    'LINK': [(15.700, 'ask', 505_000, 430), (15.180, 'bid', 2_050_000, 2210)],
    'SUI': [(1.9100, 'ask', 640_000, 160), (1.8200, 'bid', 515_000, 540)],
    'TON': [(7.0500, 'ask', 880_000, 1730), (6.8400, 'bid', 560_000, 260)],
    'PEPE': [(1.240e-05, 'ask', 1_700_000, 920), (1.190e-05, 'bid', 600_000, 140)],
    'OP': [(2.3600, 'ask', 530_000, 610)],
}


# ── WIF on Bybit, 1m: quiet tape, then the spike candle ──
@lru_cache(maxsize=None)
def wif_candles():
    base = list(candles('WIF', 46, 0.0016, 0.0, 3))
    vols = [0.28 + 0.22 * (math.sin(i * 1.3) * 0.5 + 0.5) for i in range(len(base))]
    return [(o, h, l, c, vols[i]) for i, (o, h, l, c, _) in enumerate(base)]


WIF_AVG_VOL = 0.39
WIF_SPIKE_X = 4.8


# ── ETH Level Breakout 1h · LONG on Binance (Strategies) ──
ETH_LEVEL = 3528.00
ETH_ENTRY, ETH_SL, ETH_TP1, ETH_TP2 = 3528.40, 3497.20, 3575.20, 3622.00


@lru_cache(maxsize=None)
def eth_candles():
    """15m candles: three touches of 3,528 resistance, a pullback, then three rising candles (the last one is live)."""
    r = Rng(4242)
    closes = []
    p = 3488.0
    path = [3488, 3496, 3505, 3514, 3522, 3526.5, 3519, 3508, 3500, 3507, 3516, 3524, 3527.2, 3520, 3511,
            3503, 3498, 3506, 3514, 3521, 3526.8, 3518, 3509, 3501, 3497, 3503, 3509, 3514]
    out = []
    for target in path:
        o = p
        c = target + (r() - 0.5) * 2.5
        h = max(o, c) + 1.5 + r() * 4
        lo = min(o, c) - 1.5 - r() * 4
        h = min(h, 3527.6)  # the level holds
        out.append((o, h, lo, c, 0.35 + r() * 0.5))
        p = c
    return out


# The three rising candles that later become the logo bars: (open, close) targets, the last one live.
ETH_RISE = [(3514.0, 3519.6), (3519.2, 3524.8), (3524.6, 3531.4)]
