import { RANKS, SUITS, resolveCard, valueText } from '../variants/schema.js';
import { SUIT_SYMBOL_MAP } from '../../../bullshit/js/game/card-data.js';
import type { Variant, ResolvedDef } from '../variants/schema.js';
export function pill(def: ResolvedDef): string {
    return `${valueText(def.value)} ${(def.effects ?? []).map(effect =>
        ({ reverse: '↺', skip: '⏭', chooseNext: 'Choose', steal: 'Steal' })[effect.type]).join(' ')}`.trim();
}
export function variantTable(ruleset: Variant): HTMLElement {
    const section = document.createElement('section');
    const summary = document.createElement('p');
    summary.textContent = `${ruleset.rules.handSize} cards per hand · ${ruleset.rules.jokers} jokers · Floor ${ruleset.rules.floor}`;
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const text of ['Rank', 'Value', 'Effect']) {
        const th = document.createElement('th');
        th.scope = 'col'; th.textContent = text; head.append(th);
    }
    const body = table.createTBody();
    for (const rank of RANKS.filter(entry => entry !== 'JOKER' || ruleset.rules.jokers > 0)) {
        const groups = new Map<string, { def: ResolvedDef; suits: Array<string> }>();
        for (const suit of SUITS) {
            const def = resolveCard(ruleset, { rank, suit });
            const entry = groups.get(def.id) ?? { def, suits: [] };
            entry.suits.push(SUIT_SYMBOL_MAP[suit]); groups.set(def.id, entry);
        }
        for (const { def, suits } of groups.values()) {
            const row = body.insertRow();
            for (const text of [rank + (groups.size > 1 ? ` ${suits.join('')}` : ''), valueText(def.value),
                (def.effects ?? []).map(effect => effect.type).join(', ') || def.label]) row.insertCell().textContent = text;
        }
    }
    const special = document.createElement('p');
    if (ruleset.tier === 'B') special.textContent = ruleset.id === 'baltimore'
        ? 'Special rules: combine any two kings/queens for +10 and draw two. A stolen card is extra; its owner draws a replacement. A 7 copies the previous resolved value and powers (0 when first).'
        : 'Special rules: the ace of spades resets to 0. A five chooses the next opponent. Queens add or subtract 20.';
    section.append(summary, table, special);
    return section;
}
