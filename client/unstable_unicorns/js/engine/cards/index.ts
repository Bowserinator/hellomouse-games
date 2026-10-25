import type { CardDef, Cond, Effect, Replacement, Trigger, Filter, Modifier } from '../dsl/ast.js';
import { sel, prim, seq, anyOf } from '../dsl/builders.js';
import { BASE_CATALOG } from '../../catalog/base.js';

const unicorn: Filter = { f: 'unicorn' };
const plainBasicUnicorn: Filter = { f: 'unicorn', unicorn: 'basic' };
const upgradeOrDowngrade: Filter = anyOf({ f: 'type', type: 'upgrade' }, { f: 'type', type: 'downgrade' });
const discard = (count: number): Effect => prim({ p: 'discard', sel: sel('hand', 'self', count) });
const optional = (effect: Effect): Effect => ({ e: 'optional', effect });
const draw = (count: number): Effect => prim({ p: 'draw', count });
const destroyUnicorn = (): Effect => prim({ p: 'destroy', sel: sel('stable', 'any', 1, { filter: unicorn }) });
const destroyCard = (): Effect => prim({ p: 'destroy', sel: sel('stable', 'any', 1) });
const destroyStableCard = (): Effect => prim({ p: 'destroy', sel: sel('stable', 'any', 1, { filter: upgradeOrDowngrade }) });
const sacrificeUnicorn = (): Effect => prim({ p: 'sacrifice', sel: sel('stable', 'self', 1, { filter: unicorn }) });
const allPlayers = (effect: Effect): Effect => ({ e: 'forEachPlayer', who: 'any', effect });
const on = (event: Trigger['on'], effect: Effect): Trigger => ({
    on: event, effect, scope: event === 'turnStart' || event === 'turnEnd' ? 'owner' : 'source'
});
const effectWhen = (cond: Cond, effect: Effect): Effect => ({ e: 'when', cond, effect });
const has = (zone: 'hand' | 'stable' | 'discard' | 'nursery' | 'deck', owner: 'self' | 'other' | 'any', filter?: Filter, n = 1): Cond => ({ c: 'count', zone, owner, filter, cmp: 'gte', n });
const returnOwnToHand = (): Effect => prim({ p: 'returnToHand', sel: sel('stable', 'self', 1) });
const returnReplacement = (when: Replacement['when'], filter: Filter = unicorn): Replacement => ({
    r: 'replace', when, scope: 'source', filter, effect: prim({ p: 'returnSourceToHand' })
});
const nurseryReplacement = (when: Replacement['when']): Replacement => ({
    r: 'replace', when, effect: prim({ p: 'returnSourceToNursery' })
});

