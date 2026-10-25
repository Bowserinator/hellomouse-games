import type { CatalogEntry } from '../engine/dsl/ast.js';

export const BASE_CATALOG: Array<CatalogEntry> = [
    { id: 'foal', name: 'Foal', kind: 'baby', unicornType: 'baby', text: 'A baby unicorn.', copies: 8 },

    { id: 'unicorn', name: 'Unicorn', kind: 'basic', text: 'A plain unicorn.', copies: 12 },
    { id: 'sparkle', name: 'Sparkle', kind: 'basic', text: 'When this enters your stable, draw a card.', copies: 3 },
    { id: 'dawn', name: 'Dawn', kind: 'basic', text: 'At the start of your turn, draw a card.', copies: 3 },
    { id: 'swift', name: 'Swift', kind: 'basic', text: 'You get an extra action each turn.', copies: 2 },
    { id: 'packrat', name: 'Packrat', kind: 'basic', text: 'Your hand limit is two higher.', copies: 2 },
    { id: 'triplet', name: 'Triplet', kind: 'basic', text: 'Counts as two unicorns.', copies: 2 },
    { id: 'panda', name: 'Panda', kind: 'basic', unicornType: 'panda', text: 'A panda unicorn.', copies: 2 },
    {
        id: 'guardian',
        name: 'Guardian',
        kind: 'basic',
        text: 'Your unicorns cannot be destroyed.',
        copies: 2
    },
    { id: 'pegasus', name: 'Pegasus', kind: 'basic', text: 'Has wings.', copies: 3 },

    {
        id: 'snatch',
        name: 'Snatch',
        kind: 'magic',
        text: 'Destroy a unicorn.',
        copies: 3
    },
    { id: 'gift', name: 'Gift', kind: 'magic', text: 'Draw two cards.', copies: 3 },
    {
        id: 'muster',
        name: 'Muster',
        kind: 'magic',
        text: 'Search the deck for a unicorn and take it.',
        copies: 2
    },
    {
        id: 'pillage',
        name: 'Pillage',
        kind: 'magic',
        text: 'Discard a random card from a hand.',
        copies: 2
    },
    { id: 'swap', name: 'Swap', kind: 'magic', text: 'Swap hands with a player.', copies: 2 },
    {
        id: 'recycle',
        name: 'Recycle',
        kind: 'magic',
        text: 'Search the discard pile and take a card.',
        copies: 2
    },
    {
        id: 'babyboom',
        name: 'Baby Boom',
        kind: 'magic',
        text: 'Replace your unicorns with babies.',
        copies: 2
    },
    { id: 'extra', name: 'Extra', kind: 'magic', text: 'Take another turn.', copies: 2 },
    {
        id: 'push',
        name: 'Push',
        kind: 'magic',
        text: 'Destroy an upgrade or downgrade.',
        copies: 2
    },
    {
        id: 'fade',
        name: 'Fade',
        kind: 'magic',
        text: 'Draw a card at the end of the turn.',
        copies: 2
    },
    {
        id: 'pyre',
        name: 'Pyre',
        kind: 'magic',
        text: 'Sacrifice a unicorn, then draw two cards.',
        copies: 2
    },
    {
        id: 'bounce',
        name: 'Bounce',
        kind: 'magic',
        text: 'Return a unicorn to its owner\'s hand.',
        copies: 2
    },
    {
        id: 'kidnap',
        name: 'Kidnap',
        kind: 'magic',
        text: 'Move another player\'s unicorn into your stable.',
        copies: 2
    },
    {
        id: 'foretell',
        name: 'Foretell',
        kind: 'magic',
        text: 'Draw two cards, then put a card from your hand on top of the deck.',
        copies: 2
    },
    {
        id: 'raid',
        name: 'Raid',
        kind: 'magic',
        text: 'Steal a random card from another player\'s hand.',
        copies: 2
    },
    {
        id: 'peek',
        name: 'Peek',
        kind: 'magic',
        text: 'Look at the top three cards of the deck and steal one.',
        copies: 2
    },
    {
        id: 'barter',
        name: 'Barter',
        kind: 'magic',
        text: 'Trade one of your unicorns for another player\'s unicorn.',
        copies: 2
    },
    {
        id: 'bury',
        name: 'Bury',
        kind: 'magic',
        text: 'Shuffle a card from your hand into the deck.',
        copies: 2
    },
    { id: 'yawn', name: 'Yawn', kind: 'magic', text: 'End your turn now.', copies: 2 },
    {
        id: 'settle',
        name: 'Settle',
        kind: 'magic',
        text: 'Move a card from your hand into your stable.',
        copies: 2
    },
    { id: 'nope', name: 'Nope', kind: 'instant', text: 'Neigh a play.', copies: 6 },
    {
        id: 'supernope',
        name: 'Super Nope',
        kind: 'instant',
        text: 'Neigh a play and cannot be neighed.',
        copies: 1
    },

    {
        id: 'armor',
        name: 'Armor',
        kind: 'upgrade',
        text: 'Your unicorns cannot be destroyed.',
        copies: 3
    },
    {
        id: 'pandamaker',
        name: 'Panda Maker',
        kind: 'upgrade',
        text: 'Your winged cards are special unicorns.',
        copies: 2
    },
    {
        id: 'rock',
        name: 'Cursed Rock',
        kind: 'downgrade',
        text: 'You get one action fewer each turn.',
        copies: 3
    },
    {
        id: 'freeloader',
        name: 'Freeloader',
        kind: 'downgrade',
        text: 'When this would be destroyed, discard a card instead.',
        copies: 3
    },
    {
        id: 'lockdown',
        name: 'Lockdown',
        kind: 'upgrade',
        text: 'Magic cards cannot be played.',
        copies: 2
    },
    {
        id: 'mirror',
        name: 'Mirror',
        kind: 'upgrade',
        text: 'Your hand is visible.',
        copies: 2
    }
];
