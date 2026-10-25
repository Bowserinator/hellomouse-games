import type { Effect, EventType } from './dsl/ast.js';
import type { EventLog } from './events.js';
import type { Iid } from './ids.js';
import type { CardInstance, GameState, Zone } from './state.js';
import { zoneList } from './zones.js';
import type { World } from './query/modifiers.js';
import { protectedFrom } from './query/modifiers.js';
import { findReplacements } from './query/replacements.js';
import type { ReplacementPlan } from './query/replacements.js';

export type Destination = Zone | { zone: Zone; owner?: number };

export interface MoveCtx extends World {
    log: EventLog;
    runReplacement(player: number, source: Iid, effect: Effect): void;
    order?: Array<Iid>;
}

export interface MoveOutcome {
    moved: boolean;
    from: Zone;
    to: Zone;
    replaced: boolean;
    shielded: boolean;
}

function destZone(dest: Destination): Zone {
    return typeof dest === 'string' ? dest : dest.zone;
}

function destOwner(card: CardInstance, dest: Destination): number {
    if (typeof dest === 'string' || dest.owner === undefined) return card.owner;
    return dest.owner;
}

function isShielded(ctx: MoveCtx, iid: Iid, cause: EventType, to: Zone): boolean {
    if (to === 'stable') return false;
    if (cause !== 'destroy' && cause !== 'sacrifice') return false;
    return protectedFrom(ctx, iid, cause);
}

function orderedPlans(plans: Array<ReplacementPlan>, order: Array<Iid> | undefined): Array<ReplacementPlan> {
    if (!order || order.length < 2) return plans;
    const rank = (plan: ReplacementPlan) => {
        if (plan.kind !== 'effect') return -1;
        const index = order.indexOf(plan.source);
        return index === -1 ? order.length : index;
    };
    return [...plans].sort((a, b) => rank(a) - rank(b));
}

export function bulkMove(state: GameState, iids: Array<Iid>, to: Zone, owner?: number): void {
    for (const iid of iids) {
        const card = state.cards[iid];
        if (!card) continue;
        const source = zoneList(state, card.zone, card.owner);
        const index = source.indexOf(iid);
        if (index >= 0) source.splice(index, 1);
        card.zone = to;
        if (owner !== undefined) card.owner = owner;
        zoneList(state, to, card.owner).push(iid);
    }
}

export function moveCard(ctx: MoveCtx, iid: Iid, dest: Destination, cause: EventType): MoveOutcome {
    const card = ctx.state.cards[iid];
    if (!card) throw new Error(`Cannot move unknown card ${iid}`);

    const from = card.zone;
    let to = destZone(dest);
    const owner = destOwner(card, dest);

    if (isShielded(ctx, iid, cause, to)) return { moved: false, from, to, replaced: false, shielded: true };

    const plans = orderedPlans(findReplacements(ctx, iid, { type: cause, card: iid, player: card.owner }), ctx.order);
    for (const plan of plans) {
        if (plan.kind === 'redirect') {
            to = plan.zone;
            break;
        }
        ctx.runReplacement(plan.player, plan.source, plan.effect);
        return { moved: false, from, to, replaced: true, shielded: false };
    }

    const source = zoneList(ctx.state, from, card.owner);
    const index = source.indexOf(iid);
    if (index >= 0) source.splice(index, 1);

    card.zone = to;
    card.owner = owner;
    if (to === 'deck') zoneList(ctx.state, to).unshift(iid);
    else zoneList(ctx.state, to, owner).push(iid);

    ctx.log.emit({ type: cause, card: iid, player: owner });
    if (from === 'stable' && to !== 'stable') ctx.log.emit({ type: 'leaveStable', card: iid, player: owner });
    if (to === 'stable' && from !== 'stable') ctx.log.emit({ type: 'enterStable', card: iid, player: owner });

    return { moved: true, from, to, replaced: false, shielded: false };
}
