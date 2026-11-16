/** Price generation for the five stocks, each with a distinct hidden behaviour. */
import { Rng } from '../../shared/ts/seeded-random.js';
import { BEHAVIORS, BEHAVIOR_PARAMS, DYNAMIC_PARAMS, GAME_CONFIG, TICKER_POOL } from './config.js';
import type { Behavior, StockMode } from './types.js';

interface Dynamics {
    next(): number;
}

export interface Stock {
    ticker: string;
    behavior: Behavior | null;
    dynamics: Dynamics | null;
    noise: Rng;
    prices: Array<number>;
}

export interface Market {
    mode: StockMode;
    stocks: Array<Stock>;
}

const FULL_TURN = Math.PI * 2;

function shuffled<T>(rng: Rng, items: Array<T>): Array<T> {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
        const other = rng.int(0, index);
        [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
}

function logReturn(rng: Rng, drift: number, sigma: number): number {
    return drift + sigma * rng.gauss();
}

function steady(rng: Rng): Dynamics {
    const { drift, sigma } = BEHAVIOR_PARAMS.steady;
    let price = GAME_CONFIG.startingPrice;
    return { next: () => price *= Math.exp(logReturn(rng, drift, sigma)) };
}

function volatile(rng: Rng): Dynamics {
    const { sigma } = BEHAVIOR_PARAMS.volatile;
    let price = GAME_CONFIG.startingPrice;
    return { next: () => price *= Math.exp(logReturn(rng, -sigma * sigma / 2, sigma)) };
}

function wave(rng: Rng): Dynamics {
    const params = BEHAVIOR_PARAMS.wave;
    const roundTicks = GAME_CONFIG.ticksPerRound;
    const drawPeriod = () => rng.range(params.minPeriodRounds, params.maxPeriodRounds) * roundTicks;
    const drawAmplitude = () => rng.range(params.minAmplitude, params.maxAmplitude);
    let phase = rng.range(0, FULL_TURN);
    let period = drawPeriod();
    let amplitude = drawAmplitude();
    const anchor = GAME_CONFIG.startingPrice / Math.exp(amplitude * Math.sin(phase));
    return {
        next: () => {
            phase += FULL_TURN / period;
            if (phase >= FULL_TURN) {
                phase -= FULL_TURN;
                period = drawPeriod();
                amplitude = drawAmplitude();
            }
            return anchor * Math.exp(amplitude * Math.sin(phase) + params.jitter * rng.gauss());
        }
    };
}

function swan(rng: Rng): Dynamics {
    const params = BEHAVIOR_PARAMS.swan;
    let price = GAME_CONFIG.startingPrice;
    return {
        next: () => {
            price *= Math.exp(logReturn(rng, params.drift, params.sigma));
            if (rng.float() < params.chancePerTick)
                price *= rng.float() < params.crashShare
                    ? 1 - rng.range(params.minCrash, params.maxCrash)
                    : 1 + rng.range(params.minRise, params.maxRise);
            return price;
        }
    };
}

function trend(rng: Rng, totalTicks: number): Dynamics {
    const params = BEHAVIOR_PARAMS.trend;
    const peak = Math.round(totalTicks * rng.range(params.minPeakFraction, params.maxPeakFraction));
    const rise = rng.range(params.minRise, params.maxRise);
    const fall = rng.range(params.minFall, params.maxFall);
    let tick = 0;
    return {
        next: () => {
            tick++;
            const level = tick <= peak
                ? 1 + rise * tick / peak
                : 1 + rise - (rise + fall) * (tick - peak) / (totalTicks - peak);
            return GAME_CONFIG.startingPrice * level * Math.exp(params.jitter * rng.gauss());
        }
    };
}

function createDynamics(behavior: Behavior, rng: Rng, totalTicks: number): Dynamics {
    switch (behavior) {
        case 'steady': return steady(rng);
        case 'volatile': return volatile(rng);
        case 'wave': return wave(rng);
        case 'swan': return swan(rng);
        case 'trend': return trend(rng, totalTicks);
    }
}

export function createMarket(rng: Rng, rounds: number, mode: StockMode): Market {
    const tickers = shuffled(rng, TICKER_POOL).slice(0, GAME_CONFIG.stockCount);
    const totalTicks = rounds * GAME_CONFIG.ticksPerRound;
    return {
        mode,
        stocks: shuffled(rng, BEHAVIORS).map((behavior, index) => ({
            ticker: tickers[index],
            behavior: mode === 'fixed' ? behavior : null,
            dynamics: mode === 'fixed' ? createDynamics(behavior, rng.fork(index + 1), totalTicks) : null,
            noise: rng.fork(index + 1),
            prices: [GAME_CONFIG.startingPrice]
        }))
    };
}

/** Daily returns that favour stocks holding more than the average share of the money, summing to zero overall. */
export function popularityReturns(investments: Array<number>): Array<number> {
    const total = investments.reduce((sum, amount) => sum + amount, 0);
    if (total <= 0) return investments.map(() => 0);
    const shares = investments.map(amount => amount / total);
    const average = shares.reduce((sum, share) => sum + share * share, 0);
    return shares.map(share => DYNAMIC_PARAMS.volatility * (share - average));
}

/** A random walk from the open that is pinned to land exactly on the close. */
function closingBridge(rng: Rng, open: number, close: number): Array<number> {
    const ticks = GAME_CONFIG.ticksPerRound;
    const walk: Array<number> = [];
    let position = 0;
    for (let tick = 0; tick < ticks; tick++) {
        position += DYNAMIC_PARAMS.sigma * rng.gauss();
        walk.push(position);
    }
    const path = walk.map((value, index) => {
        const progress = (index + 1) / ticks;
        return (open + (close - open) * progress) * Math.exp(value - progress * position);
    });
    path[ticks - 1] = close;
    return path;
}

export function advanceRound(market: Market, closeReturns: Array<number> = []): void {
    market.stocks.forEach((stock, index) => {
        const { dynamics } = stock;
        const open = stock.prices[stock.prices.length - 1];
        const path = dynamics
            ? Array.from({ length: GAME_CONFIG.ticksPerRound }, () => dynamics.next())
            : closingBridge(stock.noise, open, open * (1 + closeReturns[index]));
        for (const price of path) stock.prices.push(Math.max(GAME_CONFIG.minimumPrice, price));
    });
}
