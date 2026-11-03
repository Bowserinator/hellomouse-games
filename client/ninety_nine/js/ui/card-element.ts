import { GET_SYMBOL as getSymbol, RED_SUITS, SUIT_SYMBOL_MAP, SUIT_POSITIONS } from '../../../bullshit/js/game/card-data.js';
import type { CardView } from '../types.js';

function buildSuitPattern(value: number, suit: string): HTMLDivElement {
    const pattern = SUIT_POSITIONS[value - 1];
    const container = document.createElement('div');
    container.className = 'suit-pattern-container';
    const [xOffset, yOffset] = pattern.length <= 8 ? [20, 19] : [20, 28];
    for (const pos of pattern) {
        const symbol = document.createElement('div');
        symbol.className = `suit-pattern-symbol${value > 10 ? ' face-symbol' : ''}`;
        symbol.style.top = `${50 + pos[1] * yOffset}%`;
        symbol.style.left = `${50 + pos[0] * xOffset}%`;
        symbol.style.transform = pos[2] ? 'rotate(180deg)' : 'none';
        symbol.textContent = value > 10 ? getSymbol(value) : SUIT_SYMBOL_MAP[suit];
        container.append(symbol);
    }
    return container;
}
export function createCardElement(card: CardView, back = false): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'card';
    if (back || !card.rank || !card.suit) {
        div.classList.add('back');
        div.setAttribute('aria-label', 'Hidden card');
        return div;
    }
    div.classList.add('front');
    if (RED_SUITS.includes(card.suit)) div.classList.add('red');
    div.setAttribute('aria-label', `${card.rank} of ${card.suit}`);
    if (card.rank === 'JOKER') {
        div.textContent = '★ JOKER ★';
        div.classList.add('joker');
        return div;
    }
    const value = card.rank === 'A' ? 1 : card.rank === 'J' ? 11 : card.rank === 'Q' ? 12
        : card.rank === 'K' ? 13 : Number(card.rank);
    for (const className of ['num_top_left', 'num_bot_right']) {
        const index = document.createElement('div');
        index.className = className;
        index.append(document.createTextNode(getSymbol(value)), document.createElement('br'),
            document.createTextNode(SUIT_SYMBOL_MAP[card.suit]));
        div.append(index);
    }
    div.append(buildSuitPattern(value, card.suit));
    return div;
}
