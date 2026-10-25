import type { CardDef, Filter, Kind, Modifier, UnicornType } from '../dsl/ast.js';
import type { FilterCtx } from '../dsl/filter.js';
import { matches } from '../dsl/filter.js';
import type { Iid } from '../ids.js';
import type { GameState } from '../state.js';
import { ACTIONS_PER_TURN, DRAWS_PER_TURN, HAND_LIMIT } from '../../vars.js';

export interface World {
    state: GameState;
    defOf(iid: Iid): CardDef | undefined;
}

export type Protection = 'destroy' | 'sacrifice' | 'neigh' | 'play';

export function defOfCard(world: World, iid: Iid): CardDef | undefined {
    return world.defOf(iid);
}

export function stableCards(world: World, player: number): Array<Iid> {
    const p = world.state.players[player];
    return p ? p.stable : [];
}

export function baseIsUnicorn(def: CardDef | undefined): boolean {
    return !!def && (def.kind === 'basic' || def.kind === 'baby');
}

export function baseUnicornType(def: CardDef | undefined): UnicornType | null {
    if (!baseIsUnicorn(def) || !def) return null;
    if (def.unicornType) return def.unicornType;
    return def.kind === 'baby' ? 'baby' : 'basic';
}

function countsAsUnicorn(type: UnicornType | null): boolean {
    return type !== null && type !== 'panda';
}

function modifiersOn(world: World, iid: Iid): Array<Modifier> {
    const def = world.defOf(iid);
    return def && def.modifiers ? def.modifiers : [];
}

function selfModifiers(world: World, player: number): Array<Modifier> {
    const out: Array<Modifier> = [];
    for (const iid of stableCards(world, player)) out.push(...modifiersOn(world, iid));
    return out;
}

function plainCtx(world: World, self: number): FilterCtx {
    return {
        self,
        active: world.state.turn.player,
        defOf: iid => world.defOf(iid),
        isUnicorn: (iid, type) => {
            const current = baseUnicornType(world.defOf(iid));
            return type === undefined ? countsAsUnicorn(current) : current === type;
        },
        ownerOf: iid => {
            const card = world.state.cards[iid];
            return card ? card.owner : -1;
        }
    };
}

export function unicornType(world: World, iid: Iid): UnicornType | null {
    let type = baseUnicornType(world.defOf(iid));
    const card = world.state.cards[iid];
    if (!card || card.zone !== 'stable') return type;
    const owner = card.owner;

    const ctx = plainCtx(world, owner);
    for (const iidSource of stableCards(world, owner))
        for (const mod of modifiersOn(world, iidSource))
            if (mod.m === 'unicornType' && (mod.filter || baseIsUnicorn(world.defOf(iid))))
                if (matches(mod.filter, iid, ctx)) type = mod.type;

    return type;
}

export function isUnicorn(world: World, iid: Iid, type?: UnicornType): boolean {
    const current = unicornType(world, iid);
    return type === undefined ? countsAsUnicorn(current) : current !== null && current === type;
}

export function unicornCount(world: World, player: number): number {
    let total = 0;
    for (const iid of stableCards(world, player)) {
        if (!isUnicorn(world, iid)) continue;
        let weight = 1;
        for (const mod of modifiersOn(world, iid))
            if (mod.m === 'unicornCount')
                if (matches(mod.filter, iid, plainCtx(world, player))) weight = Math.max(weight, mod.value);
        total += weight;
    }
    return total;
}

export function actionsPerTurn(world: World, player: number): number {
    let total = ACTIONS_PER_TURN;
    for (const mod of selfModifiers(world, player)) if (mod.m === 'actionsPerTurn') total += mod.value;
    return total;
}

export function drawsPerTurn(world: World, player: number): number {
    let total = DRAWS_PER_TURN;
    for (const mod of selfModifiers(world, player)) if (mod.m === 'drawsPerTurn') total += mod.value;
    return total;
}

export function handLimit(world: World, player: number): number {
    let total = HAND_LIMIT;
    for (const mod of selfModifiers(world, player)) if (mod.m === 'handLimit') total += mod.value;
    return total;
}

export function stableLimit(world: World, player: number): number {
    let limit = Infinity;
    for (const mod of selfModifiers(world, player)) if (mod.m === 'stableLimit') limit = Math.min(limit, mod.value);
    return limit;
}

export function blocksTriggers(world: World, player: number): boolean {
    return selfModifiers(world, player).some(mod => mod.m === 'blockTriggers');
}

export function handVisible(world: World, player: number): boolean {
    return selfModifiers(world, player).some(mod => mod.m === 'handVisible');
}

export function blocksPlay(world: World, player: number, kind: Kind): boolean {
    return selfModifiers(world, player).some(mod => mod.m === 'blockPlay' && mod.kind === kind);
}

export function blocksOtherPlay(world: World, target: number, player: number, kind: Kind, iid?: Iid): boolean {
    const ctx = plainCtx(world, target);
    return target !== player && selfModifiers(world, target).some(mod =>
        mod.m === 'blockOtherPlay' && mod.kind === kind &&
        (!mod.filter || iid === undefined || matches(mod.filter, iid, ctx)));
}

export function protectedFrom(world: World, iid: Iid, against: Protection): boolean {
    const card = world.state.cards[iid];
    if (!card) return false;
    const ctx = plainCtx(world, card.owner);
    for (const source of stableCards(world, card.owner))
        for (const mod of modifiersOn(world, source))
            if (mod.m === 'protect' && mod.against === against && matches(mod.filter, iid, ctx))
                return true;
    return false;
}

export function tagOf(world: World, iid: Iid): Array<string> {
    const def = world.defOf(iid);
    return def && def.tags ? def.tags : [];
}

function redundantModifier(world: World, seat: number, mod: Modifier): boolean {
    const stable = stableCards(world, seat);
    const ctx = plainCtx(world, seat);
    const matching = stable.filter(iid => matches('filter' in mod ? mod.filter : undefined, iid, ctx));
    switch (mod.m) {
        case 'handVisible':
            return handVisible(world, seat);
        case 'blockPlay':
            return blocksPlay(world, seat, mod.kind);
        case 'protect':
            if (matching.length === 0) return false;
            return matching.every(iid => protectedFrom(world, iid, mod.against));
        case 'unicornType':
            if (matching.length === 0) return false;
            return matching.every(iid => unicornType(world, iid) === mod.type);
        case 'unicornCount':
            if (matching.length === 0) return false;
            return matching.every(iid => {
                let weight = 1;
                for (const other of modifiersOn(world, iid))
                    if (other.m === 'unicornCount' && matches(other.filter, iid, ctx))
                        weight = Math.max(weight, other.value);
                return weight >= mod.value;
            });
        case 'stableLimit':
            return stableLimit(world, seat) <= mod.value;
        default:
            return false;
    }
}

export function inertStableCard(world: World, seat: number, def: CardDef): boolean {
    if (def.kind !== 'upgrade' && def.kind !== 'downgrade') return false;
    if (def.onPlay?.id) return false;
    if (def.triggers && def.triggers.length > 0) return false;
    if (def.replacements && def.replacements.length > 0) return false;
    if (!def.modifiers || def.modifiers.length === 0) return true;
    return def.modifiers.every(mod => redundantModifier(world, seat, mod));
}

export type { Filter };