const effects = new Map<string, Effect>([
    ['alluring-narwhal', effectWhen(has('stable', 'other', { f: 'type', type: 'upgrade' }), optional(prim({ p: 'moveCard', sel: sel('stable', 'other', 1, { filter: { f: 'type', type: 'upgrade' } }), zone: 'stable', owner: 'self' })))],
    ['americorn', prim({ p: 'pullRandomFromPlayer' })],
    ['annoying-flying-unicorn', effectWhen(has('hand', 'any'), optional(prim({ p: 'discardFromPlayer' })))],
    ['back-kick', effectWhen(has('stable', 'any'), prim({ p: 'returnToHandAndDiscard', sel: sel('stable', 'any', 1) }))],
    ['blatant-thievery', prim({ p: 'stealFromPlayer' })],
    ['chainsaw-unicorn', effectWhen(has('stable', 'any', upgradeOrDowngrade), optional({ e: 'choice', options: [
        prim({ p: 'sacrifice', sel: sel('stable', 'self', 1, { filter: upgradeOrDowngrade }) }),
        destroyStableCard()
    ] }))],
    ['classy-narwhal', optional(prim({ p: 'search', from: 'deck', filter: { f: 'type', type: 'upgrade' }, count: 1 }))],
    ['glitter-tornado', allPlayers(effectWhen(has('stable', 'self'), returnOwnToHand()))],
    ['good-deal', seq(draw(3), discard(1))],
    ['magical-flying-unicorn', optional(prim({ p: 'fetchFromDiscard', filter: { f: 'type', type: 'magic' }, count: 1 }))],
    ['majestic-flying-unicorn', optional(prim({ p: 'fetchFromDiscard', filter: unicorn, count: 1 }))],
    ['mermaid-unicorn', effectWhen(has('stable', 'any'), optional(prim({ p: 'returnFromPlayer' })))],
    ['mystical-vortex', seq(allPlayers(effectWhen(has('hand', 'self'), discard(1))), prim({ p: 'shuffleZonesIntoDeck', zones: ['discard'] }))],
    ['narwhal-torpedo', prim({ p: 'sacrifice', sel: sel('stable', 'self', { min: 0, max: 99 }, { filter: { f: 'type', type: 'downgrade' } }) })],
    ['rainbow-mane', prim({ p: 'moveCard', sel: sel('hand', 'self', 1, { filter: plainBasicUnicorn }), zone: 'stable', owner: 'self' })],
    ['rainbow-unicorn', prim({ p: 'moveCard', sel: sel('hand', 'self', 1, { filter: plainBasicUnicorn }), zone: 'stable', owner: 'self' })],
    ['re-target', effectWhen(has('stable', 'any', upgradeOrDowngrade), prim({ p: 'moveCard', sel: sel('stable', 'any', 1, { filter: upgradeOrDowngrade }), zone: 'stable', owner: 'other' }))],
    ['reset-button', seq(prim({ p: 'sacrifice', sel: sel('stable', 'any', { min: 0, max: 99 }, { filter: upgradeOrDowngrade }) }), prim({ p: 'shuffleZonesIntoDeck', zones: ['discard'] }))],
    ['rhinocorn', effectWhen(has('stable', 'any', unicorn), optional(destroyUnicorn()))],

    ['shabby-the-narwhal', optional(prim({ p: 'search', from: 'deck', filter: { f: 'type', type: 'downgrade' }, count: 1 }))],
    ['shake-up', seq(prim({ p: 'shuffleZonesIntoDeck', zones: ['hand', 'discard', 'limbo'] }), draw(5))],

    ['swift-flying-unicorn', optional(prim({ p: 'fetchFromDiscard', filter: { f: 'type', type: 'instant' }, count: 1 }))],

    ['targeted-destruction', { e: 'choice', options: [
        prim({ p: 'sacrifice', sel: sel('stable', 'self', 1, { filter: upgradeOrDowngrade }) }),
        destroyStableCard()
    ] }],
    ['the-great-narwhal', optional(prim({ p: 'search', from: 'deck', filter: { f: 'tag', tag: 'narwhal' }, count: 1 }))],
    ['two-for-one', seq(prim({ p: 'sacrifice', sel: sel('stable', 'self', 1) }), prim({ p: 'destroy', sel: sel('stable', 'other', 2) }))],
    ['unfair-bargain', prim({ p: 'swapHands', who: 'other' })],
    ['unicorn-lasso', effectWhen(has('stable', 'other', unicorn), optional(prim({ p: 'stealUntil', sel: sel('stable', 'other', 1, { filter: unicorn }), until: 'endOfTurn' })))],
    ['unicorn-on-the-cob', seq(draw(2), discard(1))],
    ['unicorn-poison', destroyUnicorn()],
    ['unicorn-shrinkray', prim({ p: 'replaceUnicornsWithBabies' })],
    ['unicorn-swap', effectWhen({ c: 'and', all: [has('stable', 'self', unicorn), has('stable', 'other', unicorn)] }, prim({ p: 'tradeUnicorns', mine: sel('stable', 'self', 1, { filter: unicorn }), theirs: sel('stable', 'other', 1, { filter: unicorn }) }))],
    ['seductive-unicorn', effectWhen(has('stable', 'other', unicorn), prim({ p: 'stealUntil', sel: sel('stable', 'other', 1, { filter: unicorn }), until: 'sourceLeavesStable' }))],
    ['change-of-luck', seq(draw(2), discard(3), prim({ p: 'takeExtraTurn' }))]
]);

const triggers = new Map<string, Array<Trigger>>([
    ['alluring-narwhal', [on('enterStable', effects.get('alluring-narwhal')!)]],
    ['barbed-wire', [
        { ...on('enterStable', discard(1)), scope: 'owner', unicorn: true },
        { ...on('leaveStable', discard(1)), scope: 'owner', unicorn: true }
    ]],
    ['extra-tail', [on('turnStart', optional(draw(1)))]],
    ['puppicorn', [{ ...on('turnStart', prim({ p: 'moveCard', sel: sel('stable', 'self', 1, { filter: { f: 'tag', tag: 'puppicorn' } }), zone: 'stable', owner: 'active' })), scope: undefined }]],
    ['glitter-bomb', [on('turnStart', { e: 'ifYouDo', effect: seq(prim({ p: 'sacrifice', sel: sel('stable', 'self', 1) }), destroyCard()) })]],
    ['greedy-flying-unicorn', [on('enterStable', draw(1))]],
    ['rainbow-mane', [on('turnStart', optional(effects.get('rainbow-mane')!))]],
    ['rhinocorn', [on('turnStart', effectWhen(has('stable', 'any', unicorn), { e: 'ifYouDo', effect: seq(destroyUnicorn(), prim({ p: 'endTurnNow' })) }))]],
    ['sadistic-ritual', [on('turnStart', effectWhen(has('stable', 'self', unicorn), seq(sacrificeUnicorn(), draw(1))))]],
    ['unicorn-lasso', [on('turnStart', effects.get('unicorn-lasso')!)]],
    ['summoning-ritual', [on('turnStart', effectWhen(has('hand', 'self', unicorn, 2), optional(seq(prim({ p: 'discard', sel: sel('hand', 'self', 2, { filter: unicorn }) }), prim({ p: 'moveCard', sel: sel('discard', 'any', 1, { filter: unicorn }), zone: 'stable', owner: 'self' })))))]],
    ['unicorn-on-the-cob', [on('enterStable', seq(draw(2), discard(1)))]],
    ['rainbow-unicorn', [on('enterStable', effectWhen(has('hand', 'self', plainBasicUnicorn), optional(effects.get('rainbow-unicorn')!)))]],
    ['shark-with-a-horn', [on('enterStable', effectWhen(has('stable', 'self', unicorn), { e: 'ifYouDo', effect: seq(prim({ p: 'sacrificeSource' }), destroyUnicorn()) }))]],
    ['seductive-unicorn', [on('enterStable', effectWhen(has('stable', 'other', unicorn), effects.get('seductive-unicorn')!))]],
    ['stabby-the-unicorn', [on('destroy', effectWhen(has('stable', 'any', unicorn), optional(destroyUnicorn())))]],
    ['tiny-stable', [{ ...on('enterStable', effectWhen(has('stable', 'self', unicorn, 6), sacrificeUnicorn())), scope: 'owner' }]]
]);

