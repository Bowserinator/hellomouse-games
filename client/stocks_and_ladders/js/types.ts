export type Behavior = 'steady' | 'volatile' | 'wave' | 'swan' | 'trend';
export type Phase = 'planning' | 'settling' | 'finished';

export interface LobbySettings {
    rounds: number;
    timerSeconds: number;
}

export interface SeatInfo {
    username: string;
    ready: boolean;
    color: string;
    connected: boolean;
}

export interface PlayerView {
    color: string;
    submitted: boolean;
}

export interface FinalView {
    allocations: Array<Array<Array<number>>>;
    behaviors: Array<Behavior>;
    placements: Array<number>;
}

export interface View {
    phase: Phase;
    round: number;
    rounds: number;
    completedRounds: number;
    tickers: Array<string>;
    prices: Array<Array<number>>;
    worth: Array<Array<number>>;
    players: Array<PlayerView>;
    allocation: Array<number>;
    submitted: boolean;
    final?: FinalView;
}

export interface Sync {
    type: 'SYNC';
    started: boolean;
    youAre: number;
    isHost: boolean;
    settings: LobbySettings;
    seats: Array<SeatInfo>;
    remainingMilliseconds: number;
    elapsedMilliseconds: number;
    view?: View;
}

export interface Move {
    action: string;
    rounds?: number;
    timerSeconds?: number;
    color?: string;
    allocation?: Array<number>;
}
