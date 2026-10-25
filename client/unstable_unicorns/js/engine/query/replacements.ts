import type { CardEvent, Effect, Replacement } from '../dsl/ast.js';
import { holds } from '../dsl/cond.js';
import { matches } from '../dsl/filter.js';
import type { Iid } from '../ids.js';
import type { Zone } from '../state.js';
import { condCtx, filterCtx, ownerOf } from './active.js';
import type { World } from './modifiers.js';

export type ReplacementPlan =
    | { kind: 'redirect'; zone: Zone }
    | { kind: 'effect'; player: number; source: Iid; effect: Effect };

function isLeaveZone(text: string): boolean {
    return text === 'destroy' || text === 'discard' || text === 'sacrifice' || text === 'return';
}

export function defaultRedirect(world: World, iid: Iid, event: CardEvent): Zone | null {
    const def = world.defOf(iid);
    if (!def || def.kind !== 'baby' || !event.type) return null;
    return isLeaveZone(event.type) ? 'nursery' : null;
}

function replacementsOf(world: World, iid: Iid): Array<Replacement> {
    const def = world.defOf(iid);
    return def && def.replacements ? def.replacements : [];
}

function ownerOrder(state: World['state'], first: number): Array<number> {
    const order: Array<number> = [];
    const count = state.players.length;
    for (let i = 0; i < count; i++) order.push((first + i + count) % count);
    return order;
}

export function findReplacements(world: World, iid: Iid, event: CardEvent): Array<ReplacementPlan> {
    const plans: Array<ReplacementPlan> = [];
    const redirect = defaultRedirect(world, iid, event);
    if (redirect) plans.push({ kind: 'redirect', zone: redirect });

    const affected = ownerOf(world, iid);
    for (const owner of ownerOrder(world.state, affected < 0 ? 0 : affected)) {
        const ctx = filterCtx(world, owner);
        for (const source of world.state.players[owner].stable)
            for (const rep of replacementsOf(world, source)) {
                if (rep.when !== event.type) continue;
                if (!matches(rep.filter, iid, ctx)) continue;
                if (rep.unless && holds(rep.unless, condCtx(world, owner, source, event))) continue;
                plans.push({ kind: 'effect', player: owner, source, effect: rep.effect });
            }
    }

    return plans;
}
