import type { StatusCard } from './types.js';

export const MONEY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 25];
export const COLORS = ['gold', 'crimson', 'emerald', 'sapphire', 'amethyst'];
export function createDeck(): Array<StatusCard> {
    return [
        ...Array.from({ length: 10 }, (_, i): StatusCard => ({
            id: `luxury-${String(i + 1).padStart(2, '0')}`, kind: 'luxury', value: i + 1,
            label: `Luxury ${i + 1}`, end: false
        })),
        ...Array.from({ length: 3 }, (_, i): StatusCard => ({
            id: `prestige-${i + 1}`, kind: 'prestige', value: 2, label: 'Prestige ×2', end: true
        })),
        { id: 'faux-pas', kind: 'faux-pas', value: 0, label: 'Faux Pas', end: false },
        { id: 'passe', kind: 'passe', value: -5, label: 'Passé −5', end: false },
        { id: 'scandale', kind: 'scandale', value: 0, label: 'Scandale ÷2', end: true }
    ];
}
