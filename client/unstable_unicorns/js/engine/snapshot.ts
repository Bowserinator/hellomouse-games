import type { GameState } from './state.js';

export function snapshot(state: GameState): GameState {
    return structuredClone(state);
}

export function restoreInto(target: GameState, snap: GameState) {
    const copy: GameState = structuredClone(snap);
    for (const key of Object.keys(target)) Reflect.deleteProperty(target, key);
    Object.assign(target, copy);
}
