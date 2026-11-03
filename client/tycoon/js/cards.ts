import Deck from '../../bullshit/js/game/deck.js';
import { GET_SYMBOL as getSymbol, SUIT_SYMBOL_MAP } from '../../bullshit/js/game/card-data.js';
import type { CardView, Suit, TCard, Title } from './types.js';

export const TITLE_LABELS: Record<Title, { jp: string; en: string }> = {
    tycoon: { jp: '大富豪', en: 'TYCOON' }, rich: { jp: '富豪', en: 'RICH MAN' },
    poor: { jp: '貧民', en: 'POOR MAN' }, beggar: { jp: '大貧民', en: 'BEGGAR' }
};
export const TERM_LABELS = {
    revolution: { jp: '革命', en: 'REVOLUTION' }, counter: { jp: '革命返し', en: 'COUNTER-REVOLUTION' },
    bankruptcy: { jp: '都落ち', en: 'BANKRUPTCY' }, pass: { jp: 'パス', en: 'PASS' },
    lucky: { jp: 'ラッキーセブン', en: 'LUCKY SEVEN' }
};
export const TITLES: Array<Title> = ['tycoon', 'rich', 'poor', 'beggar'];
export function strength(card: CardView): number {
    return card.joker ? 13 : card.value === 1 ? 12 : (card.value ?? 2) - 2;
}
export function cardName(card: CardView): string {
    return card.value === null ? 'Hidden card' : card.joker ? 'Joker' : `${getSymbol(card.value)}${SUIT_SYMBOL_MAP[card.suit ?? '']}`;
}
export function makeDeck(jokers: boolean, rng: () => number): Array<TCard> {
    const cards: Array<TCard> = Deck.generateDefaultDeck().cards.map(c => ({
        iid: '', value: c.value, suit: c.suit as Suit, joker: false
    }));
    if (jokers) for (let i = 0; i < 2; i++) cards.push({ iid: '', value: 0, suit: null, joker: true });
    // Assign identities after shuffling so a hidden card's ID cannot identify its rank.
    const shuffled = shuffle(cards, rng);
    return shuffled.map((c, i) => ({ ...c, iid: `c${i}` }));
}
export function shuffle<T>(cards: Array<T>, rng: () => number): Array<T> {
    const result = [...cards];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
