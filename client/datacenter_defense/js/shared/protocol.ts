import type { Handshake, TickBundle } from '../sim/lockstep.js';

export const PLAYER_COLORS = ['#4285F4', '#34A853', '#00ACC1', '#8AB4F8',
    '#81C995', '#5C6BC0', '#129EAF', '#5EEAD4'] as const;
export const PAUSE_COOLDOWN_MS = 30000;
export const LOBBY_LIMIT = 32;
export const INPUT_TIMEOUT_MS = 2000;
export interface Battlefield {
    id: string; name: string; file: string; preview?: string; winTime: number; playable: boolean; mapHash: number;
}
export interface LobbyPlayer {
    slot: number; name: string; color: number; ready: boolean;
}
export interface LobbyState extends Record<string, unknown> {
    type: 'LOBBY'; players: Array<LobbyPlayer>; host: number; map: string; phase: 'LOBBY' | 'LOADING' | 'PLAYING';
}
export interface MatchStart extends Record<string, unknown> {
    type: 'START'; map: string; seed: number; slots: Array<number>; players: Array<LobbyPlayer>; handshake: Handshake;
}
export interface BundleMessage {
    type: 'BUNDLE'; bundle: TickBundle;
}
