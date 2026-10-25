import { DEFAULT_PACK, PACKS } from '../catalog/index.js';
import { winTarget } from '../vars.js';
import type { CardView, ViewModel } from '../engine/view.js';
import type { Zone } from '../engine/state.js';

const PACK = PACKS[DEFAULT_PACK];

function defIdFor(kind: string, index: number): string {
    const matches = PACK.filter(entry => entry.kind === kind);
    return matches[index % matches.length].id;
}

export function mockHandDefaults(): Array<string> {
    return [defIdFor('magic', 1), 'nope', defIdFor('basic', 3), 'nope'];
}

export function mockView(playerCount: number, seat = 0, handDefIds?: Array<string>): ViewModel {
    const cards: Record<string, CardView> = {};
    let counter = 0;

    const add = (defId: string, owner: number, zone: Zone): string => {
        const iid = `mock${counter++}`;
        cards[iid] = { defId, owner, zone, revealed: true, neighable: defId === 'nope' || defId === 'supernope' };
        return iid;
    };

    const seats = Math.min(Math.max(playerCount, 3), 8);
    const players = [];
    for (let index = 0; index < seats; index++) {
        const stable = [
            add(defIdFor('baby', 0), index, 'stable'),
            add(defIdFor('basic', index), index, 'stable'),
            add(defIdFor('basic', index + 1), index, 'stable'),
            add(defIdFor('upgrade', index), index, 'stable'),
            add(defIdFor('downgrade', index), index, 'stable')
        ];
        const hand = index === seat
            ? (handDefIds ?? mockHandDefaults()).map(defId => add(defId, index, 'hand'))
            : Array.from({ length: 5 }, (_, offset) => add(defIdFor('basic', offset), index, 'hand'));
        players.push({
            id: index,
            handCount: hand.length,
            hand: index === seat ? [...hand] : null,
            stable,
            babyChosen: true,
            unicorns: 2 + (index % 3)
        });
    }

    const discard = [add(defIdFor('magic', 4), 1, 'discard'), add(defIdFor('basic', 5), 2, 'discard')];
    const nursery = [add(defIdFor('baby', 1), -1, 'nursery'), add(defIdFor('baby', 2), -1, 'nursery')];
    const chainCard = add(defIdFor('magic', 2), 1, 'discard');

    return {
        seat,
        phase: 'ACTION',
        turn: { player: seat, actionsUsed: 0, actionsLeft: 1, drawsUsed: 0, drawsLeft: 1 },
        winTarget: winTarget(seats),
        winner: null,
        winReason: null,
        over: false,
        pendingWinner: null,
        players,
        cards,
        deckCount: 42,
        discard,
        nursery,
        handLimit: 7,
        prompt: null,
        promptOpen: false,
        waitingOn: [seat],
        chain: {
            top: { id: 17, card: chainCard, by: 1, kind: 'play' },
            canNeigh: true
        },
        playable: players[seat].hand ?? [],
        needsTarget: [],
        blockers: {},
        targets: {},
        futile: {}
    };
}
