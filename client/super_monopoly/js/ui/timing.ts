import type { GameEvent } from '../engine/state.js';

export const SPIN_MS = 5000;
export const MOVE_MS = 120;
export const ROLL_MS = 1200;
export const ROLL_HOLD_MS = 600;

export function eventDuration(event: GameEvent): number {
    switch (event.kind) {
        case 'roll': return ROLL_MS + ROLL_HOLD_MS;
        case 'move': return Math.max(0, (event.path?.length ?? 0) - 1) * MOVE_MS;
        case 'draw': return 1900;
        case 'deed': case 'destroy': return 500;
        case 'deadHand': return 1400;
        case 'build': case 'turn': return 300;
        case 'scan': return 800;
        case 'ledger': return 400;
        case 'hell': return 800;
        case 'release': case 'swap': return 600;
        case 'bankrupt': return 1000;
        case 'spin': return SPIN_MS;
        default: return 0;
    }
}
