import type { CardEvent, CountSpec, EventType, Filter, OwnerRef, Primitive, Selector } from '../dsl/ast.js';
import type { Frame, Zone } from '../state.js';
import type { Iid } from '../ids.js';
import { matches } from '../dsl/filter.js';
import { bulkMove, moveCard } from '../move.js';
import type { Destination } from '../move.js';
import { shuffle } from '../rng.js';
import { filterCtx } from '../query/active.js';
import { unicornCount } from '../query/modifiers.js';
import { findReplacements } from '../query/replacements.js';
import type { ExecCtx } from './context.js';
import { ImpossibleError, controllerOf, moveCtxOf, sourceOf, worldOf } from './context.js';
import { ask } from './prompt.js';
import { canSatisfy, resolveSelection, revealToAll, targetRange } from './selectors.js';

export type PrimResult = 'done' | 'wait';

function requiredSelectors(prim: Primitive): Array<Selector> {
    return Object.values(prim).filter(value =>
        !!value && typeof value === 'object' && 'zone' in value && 'count' in value) as Array<Selector>;
}

function requireCandidates(ex: ExecCtx, frame: Frame, prim: Primitive, controller: number) {
    for (const sel of requiredSelectors(prim))
        if (!canSatisfy(ex, sel, controller, frame)) throw new ImpossibleError();
}

function ensureDeck(ex: ExecCtx) {
    if (ex.state.deck.length > 0 || ex.state.discard.length === 0) return;
    bulkMove(ex.state, shuffle(ex.rng, [...ex.state.discard]), 'deck');
}

function ownerFor(ex: ExecCtx, frame: Frame, ref: OwnerRef): number {
    const controller = controllerOf(ex, frame);
    if (ref === 'active') return ex.state.turn.player;
    return controller;
}

function replacementOrder(
    ex: ExecCtx,
    frame: Frame,
    iids: Array<Iid>,
    cause: EventType
): Array<Iid> | 'wait' {
    const key = `${frame.node}:repl`;
    const bound = frame.bindings[key];
    if (Array.isArray(bound)) {
        const order: Array<Iid> = [];
        for (const item of bound) if (typeof item === 'string') order.push(item);
        return order;
    }

    const world = worldOf(ex);
    const sources: Array<Iid> = [];
    let affected = -1;
    for (const iid of iids) {
        const card = ex.state.cards[iid];
        if (!card) continue;
        if (affected === -1) affected = card.owner;
        const event: CardEvent = { type: cause, card: iid, player: card.owner };
        for (const plan of findReplacements(world, iid, event))
            if (plan.kind === 'effect' && !sources.includes(plan.source)) sources.push(plan.source);
    }
    if (ex.sim || sources.length < 2) return [];

    ask(ex, frame, key, {
        player: affected === -1 ? controllerOf(ex, frame) : affected,
        kind: 'order',
        reason: 'Order the replacement effects',
        source: sourceOf(frame),
        cards: sources,
        min: sources.length,
        max: sources.length
    });
    return 'wait';
}

function takeFrom(
    ex: ExecCtx,
    frame: Frame,
    controller: number,
    spec: { filter?: Filter; count: CountSpec; as?: string },
    from: 'deck' | 'discard',
    shuffleAfter: boolean
): PrimResult {
    const key = `${frame.node}:found`;
    let found = frame.bindings[key];
    if (!Array.isArray(found)) {
        const range = targetRange(spec.count, frame);
        const ctx = filterCtx(worldOf(ex), controller);
        const candidates = ex.state[from].filter(iid => matches(spec.filter, iid, ctx));
        if (candidates.length === 0) return 'done';
        revealTo(ex, candidates, controller);
        const wanted = Math.min(range.max, candidates.length);
        const answer = ask(ex, frame, key, {
            player: controller,
            kind: 'cards',
            reason: spec.as ? `search:${spec.as}` : 'search',
            source: sourceOf(frame),
            cards: candidates,
            min: Math.min(range.min, wanted),
            max: wanted
        });
        if (answer === 'wait') return 'wait';
        found = frame.bindings[key];
    }
    const cards = found as Array<Iid>;
    const ctx = moveCtxOf(ex);
    for (const iid of cards) moveCard(ctx, iid, { zone: 'hand', owner: controller }, 'play');
    if (shuffleAfter) shuffleZone(ex, from, controller);
    const name = spec.as;
    if (name) frame.bindings[name] = cards;
    return 'done';
}

