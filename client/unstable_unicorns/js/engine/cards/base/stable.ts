import type { CardDef } from '../../dsl/ast.js';
import { prim, sel } from '../../dsl/builders.js';

export const STABLE_DEFS: Array<CardDef> = [
    {
        id: 'armor',
        kind: 'upgrade',
        modifiers: [{ m: 'protect', against: 'destroy', filter: { f: 'unicorn' } }]
    },
    {
        id: 'pandamaker',
        kind: 'upgrade',
        modifiers: [{ m: 'unicornType', type: 'special', filter: { f: 'tag', tag: 'wing' } }]
    },
    { id: 'rock', kind: 'downgrade', playTarget: 'any', modifiers: [{ m: 'actionsPerTurn', value: -1 }] },
    {
        id: 'freeloader',
        kind: 'downgrade',
        playTarget: 'any',
        unneighable: true,
        replacements: [
            {
                r: 'replace',
                when: 'destroy',
                effect: prim({ p: 'discard', sel: sel('hand', 'self', 1, { mode: 'random' }) })
            }
        ]
    },
    {
        id: 'lockdown',
        kind: 'upgrade',
        modifiers: [{ m: 'blockPlay', kind: 'magic' }]
    },
    { id: 'mirror', kind: 'upgrade', modifiers: [{ m: 'handVisible' }] }
];
