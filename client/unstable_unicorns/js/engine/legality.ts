import type { Binding, GameState, Prompt } from './state.js';
import type { CardDef } from './dsl/ast.js';
import type { NodeMap } from './dsl/compile.js';
import { holds } from './dsl/cond.js';
import { EventLog } from './events.js';
import type { Iid } from './ids.js';
import { seedFrom } from './rng.js';
import { blocksPlay } from './query/modifiers.js';
import { condCtx } from './query/active.js';
import type { World } from './query/modifiers.js';
import { ImpossibleError, type CustomHandler, type ExecCtx } from './exec/context.js';
import { respond, run, startEffect } from './exec/interpreter.js';
import { stateFromView, viewDefOf } from './view.js';
import { WILDCARD } from '../vars.js';

const SIM_BUDGET = 512;
const MAX_ANSWERS = 12;

export interface LegalityDeps {
    catalog: Record<string, CardDef>;
    nodes: NodeMap;
    custom?: Record<string, CustomHandler>;
}

function combinations(pool: Array<Iid>, max: number): Array<Array<Iid>> {
    const out: Array<Array<Iid>> = [];
    const walk = (start: number, picked: Array<Iid>) => {
        if (out.length >= MAX_ANSWERS) return;
        out.push([...picked]);
        if (picked.length >= max) return;
        for (let i = start; i < pool.length; i++) walk(i + 1, [...picked, pool[i]]);
    };
    walk(0, []);
    return out;
}

function answersFor(prompt: Prompt): Array<Binding> {
    switch (prompt.kind) {
        case 'cards':
            return combinations(prompt.cards, Math.max(prompt.min, prompt.max))
                .filter(picked => picked.length >= prompt.min && picked.length <= prompt.max);
        case 'player':
            return prompt.players.map(player => player);
        case 'yesno':
            return [true, false];
        case 'order':
            return [prompt.cards];
        case 'option':
            return Array.from({ length: Math.max(1, prompt.max) }, (_unused, index) => index);
        default:
            return [];
    }
}

function simCtx(state: GameState, deps: LegalityDeps, defOf: ExecCtx['defOf']): ExecCtx {
    return {
        state,
        nodes: deps.nodes,
        log: new EventLog(),
        rng: seedFrom('legality'),
        defOf,
        prompts: { n: 0 },
        custom: deps.custom ?? {},
        sim: true,
        queue: pending => {
            state.links.next.push(pending);
        }
    };
}

function branch(ex: ExecCtx): ExecCtx {
    return { ...ex, state: structuredClone(ex.state), log: new EventLog(), prompts: { n: ex.prompts.n } };
}

function explore(ex: ExecCtx, budget: { left: number }): boolean | 'unknown' {
    for (;;) {
        if (budget.left <= 0) return 'unknown';
        const prompt = ex.state.prompt;
        if (!prompt) {
            try {
                if (run(ex) === 'done') return true;
            } catch (error) {
                if (error instanceof ImpossibleError) return false;
                throw error;
            }
            continue;
        }

        budget.left--;
        const answers = answersFor(prompt);
        if (answers.length === 0) return false;
        for (const answer of answers) {
            const next = branch(ex);
            try {
                const result = respond(next, answer);
                if ('error' in result) continue;
                const outcome = explore(next, budget);
                if (outcome !== false) return outcome;
            } catch (error) {
                if (!(error instanceof ImpossibleError)) throw error;
            }
        }
        return false;
    }
}

export function whyBlocked(
    deps: LegalityDeps,
    view: GameState,
    seat: number,
    iid: Iid,
    actionsLeft: number
): string | null {
    const state = stateFromView(view);
    const card = state.cards[iid];
    if (!card || card.owner !== seat || card.zone !== 'hand') return 'That card is not in your hand';
    if (state.phase !== 'ACTION' || state.turn.player !== seat) return 'You cannot play a card now';
    if (actionsLeft <= 0) return 'You already used your action this turn';

    const defOf = viewDefOf(deps.catalog, state);
    const def = defOf(iid);
    if (!def || def.id === WILDCARD) return 'That card cannot be played right now';
    if (def.instant) return 'That card can only be played in response';

    const world: World = { state, defOf };
    if (blocksPlay(world, seat, def.kind)) return 'A card in a stable blocks that kind of card';
    if (!holds(def.playIf, condCtx(world, seat, iid))) return 'That card\u2019s play condition is not met';
    if (!def.onPlay?.id) return null;

    const ex = simCtx(state, deps, defOf);
    try {
        if (startEffect(ex, def.onPlay.id, seat, iid) === 'done') return null;
    } catch (error) {
        if (error instanceof ImpossibleError) return 'That card has no legal target right now';
        throw error;
    }
    return explore(ex, { left: SIM_BUDGET }) === false ? 'That card has no legal target right now' : null;
}

export function canPlay(deps: LegalityDeps, view: GameState, seat: number, iid: Iid, actionsLeft: number): boolean {
    return whyBlocked(deps, view, seat, iid, actionsLeft) === null;
}

function effectFingerprint(state: GameState, ignore: Iid): string {
    const cards: Array<string> = [];
    for (const [iid, card] of Object.entries(state.cards)) {
        if (iid === ignore) continue;
        const seen = [...card.revealedTo].sort().join(',');
        cards.push(`${iid}|${card.zone}|${card.owner}|${seen}`);
    }
    cards.sort();
    const lingering = state.lingering
        .map(entry => `${entry.source}|${entry.player}|${entry.effect}`)
        .sort();
    return JSON.stringify([
        cards, lingering, state.turn.extraTurns, state.turn.endNow,
        state.winner, state.pendingWinner
    ]);
}

function exploreEffectless(ex: ExecCtx, budget: { left: number }, before: string, ignore: Iid): boolean {
    for (;;) {
        if (budget.left <= 0) return false;
        const prompt = ex.state.prompt;
        if (!prompt) {
            try {
                if (run(ex) === 'done') return effectFingerprint(ex.state, ignore) === before;
            } catch (error) {
                if (error instanceof ImpossibleError) return false;
                throw error;
            }
            continue;
        }

        budget.left--;
        const answers = answersFor(prompt);
        if (answers.length === 0) return false;
        let completing = 0;
        for (const answer of answers) {
            const next = branch(ex);
            const result = respond(next, answer);
            if ('error' in result) continue;
            completing++;
            if (!exploreEffectless(next, budget, before, ignore)) return false;
        }
        return completing > 0;
    }
}

export function effectlessPlay(
    deps: LegalityDeps,
    view: GameState,
    seat: number,
    iid: Iid,
    actionsLeft: number
): boolean {
    if (whyBlocked(deps, view, seat, iid, actionsLeft) !== null) return false;
    const state = stateFromView(view);
    const defOf = viewDefOf(deps.catalog, state);
    const def = defOf(iid);
    if (!def || def.id === WILDCARD) return false;
    if (!def.onPlay?.id) return false;

    const before = effectFingerprint(state, iid);
    const ex = simCtx(state, deps, defOf);
    try {
        if (startEffect(ex, def.onPlay.id, seat, iid) === 'done')
            return effectFingerprint(state, iid) === before;
    } catch (error) {
        if (error instanceof ImpossibleError) return false;
        throw error;
    }
    return exploreEffectless(ex, { left: SIM_BUDGET }, before, iid);
}

export function playable(deps: LegalityDeps, view: GameState, seat: number, actionsLeft: number): Array<Iid> {
    const hand = view.players[seat]?.hand ?? [];
    return hand.filter(iid => canPlay(deps, view, seat, iid, actionsLeft));
}

