/** Price generation for the five stocks, each with a distinct hidden behaviour. */
import { Rng } from '../../shared/ts/seeded-random.js';
import { BEHAVIORS, BEHAVIOR_PARAMS, GAME_CONFIG, TICKER_POOL } from './config.js';
import type { Behavior } from './types.js';

interface Dynamics {
    next(): number;
}

export interface Stock {
    ticker: string;
    behavior: Behavior;
    dynamics: Dynamics;
    prices: Array<number>;
}

export interface Market {
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

export function createMarket(rng: Rng, rounds: number): Market {
    const tickers = shuffled(rng, TICKER_POOL).slice(0, GAME_CONFIG.stockCount);
    const totalTicks = rounds * GAME_CONFIG.ticksPerRound;
    return {
        stocks: shuffled(rng, BEHAVIORS).map((behavior, index) => ({
            ticker: tickers[index],
            behavior,
            dynamics: createDynamics(behavior, rng.fork(index + 1), totalTicks),
            prices: [GAME_CONFIG.startingPrice]
        }))
    };
}

export function advanceRound(market: Market): void {
    for (const stock of market.stocks)
        for (let tick = 0; tick < GAME_CONFIG.ticksPerRound; tick++)
            stock.prices.push(Math.max(GAME_CONFIG.minimumPrice, stock.dynamics.next()));
}
