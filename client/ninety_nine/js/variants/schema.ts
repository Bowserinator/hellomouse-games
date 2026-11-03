export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'JOKER'] as const;
export const SUITS = ['Clubs', 'Diamonds', 'Hearts', 'Spades'] as const;
export type Rank = typeof RANKS[number];
export type Suit = typeof SUITS[number];
export type ValueDef = { type: 'add'; n: number } | { type: 'choice'; options: Array<number> } |
{ type: 'set'; total: number } | { type: 'copy' };
export type EffectDef = { type: 'reverse' } | { type: 'skip'; count?: number } |
{ type: 'chooseNext' } | { type: 'steal' };
export interface CardDef {
    id: string;
    label: string;
    match: { ranks: Array<Rank>; suits?: Array<Suit> };
    value: ValueDef;
    effects?: Array<EffectDef>;
}
export interface VariantRules {
    handSize: number;
    totalLimit: number;
    floor: number;
    jokers: number;
    twoPlayerExtraTurn: boolean;
    stuck: 'loseHand';
    combine?: Array<{ ranks: Array<Rank>; size: number; value: number; draw: number }>;
}
export interface Variant {
    id: string;
    name: string;
    description: string;
    tier: 'A' | 'B' | 'C';
    rules: VariantRules;
    cards: Array<CardDef>;
}
export interface PhysicalCard {
    rank: Rank; suit: Suit;
}
export type ResolvedDef = CardDef;
export const BASE_RULES: VariantRules = {
    handSize: 3, totalLimit: 99, floor: 0, jokers: 0, twoPlayerExtraTurn: true, stuck: 'loseHand'
};
export function valueText(value: ValueDef): string {
    if (value.type === 'set') return `→${value.total}`;
    if (value.type === 'copy') return 'Copy previous';
    const signed = (n: number): string => n > 0 ? `+${n}` : String(n);
    return value.type === 'add' ? signed(value.n) : value.options.map(signed).join(' / ');
}
function definition(ranks: Array<Rank>, value: ValueDef, label?: string, effects?: Array<EffectDef>): CardDef {
    return { id: ranks.join('-'), match: { ranks }, value, label: label ?? valueText(value), effects };
}
export const add = (ranks: Array<Rank>, n: number, label?: string, effects?: Array<EffectDef>): CardDef =>
    definition(ranks, { type: 'add', n }, label, effects);
export const choice = (ranks: Array<Rank>, options: Array<number>, label?: string,
    effects?: Array<EffectDef>): CardDef =>
    definition(ranks, { type: 'choice', options }, label, effects);
export const setTotal = (ranks: Array<Rank>, total: number, label?: string, effects?: Array<EffectDef>): CardDef =>
    definition(ranks, { type: 'set', total }, label, effects);
export const copyLast = (ranks: Array<Rank>, label = 'Copy the previous value and powers'): CardDef =>
    definition(ranks, { type: 'copy' }, label);
export function suited(def: CardDef, suits: Array<Suit>): CardDef {
    return { ...def, id: `${def.id}-${suits.join('-')}`, match: { ...def.match, suits } };
}
export function variant(id: string, name: string, description: string, tier: Variant['tier'],
    rules: Partial<VariantRules>, cards: Array<CardDef>): Variant {
    return { id, name, description, tier, rules: { ...BASE_RULES, ...rules }, cards };
}
export function resolveCard(ruleset: Variant, card: PhysicalCard): ResolvedDef {
    const def = ruleset.cards.find(entry => entry.match.ranks.includes(card.rank) &&
        (!entry.match.suits || entry.match.suits.includes(card.suit)));
    if (def) return def;
    if (/^[2-8]$/.test(card.rank)) return add([card.rank], Number(card.rank));
    throw new Error(`${ruleset.id}: Missing definition for ${card.rank} of ${card.suit}`);
}
export function validateVariant(ruleset: Variant, effects: ReadonlyArray<string>): void {
    const fail = (text: string): never => {
        throw new Error(`${ruleset.id}: ${text}`);
    };
    const ids = new Set<string>();
    for (const def of ruleset.cards) {
        if (!def.id || ids.has(def.id)) fail(`Duplicate or empty card id: ${def.id}`);
        ids.add(def.id);
        if (!def.match.ranks.length || def.match.ranks.some(rank => !RANKS.includes(rank))) fail('Invalid ranks');
        if (def.match.suits && (!def.match.suits.length || def.match.suits.some(suit => !SUITS.includes(suit)))) fail('Invalid suits');
        const v = def.value;
        if (v.type === 'choice' && (!v.options.length || v.options.some(n => !Number.isFinite(n)))) fail('Empty or invalid choice');
        if (v.type === 'add' && !Number.isFinite(v.n)) fail('Invalid add value');
        if (v.type === 'set' && (!Number.isFinite(v.total) || v.total > ruleset.rules.totalLimit || v.total < ruleset.rules.floor)) fail('Invalid set total');
        if (!['add', 'choice', 'set', 'copy'].includes(v.type)) fail('Unknown value type');
        for (const effect of def.effects ?? []) {
            if (!effects.includes(effect.type)) fail(`Unknown effect: ${effect.type}`);
            if (effect.type === 'skip' && effect.count !== undefined && (!Number.isInteger(effect.count) || effect.count < 1)) fail('Invalid skip count');
        }
    }
    if (!Number.isInteger(ruleset.rules.handSize) || ruleset.rules.handSize < 1 ||
        !Number.isInteger(ruleset.rules.jokers) || ruleset.rules.jokers < 0 ||
        !Number.isFinite(ruleset.rules.floor) || ruleset.rules.floor > ruleset.rules.totalLimit) fail('Invalid rules');
    for (const rank of RANKS.filter(entry => entry !== 'JOKER' || ruleset.rules.jokers > 0))
        for (const suit of SUITS) resolveCard(ruleset, { rank, suit });
}
