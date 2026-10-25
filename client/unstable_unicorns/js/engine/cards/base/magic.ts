import type { CardDef, Effect } from '../../dsl/ast.js';
import { anyOf, prim, sel, seq } from '../../dsl/builders.js';

const destroyUnicorn = (): Effect =>
    prim({ p: 'destroy', sel: sel('stable', 'any', 1, { filter: { f: 'unicorn' } }) });

const destroyStableCard = (): Effect =>
    prim({
        p: 'destroy',
        sel: sel('stable', 'any', 1, {
            filter: anyOf({ f: 'type', type: 'upgrade' }, { f: 'type', type: 'downgrade' })
        })
    });

export const MAGIC_DEFS: Array<CardDef> = [
    { id: 'snatch', kind: 'magic', onPlay: destroyUnicorn() },
    { id: 'gift', kind: 'magic', onPlay: prim({ p: 'draw', count: 2 }) },
    {
        id: 'muster',
        kind: 'magic',
        onPlay: prim({ p: 'search', from: 'deck', filter: { f: 'unicorn' }, count: 1 })
    },
    {
        id: 'pillage',
        kind: 'magic',
        onPlay: prim({ p: 'discard', sel: sel('hand', 'other', 1, { mode: 'random' }) })
    },
    { id: 'swap', kind: 'magic', onPlay: prim({ p: 'swapHands', who: 'other' }) },
    { id: 'recycle', kind: 'magic', onPlay: prim({ p: 'fetchFromDiscard', count: 1 }) },
    { id: 'babyboom', kind: 'magic', onPlay: prim({ p: 'replaceUnicornsWithBabies' }) },
    { id: 'extra', kind: 'magic', onPlay: prim({ p: 'takeExtraTurn' }) },
    { id: 'push', kind: 'magic', onPlay: destroyStableCard() },
    {
        id: 'fade',
        kind: 'magic',
        onPlay: prim({
            p: 'addLingering',
            until: 'endOfTurn',
            effect: prim({ p: 'draw', count: 1 })
        })
    },
    {
        id: 'pyre',
        kind: 'magic',
        onPlay: seq(
            prim({ p: 'sacrifice', sel: sel('stable', 'self', 1, { filter: { f: 'unicorn' } }) }),
            prim({ p: 'draw', count: 2 })
        )
    },
    {
        id: 'bounce',
        kind: 'magic',
        onPlay: prim({ p: 'returnToHand', sel: sel('stable', 'any', 1, { filter: { f: 'unicorn' } }) })
    },
    {
        id: 'kidnap',
        kind: 'magic',
        onPlay: prim({
            p: 'moveCard',
            sel: sel('stable', 'other', 1, { filter: { f: 'unicorn' } }),
            zone: 'stable',
            owner: 'self'
        })
    },
    {
        id: 'foretell',
        kind: 'magic',
        onPlay: seq(
            prim({ p: 'draw', count: 2 }),
            prim({ p: 'moveCard', sel: sel('hand', 'self', 1), zone: 'deck', owner: 'self' })
        )
    },
    {
        id: 'raid',
        kind: 'magic',
        onPlay: prim({ p: 'stealRandom', sel: sel('hand', 'other', 1) })
    },
    { id: 'peek', kind: 'magic', onPlay: prim({ p: 'lookAndSteal', from: 'deck', count: 3 }) },
    {
        id: 'barter',
        kind: 'magic',
        onPlay: prim({
            p: 'tradeUnicorns',
            mine: sel('stable', 'self', 1, { filter: { f: 'unicorn' } }),
            theirs: sel('stable', 'other', 1, { filter: { f: 'unicorn' } })
        })
    },
    {
        id: 'bury',
        kind: 'magic',
        onPlay: prim({ p: 'shuffleInto', sel: sel('hand', 'self', 1), zone: 'deck', owner: 'self' })
    },
    { id: 'yawn', kind: 'magic', onPlay: prim({ p: 'endTurnNow' }) },
    { id: 'settle', kind: 'magic', onPlay: prim({ p: 'moveStable', sel: sel('hand', 'self', 1), owner: 'self' }) },
    { id: 'nope', kind: 'instant', instant: { neigh: true } },
    { id: 'supernope', kind: 'instant', instant: { neigh: true, superNeigh: true } }
];