const replacements = new Map<string, Array<Replacement>>([
    ...BASE_CATALOG.filter(card => card.kind === 'baby').map(card => [card.id, [nurseryReplacement('destroy'), nurseryReplacement('sacrifice'), nurseryReplacement('return')]] as [string, Array<Replacement>]),
    ['annoying-flying-unicorn', [returnReplacement('destroy'), returnReplacement('sacrifice')]],
    ['black-knight-unicorn', [{ r: 'replace', when: 'destroy', scope: 'owner', filter: unicorn, effect: prim({ p: 'guardUnicorn' }) }]],
    ['greedy-flying-unicorn', [returnReplacement('destroy'), returnReplacement('sacrifice')]],
    ['magical-flying-unicorn', [returnReplacement('destroy'), returnReplacement('sacrifice')]],
    ['majestic-flying-unicorn', [returnReplacement('destroy'), returnReplacement('sacrifice')]],
    ['swift-flying-unicorn', [returnReplacement('destroy'), returnReplacement('sacrifice')]]
]);

const modifiers = new Map<string, Array<Modifier>>([

    ['ginormous-unicorn', [{ m: 'unicornCount', value: 2 }, { m: 'blockPlay', kind: 'instant' }]],
    ['nanny-cam', [{ m: 'handVisible' }]],
    ['pandamonium', [{ m: 'unicornType', type: 'panda' }]],
    ['rainbow-aura', [{ m: 'protect', against: 'destroy', filter: unicorn }]],
    ['slowdown', [{ m: 'blockPlay', kind: 'instant' }]],
    ['blinding-light', [{ m: 'blockTriggers' }]],
    ['broken-stable', [{ m: 'blockPlay', kind: 'upgrade' }]],
    ['yay', [{ m: 'protect', against: 'neigh' }]],
    ['queen-bee-unicorn', [{ m: 'blockOtherPlay', kind: 'basic', filter: plainBasicUnicorn }]],
    ['puppicorn', [{ m: 'protect', against: 'destroy', filter: { f: 'tag', tag: 'puppicorn' } }, { m: 'protect', against: 'sacrifice', filter: { f: 'tag', tag: 'puppicorn' } }]]
]);

function unicornTypeFor(card: typeof BASE_CATALOG[number]): CardDef['unicornType'] {
    if (card.unicornType) return card.unicornType;
    if (card.kind === 'baby') return 'baby';
    if (card.kind === 'basic') return 'basic';
    return undefined;
}

export const BASE_DEFS: Array<CardDef> = BASE_CATALOG.map(card => ({
    id: card.id,
    kind: card.kind,
    playTarget: card.kind === 'downgrade' ? 'any' : undefined,
    unicornType: unicornTypeFor(card),
    tags: card.id.includes('narwhal') ? ['narwhal'] : card.id === 'puppicorn' ? ['puppicorn'] : undefined,
    onPlay: card.kind === 'magic' ? effects.get(card.id) : undefined,
    triggers: triggers.get(card.id) ?? (card.kind === 'basic' && effects.has(card.id)
        ? [on('enterStable', effects.get(card.id)!)] : undefined),
    replacements: replacements.get(card.id),
    modifiers: modifiers.get(card.id),
    instant: card.kind === 'instant' ? { neigh: true, superNeigh: card.id === 'super-neigh' } : undefined,
    playIf: new Map<string, Cond>([
        ['targeted-destruction', has('stable', 'any', upgradeOrDowngrade)],
        ['two-for-one', { c: 'and', all: [
            has('stable', 'self', undefined, 1),
            has('stable', 'other', undefined, 2)
        ] }],
        ['extra-tail', has('stable', 'self', plainBasicUnicorn)],
        ['rainbow-mane', has('stable', 'self', plainBasicUnicorn)],
        ['unicorn-poison', has('stable', 'any', unicorn)]
    ]).get(card.id)
}));

export const BASE_CUSTOMS: Set<string> = new Set();
