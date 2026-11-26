import type { Command } from '../types.js';
import type { View } from './state.js';

export function fallback(view: View): Command {
    switch (view.phase.kind) {
        case 'roll': case 'extra': return { action: 'ROLL' };
        case 'draw': return { action: 'DRAW' };
        case 'purchase': return { action: 'DECLINE' };
        case 'arson': return { action: 'DECLINE' };
        case 'end': return { action: 'END' };
        default: return { action: 'TIMEOUT' };
    }
}
