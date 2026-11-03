import {
    GET_SYMBOL as getSymbol, RED_SUITS, SUIT_SYMBOL_MAP, SUIT_POSITIONS
} from '../../../bullshit/js/game/card-data.js';
import { cardName } from '../cards.js';
import type { CardView } from '../types.js';

function buildSuitPattern(value: number, suit: string): HTMLDivElement {
    const container = document.createElement('div'); container.className = 'suit-pattern-container';
    const pattern = SUIT_POSITIONS[value - 1];
    const [xOffset, yOffset] = pattern.length <= 8 ? [20, 19] : [20, 28];
    for (const pos of pattern) {
        const symbol = document.createElement('div'); symbol.className = 'suit-pattern-symbol';
        symbol.style.top = `${50 + pos[1] * yOffset}%`; symbol.style.left = `${50 + pos[0] * xOffset}%`;
        symbol.style.transform = `translate(-50%, -50%)${pos[2] ? ' rotate(180deg)' : ''}`;
        symbol.textContent = SUIT_SYMBOL_MAP[suit]; container.append(symbol);
    }
    return container;
}
export function createCardElement(card: CardView): HTMLDivElement {
    const div = document.createElement('div'); div.className = 'card'; div.dataset.iid = card.iid;
    div.setAttribute('aria-label', cardName(card));
    if (card.value === null) {
        div.classList.add('back'); return div;
    }
    div.classList.add('front');
    if (card.joker) {
        div.classList.add('joker'); return div;
    }
    const suit = card.suit ?? 'Clubs';
    div.classList.toggle('red', RED_SUITS.includes(suit));
    for (const corner of ['num_top_left', 'num_bot_right']) {
        const cornerLabel = document.createElement('span'); cornerLabel.className = corner;
        cornerLabel.append(getSymbol(card.value), document.createElement('br'), SUIT_SYMBOL_MAP[suit]);
        div.append(cornerLabel);
    }
    div.append(buildSuitPattern(card.value, suit)); return div;
}
export function label(jp: string, en: string): HTMLSpanElement {
    const node = document.createElement('span'); node.className = 'label';
    const japanese = document.createElement('b'); japanese.lang = 'ja'; japanese.textContent = jp;
    const english = document.createElement('small'); english.textContent = en;
    node.append(japanese, english); return node;
}
