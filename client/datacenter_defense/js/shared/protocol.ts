import type { Handshake, TickBundle } from '../sim/lockstep.js';

export const PLAYER_COLORS = ['#4285F4', '#34A853', '#00ACC1', '#8AB4F8',
    '#81C995', '#5C6BC0', '#129EAF', '#5EEAD4'] as const;
export const PAUSE_COOLDOWN_MS = 30000;
export const LOBBY_LIMIT = 8;
export const RECONNECT_MS = 30000;
export const BUILD_TIMES = [[null, 'Map default'], [0, '0m'], [30, '30s'], [60, '60s'],
    [90, '90s'], [300, '5m'], [600, '10m']] as const;
export type BuildTime = typeof BUILD_TIMES[number][0];
export const INPUT_TIMEOUT_MS = 2000;
export const MARKER_LENGTH = 32;
export const MARKER_LIMIT = 128;
export const PING_KINDS = ['note', 'warning', 'attack'] as const;
export type PingKind = typeof PING_KINDS[number];
export type AnnotationPoint = { x: number; z: number };
export type AnnotationAction =
    | ({ op: 'ping'; kind: PingKind } & AnnotationPoint)
    | ({ op: 'add'; text: string } & AnnotationPoint)
    | ({ op: 'move'; id: number } & AnnotationPoint)
    | { op: 'remove'; id: number };
export type MapAnnotation = Extract<AnnotationAction, { op: 'add' }> & { id: number; author: string; color: number } |
(Extract<AnnotationAction, { op: 'ping' }> & { author: string }) |
Exclude<AnnotationAction, { op: 'add' | 'ping' }>;
export interface Battlefield {
    id: string; name: string; file: string; preview?: string; winTime: number; playable: boolean; mapHash: number;
}
export interface ConnectionStats {
    slot: number; ping?: number; tick?: number; tps?: number; reconnectMs?: number; departed?: boolean;
}
export interface LobbyPlayer {
    slot: number; name: string; color: number; ready: boolean;
}
export interface LobbyState extends Record<string, unknown> {
    type: 'LOBBY'; players: Array<LobbyPlayer>; host: number; map: string; buildTime: BuildTime; phase: 'LOBBY' | 'LOADING' | 'PLAYING';
}
export interface MatchStart extends Record<string, unknown> {
    type: 'START'; map: string; buildTime: BuildTime; seed: number; slots: Array<number>; players: Array<LobbyPlayer>; handshake: Handshake;
}
export interface BundleMessage {
    type: 'BUNDLE'; bundle: TickBundle;
}
