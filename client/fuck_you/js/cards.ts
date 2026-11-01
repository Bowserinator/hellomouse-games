export const COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type Color = typeof COLORS[number];
export type Effect =
    | { op: 'number'; value: number }
    | { op: 'draw'; count: number }
    | { op: 'reverse' | 'skip' | 'wild' | 'reveal' | 'swap' | 'duel' | 'lightning' | 'gift' |
    'god' | 'force' | 'burglar' | 'philanthropist' | 'bottle' | 'chain' | 'sacrifice' | 'allergy' | 'bomb'; };
export interface CardDef {
    id: string;
    name: string;
    color: Color | null;
    effect: Effect;
    text: string;
    copies: number;
    source: { page: number; cell: number };
}

export const CARDS: Array<CardDef> = [];
for (const [color, page] of [['blue', 5], ['red', 8], ['yellow', 11], ['green', 14]] as const) {
    for (let value = 0; value <= 9; value++) CARDS.push({
        id: `${color}-${value}`, name: `${color} ${value}`, color, effect: { op: 'number', value },
        text: `Match ${color} or ${value}.`, copies: 2,
        source: { page: value === 9 ? page + 2 : page, cell: value === 9 ? 0 : value }
    });
    for (const [index, op, name, text, copies] of [
        [2, 'reverse', 'Reverse', 'Reverse the game flow.', 1],
        [3, 'skip', 'Skip', 'Skip the next player.', 2],
        [5, 'draw', 'Draw two', 'The next player draws 2 cards and misses their turn.', 2],
        [7, 'allergy', 'Color Allergy', 'Return all cards of this color from your hand to the deck and shuffle.', 1],
        [8, 'bomb', 'Bomb', 'The player with the fewest cards draws until they get a blue card.', 1]
    ] as const) CARDS.push({
        id: `${color}-${op}`, name: `${color} ${name}`, color,
        effect: op === 'draw' ? { op, count: 2 } : { op }, text, copies,
        source: { page: page + 2, cell: index }
    });
}
CARDS.push(
    { id: 'draw-four', name: 'Draw four', color: null, effect: { op: 'draw', count: 4 }, copies: 3,
        text: 'Choose a color. The next player draws 4 cards and misses their turn. Only legal without a card of the active color.', source: { page: 3, cell: 0 } },
    { id: 'wild', name: 'Wild', color: null, effect: { op: 'wild' }, copies: 3,
        text: 'Change the color to what you want.', source: { page: 3, cell: 3 } }
);
for (const [index, id, name, op, text] of [
    [0, 'eye-of-sauron', 'Eye of Sauron', 'reveal', 'The next player turns their cards around so everyone can see them.'],
    [1, 'hand-swap', 'Hand Swap', 'swap', 'Swap hands with a player of your choice.'],
    [2, 'rock-paper-scissors', 'Rock, Paper, Scissors', 'duel', 'Duel the previous player. Best of 3 rounds. The loser takes 6 cards.'],
    [3, 'lightning-bolt', 'Lightning Bolt', 'lightning', 'Play 2 more cards regardless of whether they match and call the new color from the placed cards.'],
    [4, 'unexpected-gift', 'Unexpected Gift', 'gift', 'Give 3 cards to another player. You must have at least 2 cards remaining.'],
    [5, 'god-hand', 'God Hand', 'god', 'Merge your hand with the deck and draw only 2 cards.'],
    [6, 'force-update', 'Force Update', 'force', 'The next player must play a special card. If they have none, keep drawing until they get one and play it.'],
    [7, 'burglar', 'Burglar', 'burglar', 'Steal one card from every player.'],
    [8, 'philanthropist', 'Philanthropist', 'philanthropist', 'Randomly give one card to every other player. You must have at least 2 cards remaining.'],
    [9, 'spin-the-bottle', 'Spin the Bottle', 'bottle', 'A random other player draws 6 cards. The player who used this card is immune.'],
    [10, 'chain-reaction', 'Chain Reaction', 'chain', 'The next player draws 4 cards, the second draws 2, the third draws 1.'],
    [11, 'sacrifice', 'Sacrifice', 'sacrifice', 'Draw 1 card for each player. Every other player draws 1. You win if this is your last card.']
] as const) CARDS.push({
    id, name, color: null, effect: { op }, text, copies: 1,
    source: index < 3 ? { page: 3, cell: index + 6 } : { page: 4, cell: index - 3 }
});
export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(CARDS.map(card => [card.id, card]));
export const BACK = 'images/cards/back.png';
export function image(id: string): string {
    return `images/cards/${id}.png`;
}
