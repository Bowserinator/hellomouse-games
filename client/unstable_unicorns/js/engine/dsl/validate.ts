import {
    CMPS, COND_KINDS, EFFECT_KINDS, EVENT_TYPES, FILTER_KINDS, KINDS,
    MODIFIER_KINDS, PRIMITIVE_KINDS, UNICORN_TYPES
} from './ast.js';
import type {
    CardDef, CatalogEntry, Cond, CountSpec, Effect, Filter, OwnerRef,
    Primitive, Selector
} from './ast.js';

const OWNER_REFS: Array<OwnerRef> = ['self', 'other', 'any', 'active'];
const ZONES_OR_ANY = ['hand', 'stable', 'deck', 'discard', 'nursery', 'limbo', 'any'];

export function validateCard(def: CardDef, customs: Set<string>): Array<string> {
    const issues: Array<string> = [];
    const bad = (path: string, message: string) => issues.push(`${path}: ${message}`);
    const scope = new Set<string>();

    if (!def.id) bad('id', 'missing id');
    if (!KINDS.includes(def.kind)) bad(`${def.id}.kind`, `unknown kind ${String(def.kind)}`);
    if (def.unicornType !== undefined && !UNICORN_TYPES.includes(def.unicornType))
        bad(`${def.id}.unicornType`, `unknown unicorn type ${String(def.unicornType)}`);
    if (def.playTarget !== undefined && !['self', 'any', 'other'].includes(def.playTarget))
        bad(`${def.id}.playTarget`, `unknown play target ${String(def.playTarget)}`);
    if (def.instant !== undefined && def.instant.neigh !== true)
        bad(`${def.id}.instant`, 'instant must be { neigh: true }');

    const checkCount = (count: CountSpec, path: string) => {
        if (typeof count === 'number') {
            if (!Number.isInteger(count) || count < 0) bad(path, `bad count ${count}`);
            return;
        }
        if ('var' in count) {
            if (!count.var) bad(path, 'empty count binding');
            else if (!scope.has(count.var)) bad(path, `binding ${count.var} used before it is defined`);
            return;
        }
        if (!Number.isInteger(count.min) || !Number.isInteger(count.max) || count.min < 0 || count.min > count.max)
            bad(path, `bad count range ${count.min}..${count.max}`);
    };

    const checkFilter = (filter: Filter, path: string) => {
        if (!FILTER_KINDS.includes(filter.f)) {
            bad(path, `unknown filter ${String((filter as { f: unknown }).f)}`);
            return;
        }
        switch (filter.f) {
            case 'type':
                if (!KINDS.includes(filter.type)) bad(path, `unknown card type ${String(filter.type)}`);
                break;
            case 'tag':
                if (!filter.tag) bad(path, 'empty tag');
                break;
            case 'unicorn':
                if (filter.unicorn !== undefined && !UNICORN_TYPES.includes(filter.unicorn))
                    bad(path, `unknown unicorn type ${String(filter.unicorn)}`);
                break;
            case 'owner':
                if (!OWNER_REFS.includes(filter.owner)) bad(path, `unknown owner ref ${String(filter.owner)}`);
                break;
            case 'and':
            case 'or': {
                const list = filter.f === 'and' ? filter.all : filter.any;
                if (!Array.isArray(list) || list.length === 0) bad(path, 'empty filter list');
                else list.forEach((sub, i) => checkFilter(sub, `${path}.${i}`));
                break;
            }
            case 'not':
                checkFilter(filter.not, `${path}.not`);
                break;
        }
    };

    const checkCond = (cond: Cond, path: string) => {
        if (!COND_KINDS.includes(cond.c)) {
            bad(path, `unknown condition ${String((cond as { c: unknown }).c)}`);
            return;
        }
        switch (cond.c) {
            case 'event':
                if (!EVENT_TYPES.includes(cond.type)) bad(path, `unknown event ${String(cond.type)}`);
                break;
            case 'count':
                if (!ZONES_OR_ANY.includes(cond.zone)) bad(path, `bad zone ${String(cond.zone)}`);
                if (!OWNER_REFS.includes(cond.owner)) bad(path, `unknown owner ref ${String(cond.owner)}`);
                if (!CMPS.includes(cond.cmp)) bad(path, `unknown comparison ${String(cond.cmp)}`);
                if (!Number.isInteger(cond.n) || cond.n < 0) bad(path, `bad count ${cond.n}`);
                if (cond.filter) checkFilter(cond.filter, `${path}.filter`);
                break;
            case 'selfInStable':
                break;
            case 'and':
            case 'or': {
                const list = cond.c === 'and' ? cond.all : cond.any;
                if (!Array.isArray(list) || list.length === 0) bad(path, 'empty condition list');
                else list.forEach((sub, i) => checkCond(sub, `${path}.${i}`));
                break;
            }
            case 'not':
                checkCond(cond.not, `${path}.not`);
                break;
        }
    };

    const checkSelector = (sel: Selector, path: string) => {
        if (!ZONES_OR_ANY.includes(sel.zone)) bad(path, `bad zone ${String(sel.zone)}`);
        if (!OWNER_REFS.includes(sel.owner)) bad(path, `unknown owner ref ${String(sel.owner)}`);
        checkCount(sel.count, `${path}.count`);
        if (sel.mode !== undefined && !['choose', 'random'].includes(sel.mode))
            bad(path, `unknown mode ${String(sel.mode)}`);
        if (sel.chooser !== undefined && !['controller', 'zoneOwner'].includes(sel.chooser))
            bad(path, `unknown chooser ${String(sel.chooser)}`);
        if (sel.filter) checkFilter(sel.filter, `${path}.filter`);
        if (sel.as !== undefined)
            if (!sel.as) bad(path, 'empty binding name');
            else scope.add(sel.as);
    };

    const checkPrimitive = (prim: Primitive, path: string) => {
        if (!PRIMITIVE_KINDS.includes(prim.p)) {
            bad(path, `unknown primitive ${String((prim as { p: unknown }).p)}`);
            return;
        }
        switch (prim.p) {
            case 'draw':
                checkCount(prim.count, `${path}.count`);
                if (prim.who !== undefined && !['self', 'active'].includes(prim.who))
                    bad(path, `unknown player ${String(prim.who)}`);
                break;
            case 'discard':
            case 'destroy':
            case 'sacrifice':
            case 'returnToHand':
            case 'stealRandom':
                checkSelector(prim.sel, `${path}.sel`);
                break;
            case 'moveCard':
            case 'shuffleInto':
                checkSelector(prim.sel, `${path}.sel`);
                if (!ZONES_OR_ANY.includes(prim.zone)) bad(path, `bad zone ${String(prim.zone)}`);
                if (!OWNER_REFS.includes(prim.owner)) bad(path, `unknown owner ref ${String(prim.owner)}`);
                break;
            case 'moveStable':
                checkSelector(prim.sel, `${path}.sel`);
                if (!OWNER_REFS.includes(prim.owner)) bad(path, `unknown owner ref ${String(prim.owner)}`);
                break;
            case 'lookAndSteal':
                if (!['deck', 'discard'].includes(prim.from)) bad(path, `bad source ${String(prim.from)}`);
                if (!Number.isInteger(prim.count) || prim.count < 1) bad(path, `bad count ${prim.count}`);
                break;
            case 'swapHands':
                if (!OWNER_REFS.includes(prim.who)) bad(path, `unknown owner ref ${String(prim.who)}`);
                break;
            case 'tradeUnicorns':
                checkSelector(prim.mine, `${path}.mine`);
                checkSelector(prim.theirs, `${path}.theirs`);
                break;
            case 'search':
                if (!['deck', 'discard'].includes(prim.from)) bad(path, `bad source ${String(prim.from)}`);
                checkCount(prim.count, `${path}.count`);
                if (prim.filter) checkFilter(prim.filter, `${path}.filter`);
                if (prim.as !== undefined)
                    if (!prim.as) bad(path, 'empty binding name');
                    else scope.add(prim.as);

                break;
            case 'fetchFromDiscard':
                checkCount(prim.count, `${path}.count`);
                if (prim.filter) checkFilter(prim.filter, `${path}.filter`);
                if (prim.as !== undefined)
                    if (!prim.as) bad(path, 'empty binding name');
                    else scope.add(prim.as);

                break;
            case 'replaceUnicornsWithBabies':
                if (prim.sel) checkSelector(prim.sel, `${path}.sel`);
                break;
            case 'addLingering':
                if (!['endOfTurn', 'sourceLeavesStable'].includes(prim.until))
                    bad(path, `bad lingering expiry ${String(prim.until)}`);
                checkEffect(prim.effect, `${path}.0`);
                break;
            case 'custom':
                if (!prim.name) bad(path, 'empty custom name');
                else if (!customs.has(prim.name)) bad(path, `unknown custom handler ${prim.name}`);
                break;
            case 'takeExtraTurn':
            case 'endTurnNow':
                break;
        }
    };

    const checkEffect = (effect: Effect, path: string) => {
        if (!EFFECT_KINDS.includes(effect.e)) {
            bad(path, `unknown effect ${String((effect as { e: unknown }).e)}`);
            return;
        }
        switch (effect.e) {
            case 'seq':
                effect.steps.forEach((step, i) => checkEffect(step, `${path}.${i}`));
                break;
            case 'prim':
                checkPrimitive(effect.prim, `${path}.prim`);
                break;
            case 'choice': {
                if (effect.options.length === 0) bad(path, 'choice with no options');
                const before = new Set(scope);
                const added = new Set<string>();
                effect.options.forEach((option, i) => {
                    for (const name of scope) if (!before.has(name)) added.add(name);
                    scope.clear();
                    for (const name of before) scope.add(name);
                    checkEffect(option, `${path}.${i}`);
                    for (const name of scope) if (!before.has(name)) added.add(name);
                });
                scope.clear();
                for (const name of before) scope.add(name);
                for (const name of added) scope.add(name);
                break;
            }
            case 'optional':
            case 'ifYouDo':
            case 'forEachPlayer':
            case 'when':
                checkEffect(effect.effect, `${path}.0`);
                break;
            case 'repeat':
                checkCount(effect.count, `${path}.count`);
                checkEffect(effect.effect, `${path}.0`);
                break;
        }
        if (effect.e === 'when') checkCond(effect.cond, `${path}.cond`);
        if (effect.e === 'forEachPlayer' && effect.who !== undefined && !OWNER_REFS.includes(effect.who))
            bad(path, `unknown owner ref ${String(effect.who)}`);
    };

    if (def.playIf) checkCond(def.playIf, `${def.id}.playIf`);
    if (def.onPlay) checkEffect(def.onPlay, `${def.id}#onPlay`);

    (def.triggers ?? []).forEach((trigger, i) => {
        const path = `${def.id}#trigger${i}`;
        if (!EVENT_TYPES.includes(trigger.on)) bad(path, `unknown event ${String(trigger.on)}`);
        if (trigger.when) checkCond(trigger.when, `${path}.when`);
        checkEffect(trigger.effect, path);
    });

    (def.replacements ?? []).forEach((replacement, i) => {
        const path = `${def.id}#replace${i}`;
        if (replacement.r !== 'replace') bad(path, `unknown replacement kind ${String(replacement.r)}`);
        if (!EVENT_TYPES.includes(replacement.when)) bad(path, `unknown event ${String(replacement.when)}`);
        if (replacement.filter) checkFilter(replacement.filter, `${path}.filter`);
        if (replacement.unless) checkCond(replacement.unless, `${path}.unless`);
        checkEffect(replacement.effect, path);
    });

    (def.modifiers ?? []).forEach((modifier, i) => {
        const path = `${def.id}.modifier${i}`;
        if (!MODIFIER_KINDS.includes(modifier.m)) {
            bad(path, `unknown modifier ${String((modifier as { m: unknown }).m)}`);
            return;
        }
        if ('value' in modifier && !Number.isInteger(modifier.value))
            bad(path, `bad value ${modifier.value}`);
        if ('value' in modifier && modifier.value < 0 && (modifier.m === 'stableLimit' || modifier.m === 'unicornCount'))
            bad(path, `bad value ${modifier.value}`);
        if (modifier.m === 'unicornType' && !UNICORN_TYPES.includes(modifier.type))
            bad(path, `unknown unicorn type ${String(modifier.type)}`);
        if (modifier.m === 'protect' && !['destroy', 'sacrifice', 'neigh', 'play'].includes(modifier.against))
            bad(path, `unknown protection ${String(modifier.against)}`);
        if (modifier.m === 'blockPlay' && !KINDS.includes(modifier.kind))
            bad(path, `unknown card type ${String(modifier.kind)}`);
        if ('filter' in modifier && modifier.filter) checkFilter(modifier.filter, `${path}.filter`);
    });

    return issues;
}

export function validateRegistry(
    defs: Array<CardDef>,
    catalog: Array<CatalogEntry>,
    customs: Set<string>
): Array<string> {
    const issues: Array<string> = [];
    const seen = new Set<string>();

    for (const def of defs) {
        if (seen.has(def.id)) issues.push(`${def.id}: duplicate card script`);
        seen.add(def.id);
        issues.push(...validateCard(def, customs));
    }

    for (const entry of catalog) {
        if (!entry.id) issues.push('catalog entry with no id');
        if (!KINDS.includes(entry.kind)) issues.push(`${entry.id}: unknown catalog kind ${String(entry.kind)}`);
        if (!Number.isInteger(entry.copies) || entry.copies < 0)
            issues.push(`${entry.id}: bad copies ${entry.copies}`);
        if (!seen.has(entry.id)) issues.push(`${entry.id}: catalog entry has no card script`);
    }

    const catalogIds = new Set(catalog.map(entry => entry.id));
    for (const id of seen)
        if (!catalogIds.has(id)) issues.push(`${id}: card script has no catalog entry`);

    return issues;
}
