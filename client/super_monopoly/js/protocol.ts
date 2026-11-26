import type { GameEvent, View } from './engine/state.js';
import type { Profile, Settings } from './types.js';

export interface Seat extends Profile {
    username: string;
    ready: boolean;
    connected: boolean;
    bot?: boolean;
}

export interface Sync {
    type: 'SYNC';
    started: boolean;
    youAre: number;
    isHost: boolean;
    seats: Array<Seat>;
    settings: Settings;
    view: View | null;
    events: Array<GameEvent>;
    resumeToken?: string;
    generation: number;
}
