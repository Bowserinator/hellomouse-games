import { DEFAULT_PACK, PACKS } from '../catalog/index.js';
import { BASE_DEFS } from '../engine/cards/index.js';
import { unicornCount } from '../engine/query/modifiers.js';
import { createCard, emptyState } from '../engine/state.js';
import { winTarget } from '../vars.js';
import type { CardView, ViewModel } from '../engine/view.js';
import type { Zone } from '../engine/state.js';

const PACK = PACKS[DEFAULT_PACK].cards;
const DEFS = new Map(BASE_DEFS.map(def => [def.id, def] as const));

function defIdFor(kind: string, index: number): string {
    const matches = PACK.filter(entry => entry.kind === kind);
    return matches[index % matches.length].id;
}

export function mockHandDefaults(): Array<string> {
    return [defIdFor('magic', 1), defIdFor('instant', 0), defIdFor('basic', 3), defIdFor('instant', 1)];
}

export function mockView(playerCount: number, seat = 0, handDefIds?: Array<string>): ViewModel {
    const cards: Record<string, CardView> = {};
    const seats = Math.min(Math.max(playerCount, 3), 8);
    const state = emptyState(seats, winTarget(seats));
    const world = { state, defOf: (iid: string) => DEFS.get(state.cards[iid]?.defId ?? '') };
    let counter = 0;

    const add = (defId: string, owner: number, zone: Zone): string => {
        const iid = `mock${counter++}`;
        cards[iid] = { defId, owner, zone, revealed: true, neighable: PACK.find(entry => entry.id === defId)?.kind === 'instant' };
        createCard(state, iid, defId, owner, zone);
        return iid;
    };
    const players = [];
    for (let index = 0; index < seats; index++) {
        const stable = [
            add(defIdFor('baby', 0), index, 'stable'),
            add(defIdFor('basic', index), index, 'stable'),
            add(defIdFor('basic', index + 1), index, 'stable'),
            add(defIdFor('upgrade', index), index, 'stable'),
            add(defIdFor('downgrade', index), index, 'stable')
        ];
        const hasNannyCam = stable.some(iid => cards[iid]?.defId === 'nanny-cam');
        const hand = index === seat
            ? (handDefIds ?? mockHandDefaults()).map(defId => add(defId, index, 'hand'))
            : Array.from({ length: 5 }, (_, offset) => add(defIdFor('basic', offset), index, 'hand'));
        players.push({
            id: index,
            handCount: hand.length,
            hand: index === seat || hasNannyCam ? [...hand] : null,
            stable,
            babyChosen: true,
            unicorns: unicornCount(world, index)
        });
    }

    const discard = [add(defIdFor('magic', 4), 1, 'discard'), add(defIdFor('basic', 5), 2, 'discard')];
    const nursery = [add(defIdFor('baby', 1), -1, 'nursery'), add(defIdFor('baby', 2), -1, 'nursery')];
    const chainCard = add(defIdFor('magic', 2), 1, 'discard');

    return {
        seat,
        phase: 'ACTION',
        turn: { player: seat, actionsUsed: 0, actionsLeft: 1, drawsUsed: 0, drawsLeft: 1 },
        winTarget: state.winTarget,
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
