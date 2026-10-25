import { canDraw, nextStep } from '../next-step.js';
import type { ViewModel } from '../engine/view.js';

export type Hint = 'highlight' | 'animate' | null;

export interface Hints {
    deck: Hint;
    deckAvailable: boolean;
    endTurn: Hint;
    drawCue: boolean;
    noActions: boolean;
    banner: string | null;
}

export function hints(view: ViewModel): Hints {
    const step = nextStep(view);
    const ownAction = view.phase === 'ACTION' && view.turn.player === view.seat &&
        !view.promptOpen && !view.over && view.winner === null;
    const noActions = ownAction && view.turn.actionsLeft <= 0;
    const drawActionAvailable = ownAction && view.pendingWinner === null &&
        view.turn.actionsLeft > 0 && canDraw(view);
    const deckAvailable = !view.promptOpen && !view.over && view.winner === null && (
        (view.phase === 'AWAIT_BEGIN' && view.turn.player === view.seat) ||
        drawActionAvailable
    );
    const canEndTurn = ownAction;
    const endTurn = canEndTurn
        ? (noActions || drawActionAvailable ? 'animate' : view.playable.length > 0 ? 'highlight' : 'animate')
        : null;
    const banner = noActions ? 'ALL ACTIONS USED UP' : null;

    return {
        deck: step === 'begin-turn' || step === 'draw' ? 'animate' : drawActionAvailable ? 'highlight' : null,
        deckAvailable,
        endTurn,
        drawCue: deckAvailable,
        noActions,
        banner
    };
}

export function applyHint(node: HTMLElement | null, hint: Hint): void {
    if (!node) return;
    if (hint === null) delete node.dataset.hint;
    else node.dataset.hint = hint;
}
