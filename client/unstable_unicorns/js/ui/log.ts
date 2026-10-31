import { cardName } from './card.js';
import type { LoggedEvent } from '../engine/events.js';
import type { CardView } from '../engine/view.js';

const VERBS: Record<string, string> = {
    play: 'played',
    destroy: 'destroyed',
    sacrifice: 'sacrificed',
    discard: 'discarded',
    return: 'returned'
};

export function seatName(names: Array<string | null>, seat: number | undefined): string {
    return seat === undefined ? 'Someone' : names[seat] ?? `Seat ${seat + 1}`;
}

export function playTarget(event: LoggedEvent, names: Array<string | null>): string {
    const target = event.targetPlayer;
    return event.type === 'play' && target !== undefined && target !== event.player
        ? ` on ${seatName(names, target)}` : '';
}

export function describeEvent(
    event: LoggedEvent,
    faces: Record<string, CardView>,
    names: Array<string | null>
): string {
    const who = seatName(names, event.player);

    if (event.type === 'neigh') return `${who} neighed`;
    if (event.type === 'cancel') return `${who} canceled an action`;
    if (event.type === 'draw') return `${who} drew a card`;
    if (event.type === 'turnStart') return `${who} started their turn`;
    if (event.type === 'deckOut')
        return event.player === undefined
            ? 'The deck ran out and it is a perfect tie. Everyone loses.'
            : `The deck ran out. ${who} wins`;

    const verb = VERBS[event.type];
    if (!verb || !event.card) return '';

    const defId = (event.type === 'play' ? event.publicDefId : undefined) ?? faces[event.card]?.defId;
    return `${who} ${verb} ${defId ? cardName(defId) : 'a card'}${playTarget(event, names)}`;
}