function moveSelected(
    ex: ExecCtx,
    frame: Frame,
    index: number,
    sel: Selector,
    dest: Destination | ((iid: string) => Destination),
    cause: Parameters<typeof moveCard>[3]
): PrimResult {
    const chosen = resolveSelection(ex, frame, `${frame.node}:${index}`, sel, sourceOf(frame));
    if (chosen === 'wait') return 'wait';
    const order = replacementOrder(ex, frame, chosen, cause);
    if (order === 'wait') return 'wait';
    const ctx = { ...moveCtxOf(ex), order };
    for (const iid of chosen) {
        if (!ex.state.cards[iid]) continue;
        const target = typeof dest === 'function' ? dest(iid) : dest;
        moveCard(ctx, iid, target, cause);
    }
    return 'done';
}

export function drawCards(ex: ExecCtx, who: number, count: number) {
    const ctx = moveCtxOf(ex);
    for (let i = 0; i < count; i++) {
        ensureDeck(ex);
        const iid = ex.state.deck[0];
        if (!iid) {
            if (!ex.sim) ex.deckOut?.();
            return;
        }
        moveCard(ctx, iid, { zone: 'hand', owner: who }, 'draw');
    }
}

function shuffleZone(ex: ExecCtx, zone: Zone, owner: number) {
    if (zone === 'hand' || zone === 'stable') {
        const p = ex.state.players[owner];
        if (p) shuffle(ex.rng, zone === 'hand' ? p.hand : p.stable);
        return;
    }
    const list = ex.state[zone];
    const cards = shuffle(ex.rng, [...list]);
    ex.state[zone] = cards;
}

function choosePlayers(ex: ExecCtx, frame: Frame, key: string, reason: string, count: number): Array<number> | 'wait' {
    const stored = frame.bindings[key];
    if (Array.isArray(stored)) return stored as Array<number>;
    const controller = controllerOf(ex, frame);
    return ask(ex, frame, key, {
        player: controller,
        kind: 'player',
        reason,
        source: sourceOf(frame),
        players: ex.state.players.map(p => p.id).filter(id => id !== controller),
        min: count,
        max: count
    });
}

function revealTo(ex: ExecCtx, iids: Array<Iid>, seat: number) {
    for (const iid of iids) {
        const card = ex.state.cards[iid];
        if (card && !card.revealedTo.includes(seat)) card.revealedTo.push(seat);
    }
}

function lookAndSteal(ex: ExecCtx, frame: Frame, prim: { from: 'deck' | 'discard'; count: number }): PrimResult {
    const controller = controllerOf(ex, frame);
    const lookKey = `${frame.node}:look`;
    const pickKey = `${frame.node}:pick`;
    let looked = frame.bindings[lookKey] as Array<Iid> | undefined;

    if (!Array.isArray(looked)) {
        const from = ex.state[prim.from];
        if (from.length === 0) return 'done';
        looked = from.slice(0, prim.count);
        bulkMove(ex.state, looked, 'limbo');
        revealToAll(ex, looked);
        frame.bindings[lookKey] = looked;
    }

    if (!Array.isArray(frame.bindings[pickKey])) {
        revealTo(ex, looked, controller);
        ask(ex, frame, pickKey, {
            player: controller,
            kind: 'cards',
            reason: 'Look at the top cards and steal one',
            source: sourceOf(frame),
            cards: looked,
            min: 1,
            max: 1
        });
        return 'wait';
    }

    const taken = (frame.bindings[pickKey] as Array<Iid>)[0];
    const rest = looked.filter(iid => iid !== taken);
    if (taken) moveCard(moveCtxOf(ex), taken, { zone: 'hand', owner: controller }, 'play');
    if (rest.length > 0) bulkMove(ex.state, rest, prim.from);
    shuffleZone(ex, prim.from, controller);
    return 'done';
}

