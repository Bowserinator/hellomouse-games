import { cardName } from './card.js';
import type { Place } from '../engine/dsl/ast.js';
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

export function isPlayEvent(event: LoggedEvent): boolean {
    return event.type === 'play' && (event.publicDefId !== undefined || !event.from || !event.to);
}

function placeName(place: Place, names: Array<string | null>): string {
    if (place.zone === 'hand' || place.zone === 'stable')
        return `${seatName(names, place.owner)}\u2019s ${place.zone}`;
    if (place.zone === 'discard') return 'the discard pile';
    if (place.zone === 'limbo') return 'the revealed cards';
    return `the ${place.zone}`;
}

function describeTransfer(event: LoggedEvent, card: string, names: Array<string | null>): string {
    const from = event.from as Place;
    const to = event.to as Place;
    const who = seatName(names, event.by ?? to.owner ?? event.player);
    const elsewhere = from.owner !== undefined && from.owner !== to.owner;

    if (to.zone === 'hand')
        return `${who} ${elsewhere ? 'stole' : 'took'} ${card} from ${placeName(from, names)}`;
    if (to.zone === 'stable')
        return elsewhere && (event.by === undefined || event.by === to.owner)
            ? `${who} stole ${card} from ${placeName(from, names)}`
            : `${who} moved ${card} from ${placeName(from, names)} to ${placeName(to, names)}`;
    return `${who} put ${card} into ${placeName(to, names)}`;
}

const FIZZLE_REASONS: Record<string, string | [own: string, other: string]> = {
    hand: ['you have no valid card in your hand', 'they have no valid card in their hand'],
    stable: ['you have no valid card in your stable', 'they have no valid card in their stable'],
    otherHand: 'no other player has a valid card in their hand',
    otherStable: 'no other player has a valid card in their stable',
    deck: 'the deck has no matching card',
    discard: 'the discard pile has no matching card',
    target: 'there is no valid target'
};

export function fizzleReason(event: LoggedEvent, own: boolean): string {
    const reason = FIZZLE_REASONS[event.cause ?? ''] ?? FIZZLE_REASONS.target;
    return typeof reason === 'string' ? reason : reason[own ? 0 : 1];
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

    if (event.type === 'fizzle') {
        const source = event.card === undefined ? undefined : faces[event.card]?.defId;
        const subject = source ? `${who}\u2019s ${cardName(source)}` : `${who}\u2019s effect`;
        return `${subject} could not be applied because ${fizzleReason(event, false)}`;
    }

    const verb = VERBS[event.type];
    if (!verb || !event.card) return '';

    const defId = (event.type === 'play' ? event.publicDefId : undefined) ?? faces[event.card]?.defId;
    const card = defId ? cardName(defId) : 'a card';
    if (event.type === 'play' && !isPlayEvent(event)) return describeTransfer(event, card, names);
    return `${who} ${verb} ${card}${playTarget(event, names)}`;
}
