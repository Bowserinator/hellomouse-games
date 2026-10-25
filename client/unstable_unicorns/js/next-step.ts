import type { ViewModel } from './engine/view.js';

export type NextStep = 'begin-turn' | 'draw' | 'end-turn' | null;

export function canDraw(view: ViewModel): boolean {
    return view.deckCount > 0 || view.discard.length > 0;
}

export function nextStep(view: ViewModel): NextStep {
    if (view.over || view.winner !== null) return null;
    if (view.promptOpen) return null;
    if (view.turn.player !== view.seat) return null;
    if (view.phase === 'AWAIT_BEGIN') return 'begin-turn';
    if (view.phase !== 'ACTION') return null;
    if (view.pendingWinner !== null) return 'end-turn';
    if (view.playable.length === 0 && view.turn.actionsLeft > 0 && canDraw(view)) return 'draw';
    return 'end-turn';
}