export function runPrimitive(ex: ExecCtx, frame: Frame, prim: Primitive): PrimResult {
    const controller = controllerOf(ex, frame);
    if (ex.sim) requireCandidates(ex, frame, prim, controller);
    switch (prim.p) {
        case 'draw': {
            const who = prim.who === 'active' ? ex.state.turn.player : controller;
            const range = targetRange(prim.count, frame);
            drawCards(ex, who, Math.max(0, range.min));
            return 'done';
        }
        case 'discard':
            return moveSelected(ex, frame, 0, prim.sel, 'discard', 'discard');
        case 'destroy':
            return moveSelected(ex, frame, 0, prim.sel, 'discard', 'destroy');
        case 'sacrifice':
            return moveSelected(ex, frame, 0, prim.sel, 'discard', 'sacrifice');
        case 'returnToHand':
            return moveSelected(ex, frame, 0, prim.sel, iid => ({ zone: 'hand', owner: ex.state.cards[iid].owner }), 'return');
        case 'moveCard':
            return moveSelected(ex, frame, 0, prim.sel, { zone: prim.zone, owner: ownerFor(ex, frame, prim.owner) }, 'play');
        case 'moveStable':
            return moveSelected(ex, frame, 0, prim.sel, { zone: 'stable', owner: ownerFor(ex, frame, prim.owner) }, 'play');
        case 'stealRandom':
            return moveSelected(ex, frame, 0, { ...prim.sel, mode: 'random' },
                { zone: prim.sel.zone === 'hand' ? 'hand' : 'stable', owner: controller }, 'play');
        case 'lookAndSteal':
            return lookAndSteal(ex, frame, prim);
        case 'swapHands': {
            const key = `${frame.node}:who`;
            let targets = frame.bindings[key];
            if (!Array.isArray(targets)) {
                const wanted = choosePlayers(ex, frame, key, 'swapHands', 1);
                if (wanted === 'wait') return 'wait';
                targets = frame.bindings[key];
            }
            const other = (targets as Array<number>)[0];
            if (other === undefined || other === controller) return 'done';
            const a = ex.state.players[controller];
            const b = ex.state.players[other];
            const tmp = a.hand;
            a.hand = b.hand;
            b.hand = tmp;
            for (const iid of a.hand) ex.state.cards[iid].owner = controller;
            for (const iid of b.hand) ex.state.cards[iid].owner = other;
            return 'done';
        }
        case 'tradeUnicorns': {
            const mine = resolveSelection(ex, frame, `${frame.node}:mine`, prim.mine, sourceOf(frame));
            if (mine === 'wait') return 'wait';
            const theirs = resolveSelection(ex, frame, `${frame.node}:theirs`, prim.theirs, sourceOf(frame));
            if (theirs === 'wait') return 'wait';
            const a = mine[0];
            const b = theirs[0];
            if (!a || !b) return 'done';
            const ctx = moveCtxOf(ex);
            const ownerA = ex.state.cards[a].owner;
            const ownerB = ex.state.cards[b].owner;
            moveCard(ctx, b, { zone: 'stable', owner: ownerA }, 'play');
            moveCard(ctx, a, { zone: 'stable', owner: ownerB }, 'play');
            return 'done';
        }
        case 'search':
            return takeFrom(ex, frame, controller, prim, prim.from, true);
        case 'fetchFromDiscard':
            return takeFrom(ex, frame, controller, prim, 'discard', false);
        case 'shuffleInto': {
            const chosen = resolveSelection(ex, frame, `${frame.node}:0`, prim.sel, sourceOf(frame));
            if (chosen === 'wait') return 'wait';
            const ctx = moveCtxOf(ex);
            const owner = ownerFor(ex, frame, prim.owner);
            for (const iid of chosen) moveCard(ctx, iid, { zone: prim.zone, owner }, 'play');
            shuffleZone(ex, prim.zone, owner);
            return 'done';
        }
        case 'replaceUnicornsWithBabies': {
            const sel = prim.sel ?? { zone: 'stable' as Zone, owner: 'self' as OwnerRef, count: 999, filter: { f: 'unicorn' as const } };
            const chosen = resolveSelection(ex, frame, `${frame.node}:0`, sel, sourceOf(frame));
            if (chosen === 'wait') return 'wait';
            const ctx = moveCtxOf(ex);
            for (const iid of chosen) {
                const owner = ex.state.cards[iid].owner;
                moveCard(ctx, iid, 'nursery', 'return');
                const index = ex.state.nursery.findIndex(card => ex.defOf(card)?.kind === 'baby');
                if (index < 0) continue;
                const baby = ex.state.nursery[index];
                moveCard(ctx, baby, { zone: 'stable', owner }, 'play');
            }
            return 'done';
        }
        case 'takeExtraTurn':
            ex.state.turn.extraTurns += 1;
            return 'done';
        case 'endTurnNow':
            ex.state.turn.endNow = true;
            return 'done';
        case 'addLingering':
            ex.state.lingering.push({
                id: ex.state.lingering.length + 1,
                source: sourceOf(frame) ?? '',
                player: controller,
                effect: prim.effect.id ?? '',
                until: prim.until
            });
            return 'done';
        case 'custom': {
            const handler = ex.custom[prim.name];
            if (handler) handler(ex, frame);
            return 'done';
        }
        default:
            return 'done';
    }
}

export { unicornCount, worldOf };
