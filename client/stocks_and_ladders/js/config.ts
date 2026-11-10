/** Tuning values, lobby presets and palettes. */
import type { Behavior } from './types.js';

export const GAME_CONFIG = {
    minimumPlayers: 1,
    maximumPlayers: 8,
    stockCount: 5,
    ticksPerRound: 24,
    hoursPerDivider: 4,
    visibleDays: 3,
    warningSeconds: 5,
    startingMoney: 10_000,
    startingPrice: 100,
    minimumPrice: 1,
    roundPresets: [5, 10, 15, 20, 30],
    defaultRounds: 10,
    timerPresets: [15, 30, 45, 60],
    defaultTimerSeconds: 30,
    animationMilliseconds: 4000,
    settleMilliseconds: 1500,
    percentTotal: 100
};

const VARIANCE_MULTIPLIER = 3;
const NOISE = Math.sqrt(VARIANCE_MULTIPLIER);

export const BEHAVIORS: Array<Behavior> = ['steady', 'volatile', 'wave', 'swan', 'trend'];

export const BEHAVIOR_LABELS: Record<Behavior, string> = {
    steady: 'Steady climber',
    volatile: 'Volatile',
    wave: 'Wave',
    swan: 'Black swan',
    trend: 'Rise and fall'
};

export const BEHAVIOR_PARAMS = {
    steady: { drift: 0.0004, sigma: 0.0015 * NOISE },
    volatile: { sigma: 0.03 * NOISE },
    wave: { minPeriodRounds: 3, maxPeriodRounds: 8, minAmplitude: 0.1, maxAmplitude: 0.25, jitter: 0.004 * NOISE },
    swan: {
        drift: 0.0001, sigma: 0.002 * NOISE, chancePerTick: 0.005, crashShare: 0.65,
        minCrash: 0.25, maxCrash: 0.45, minRise: 0.2, maxRise: 0.4
    },
    trend: {
        minPeakFraction: 0.35, maxPeakFraction: 0.65, minRise: 0.5, maxRise: 0.9,
        minFall: 0.3, maxFall: 0.5, jitter: 0.003 * NOISE
    }
};

export const STOCK_COLORS = ['#ff5c5c', '#4da3ff', '#3ddc84', '#ffb000', '#c77dff'];

export const PLAYER_COLORS = [
    '#ff6b6b', '#4da3ff', '#3ddc84', '#ffb000', '#c77dff', '#2ee6d6', '#ff7ac8', '#c9b28a'
];

export const TICKER_POOL = [
    'AXLO', 'BRNT', 'CYVN', 'DRLX', 'ELTR', 'FRNK', 'GLDN', 'HVRN', 'ICRO', 'JNVA',
    'KORV', 'LMNX', 'MBRO', 'NOVT', 'OPTR', 'PRXM', 'QUAD', 'RVLT', 'SYNX', 'TRVO',
    'UMBR', 'VELX', 'WYRD', 'XENO', 'YRDN', 'ZEPH', 'ALTR', 'BLZE', 'CRSP', 'DLTN',
    'EVRG', 'FJRD', 'GRNT', 'HLIX', 'INGO', 'KRYN', 'LUMI', 'MRDN', 'NXUS', 'ORBX',
    'PLSR', 'QNTM', 'RDGE', 'STRN', 'TLRX', 'VNTR', 'WXLR', 'ZNTH'
];
