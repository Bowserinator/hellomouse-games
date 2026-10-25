import type { Iid } from '../ids.js';
import type { Frame, Prompt, PromptKind } from '../state.js';
import type { ExecCtx } from './context.js';

export interface PromptSpec {
    player: number;
    kind: PromptKind;
    reason: string;
    source: Iid | null;
    cards?: Array<Iid>;
    players?: Array<number>;
    min?: number;
    max?: number;
}

export const AWAIT_KEY = 'awaitKey';

export function ask(ex: ExecCtx, frame: Frame, key: string, spec: PromptSpec): 'wait' {
    const prompt: Prompt = {
        id: ++ex.prompts.n,
        player: spec.player,
        kind: spec.kind,
        reason: spec.reason,
        source: spec.source,
        cards: spec.cards ? [...spec.cards] : [],
        players: spec.players ? [...spec.players] : [],
        min: spec.min ?? 0,
        max: spec.max ?? 0
    };
    frame.bindings[AWAIT_KEY] = key;
    ex.state.prompt = prompt;
    return 'wait';
}

export function applyAnswer(state: { prompt: Prompt | null; exec: Array<Frame> }, answer: import('../state.js').Binding) {
    const prompt = state.prompt;
    const frame = state.exec[state.exec.length - 1];
    if (!prompt || !frame) throw new Error('No prompt is open');
    const key = frame.bindings[AWAIT_KEY];
    if (typeof key !== 'string') throw new Error('Prompt has no waiting binding');
    frame.bindings[key] = answer;
    delete frame.bindings[AWAIT_KEY];
    state.prompt = null;
    return prompt;
}

export function rejectAnswer(state: { prompt: Prompt | null }, answer: import('../state.js').Binding): string | null {
    const prompt = state.prompt;
    if (!prompt) return 'No prompt is open';
    switch (prompt.kind) {
        case 'cards': {
            if (!Array.isArray(answer)) return 'Expected a list of cards';
            const cards = answer as Array<Iid>;
            const allowed = new Set(prompt.cards);
            if (cards.some(iid => typeof iid !== 'string' || !allowed.has(iid))) return 'Card is not a legal choice';
            if (new Set(cards).size !== cards.length) return 'Duplicate card';
            if (cards.length < prompt.min || cards.length > prompt.max) return 'Wrong number of cards';
            return null;
        }
        case 'player': {
            if (!Array.isArray(answer)) return 'Expected a list of players';
            const players = answer as Array<number>;
            const allowed = new Set(prompt.players);
            if (players.some(id => typeof id !== 'number' || !allowed.has(id))) return 'Player is not a legal choice';
            if (new Set(players).size !== players.length) return 'Duplicate player';
            if (players.length < prompt.min || players.length > prompt.max) return 'Wrong number of players';
            return null;
        }
        case 'yesno':
            return typeof answer === 'boolean' ? null : 'Expected yes or no';
        case 'option':
            return typeof answer === 'number' && Number.isInteger(answer) && answer >= prompt.min && answer <= prompt.max
                ? null
                : 'Option out of range';
        case 'order': {
            if (!Array.isArray(answer)) return 'Expected an order';
            const cards = answer as Array<Iid>;
            const allowed = new Set(prompt.cards);
            if (cards.some(iid => typeof iid !== 'string' || !allowed.has(iid))) return 'Card is not a legal choice';
            if (new Set(cards).size !== cards.length) return 'Duplicate card';
            if (prompt.cards.length > 0 && cards.length !== prompt.cards.length) return 'Wrong number of cards';
            return null;
        }
        default:
            return 'Unknown prompt kind';
    }
}
