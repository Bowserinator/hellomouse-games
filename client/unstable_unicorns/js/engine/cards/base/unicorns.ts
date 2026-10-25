import type { CardDef } from '../../dsl/ast.js';
import { prim } from '../../dsl/builders.js';

export const UNICORN_DEFS: Array<CardDef> = [
    { id: 'foal', kind: 'baby', unicornType: 'baby' },
    { id: 'unicorn', kind: 'basic' },
    {
        id: 'sparkle',
        kind: 'basic',
        triggers: [{ on: 'enterStable', effect: prim({ p: 'draw', count: 1 }) }]
    },
    {
        id: 'dawn',
        kind: 'basic',
        triggers: [{ on: 'turnStart', effect: prim({ p: 'draw', count: 1 }) }]
    },
    { id: 'swift', kind: 'basic', modifiers: [{ m: 'actionsPerTurn', value: 1 }] },
    { id: 'packrat', kind: 'basic', modifiers: [{ m: 'handLimit', value: 2 }] },
    { id: 'triplet', kind: 'basic', modifiers: [{ m: 'unicornCount', value: 2 }] },
    { id: 'panda', kind: 'basic', unicornType: 'panda' },
    {
        id: 'guardian',
        kind: 'basic',
        modifiers: [{ m: 'protect', against: 'destroy', filter: { f: 'unicorn' } }]
    },
    { id: 'pegasus', kind: 'basic', tags: ['wing'] }
];
