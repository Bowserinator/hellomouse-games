import type { CountSpec, Filter, OwnerRef, Selector } from '../dsl/ast.js';
import { isOwnerRef, matches } from '../dsl/filter.js';
import type { Frame, Zone } from '../state.js';
import type { Iid } from '../ids.js';
import { nextInt, shuffle } from '../rng.js';
import { filterCtx, ownerOf } from '../query/active.js';
import type { ExecCtx } from './context.js';
import { controllerOf, readCount } from './context.js';
import { ask } from './prompt.js';

export function candidatesOf(ex: ExecCtx, sel: Selector, controller: number): Array<Iid> {
    const ctx = filterCtx({ state: ex.state, defOf: ex.defOf }, controller);
    const out: Array<Iid> = [];
    if (sel.zone === 'any') {
        for (const iid of Object.keys(ex.state.cards)) {
            if (!isOwnerRef(sel.owner, ownerOf({ state: ex.state, defOf: ex.defOf }, iid), ctx)) continue;
            if (matches(sel.filter, iid, ctx)) out.push(iid);
        }
        return out;
    }

    const zone: Zone = sel.zone;
    if (zone === 'hand' || zone === 'stable') {
        for (const p of ex.state.players) {
            if (!isOwnerRef(sel.owner, p.id, ctx)) continue;
            for (const iid of zone === 'hand' ? p.hand : p.stable)
                if (matches(sel.filter, iid, ctx)) out.push(iid);
        }
        return out;
    }

    for (const iid of ex.state[zone]) if (matches(sel.filter, iid, ctx)) out.push(iid);
    return out;
}

export interface TargetRange {
    min: number;
    max: number;
}

export function targetRange(count: CountSpec, frame: Frame): TargetRange {
    if (typeof count === 'number') return { min: count, max: count };
    if ('var' in count) {
        const n = readCount(count, frame);
        return { min: n, max: n };
    }
    return { min: count.min, max: count.max };
}

export function revealToAll(ex: ExecCtx, cards: Array<Iid>) {
    const all = ex.state.players.map(p => p.id);
    for (const iid of cards) {
        const card = ex.state.cards[iid];
        if (card) card.revealedTo = [...all];
    }
}

function chooserFor(ex: ExecCtx, sel: Selector, candidates: Array<Iid>, controller: number): number {
    if (sel.chooser !== 'zoneOwner') return controller;
    const owners = new Set(candidates.map(iid => ownerOf({ state: ex.state, defOf: ex.defOf }, iid)));
    return owners.size === 1 ? [...owners][0] : controller;
}

function reasonFor(sel: Selector, key: string): string {
    return sel.as ? `choose:${sel.as}` : `choose:${key}`;
}

export function resolveSelection(
    ex: ExecCtx,
    frame: Frame,
    key: string,
    sel: Selector,
    fallbackSource: Iid | null
): Array<Iid> | 'wait' {
    const slot = sel.as ?? key;
    const stored = frame.bindings[slot];
    if (Array.isArray(stored)) return stored as Array<Iid>;

    const controller = controllerOf(ex, frame);
    const candidates = candidatesOf(ex, sel, controller);
    const range = targetRange(sel.count, frame);
    const wanted = Math.min(range.max, candidates.length);

    let chosen: Array<Iid>;
    if (sel.mode === 'random') {
        chosen = shuffle(ex.rng, [...candidates]).slice(0, wanted);
        revealToAll(ex, chosen);
    } else if (candidates.length <= range.max)
        chosen = candidates;
    else {
        const chooser = chooserFor(ex, sel, candidates, controller);
        return ask(ex, frame, slot, {
            player: chooser,
            kind: 'cards',
            reason: reasonFor(sel, key),
            source: fallbackSource,
            cards: candidates,
            min: Math.min(range.min, range.max),
            max: range.max
        });
    }

    frame.bindings[slot] = chosen;
    if (sel.reveal) revealToAll(ex, chosen);
    return chosen;
}

export function canSatisfy(ex: ExecCtx, sel: Selector, controller: number, frame: Frame): boolean {
    const candidates = candidatesOf(ex, sel, controller);
    return candidates.length >= targetRange(sel.count, frame).min;
}

export function isFilterAllowed(ex: ExecCtx, filter: Filter | undefined, iid: Iid, controller: number): boolean {
    return matches(filter, iid, filterCtx({ state: ex.state, defOf: ex.defOf }, controller));
}

export function ownerRefOf(sel: Selector): OwnerRef {
    return sel.owner;
}

export { nextInt };
