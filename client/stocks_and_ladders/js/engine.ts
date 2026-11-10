/** Match rules: allocations, round settlement and the per-player view. */
import { Rng } from '../../shared/ts/seeded-random.js';
import { GAME_CONFIG } from './config.js';
import { advanceRound, createMarket } from './market.js';
import type { Market } from './market.js';
import type { LobbySettings, Phase, View } from './types.js';

export interface PlayerState {
    color: string;
    allocation: Array<number>;
    submitted: boolean;
    worth: Array<number>;
    history: Array<Array<number>>;
}

export interface MatchState {
    settings: LobbySettings;
    market: Market;
    players: Array<PlayerState>;
    phase: Phase;
    completedRounds: number;
}

const ROUND_CLOSED = 'The round is not open';

export function evenAllocation(): Array<number> {
    const share = GAME_CONFIG.percentTotal / GAME_CONFIG.stockCount;
    return Array.from({ length: GAME_CONFIG.stockCount }, () => share);
}

export function isValidAllocation(allocation: unknown): allocation is Array<number> {
    return Array.isArray(allocation) && allocation.length === GAME_CONFIG.stockCount &&
        allocation.every(share => Number.isInteger(share) && share >= 0) &&
        allocation.reduce((sum, share) => sum + share, 0) === GAME_CONFIG.percentTotal;
}

export function createMatch(settings: LobbySettings, seed: number, colors: Array<string>): MatchState {
    return {
        settings,
        market: createMarket(new Rng(seed), settings.rounds),
        players: colors.map(color => ({
            color,
            allocation: evenAllocation(),
            submitted: false,
            worth: [GAME_CONFIG.startingMoney],
            history: []
        })),
        phase: 'planning',
        completedRounds: 0
    };
}

export function setAllocation(state: MatchState, seat: number, allocation: unknown): string {
    const player = state.players[seat];
    if (state.phase !== 'planning') return ROUND_CLOSED;
    if (player.submitted) return 'Unready to change your split';
    if (!isValidAllocation(allocation)) return 'Your split must total 100%';
    player.allocation = allocation;
    return '';
}

export function submitAllocation(state: MatchState, seat: number, allocation: unknown): string {
    const player = state.players[seat];
    if (state.phase !== 'planning') return ROUND_CLOSED;
    if (!isValidAllocation(allocation)) return 'Your split must total 100%';
    player.allocation = allocation;
    player.submitted = true;
    return '';
}

export function retractSubmission(state: MatchState, seat: number): string {
    if (state.phase !== 'planning') return ROUND_CLOSED;
    state.players[seat].submitted = false;
    return '';
}

export function resolveRound(state: MatchState): void {
    advanceRound(state.market);
    const { stocks } = state.market;
    const start = state.completedRounds * GAME_CONFIG.ticksPerRound;
    for (const player of state.players) {
        const money = player.worth[start];
        for (let tick = 1; tick <= GAME_CONFIG.ticksPerRound; tick++)
            player.worth.push(stocks.reduce((sum, stock, index) =>
                sum + money * player.allocation[index] / GAME_CONFIG.percentTotal *
                    stock.prices[start + tick] / stock.prices[start], 0));
        player.history.push([...player.allocation]);
        player.submitted = false;
    }
    state.completedRounds++;
    state.phase = 'settling';
}

export function finishSettling(state: MatchState): void {
    state.phase = state.completedRounds >= state.settings.rounds ? 'finished' : 'planning';
}

export function rankPlayers(state: MatchState): Array<number> {
    const money = (seat: number): number => state.players[seat].worth[state.players[seat].worth.length - 1];
    return state.players.map((_, seat) => seat).sort((a, b) => money(b) - money(a) || a - b);
}

export function selectView(state: MatchState, seat: number): View {
    const { market, players, settings, phase, completedRounds } = state;
    return {
        phase,
        round: phase === 'planning' ? completedRounds + 1 : completedRounds,
        rounds: settings.rounds,
        completedRounds,
        tickers: market.stocks.map(stock => stock.ticker),
        prices: market.stocks.map(stock => stock.prices),
        worth: players.map(player => player.worth),
        players: players.map(player => ({ color: player.color, submitted: player.submitted })),
        allocation: players[seat].allocation,
        submitted: players[seat].submitted,
        ...phase === 'finished' ? {
            final: {
                allocations: players.map(player => player.history),
                behaviors: market.stocks.map(stock => stock.behavior),
                placements: rankPlayers(state)
            }
        } : {}
    };
}
