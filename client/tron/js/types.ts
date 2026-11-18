export type Phase = 'lobby' | 'playing' | 'between';

export interface Settings {
    size: number;
    speed: number;
    rounds: number;
}

export interface SeatInfo {
    username: string;
    color: number;
    ready: boolean;
    connected: boolean;
    score: number;
}

export interface SyncMessage {
    type: 'SYNC';
    phase: Phase;
    youAre: number;
    settings: Settings;
    seats: Array<SeatInfo>;
}

export interface Spawn {
    x: number;
    y: number;
    dir: number;
}

export interface RoundMessage {
    type: 'ROUND';
    round: number;
    total: number;
    size: number;
    stepMs: number;
    startAt: number;
    spawns: Array<Spawn | null>;
}

export interface TurnMessage {
    type: 'TURN';
    seat: number;
    t: number;
    cell: number;
    dir: number;
}

export interface DeadMessage {
    type: 'DEAD';
    seat: number;
    t: number;
}

export interface RoundEndMessage {
    type: 'ROUND_END';
    winner: number;
}

export interface GameOverMessage {
    type: 'GAME_OVER';
    results: Array<{ username: string; color: number; score: number }>;
}

export interface Move {
    action: 'COLOR' | 'SETTINGS' | 'START' | 'TURN' | 'DEAD';
    color?: number;
    size?: number;
    speed?: number;
    rounds?: number;
    t?: number;
    cell?: number;
    dir?: number;
}
