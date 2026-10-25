import type { CardDef } from './dsl/ast.js';
import type { Iid } from './ids.js';
import type { CardInstance, GameState, Zone } from './state.js';
import { WILDCARD } from '../vars.js';

const PUBLIC_ZONES: Array<Zone> = ['stable', 'discard', 'nursery', 'limbo'];

export function wildcardDef(): CardDef {
    return { id: WILDCARD, kind: 'magic' };
}

export function isPublicZone(zone: Zone): boolean {
    return PUBLIC_ZONES.includes(zone);
}

export function visibleTo(state: GameState, iid: Iid, seat: number): boolean {
    const card: CardInstance | undefined = state.cards[iid];
    if (!card) return false;
    if (isPublicZone(card.zone)) return true;
    if (card.zone === 'hand' && card.owner === seat) return true;
    return card.revealedTo.includes(seat);
}

export function viewFor(state: GameState, seat: number): GameState {
    const view: GameState = structuredClone(state);
    for (const iid of Object.keys(view.cards))
        if (!visibleTo(state, iid, seat)) view.cards[iid].defId = WILDCARD;
    if (view.prompt && view.prompt.player !== seat) view.prompt = null;
    return view;
}

export function stateFromView(view: GameState): GameState {
    return structuredClone(view);
}

export function viewDefOf(catalog: Record<string, CardDef>, view: GameState) {
    return (iid: Iid): CardDef | undefined => {
        const card = view.cards[iid];
        if (!card) return undefined;
        return catalog[card.defId] ?? wildcardDef();
    };
}

export interface CardView {
    defId: string;
    owner: number;
    zone: Zone;
    revealed: boolean;
    neighable: boolean;
    inertAt?: Array<number>;
}

export interface PromptView {
    id: number;
    player: number;
    kind: string;
    reason: string;
    source: Iid | null;
    cards: Array<Iid>;
    players: Array<number>;
    min: number;
    max: number;
}

export interface ChainView {
    top: { id: number; card: Iid; by: number; kind: 'play' | 'neigh' } | null;
    canNeigh: boolean;
}

export interface PlayerView {
    id: number;
    handCount: number;
    hand: Array<Iid> | null;
    stable: Array<Iid>;
    babyChosen: boolean;
    unicorns: number;
}

export interface ViewModel {
    seat: number;
    phase: string;
    turn: { player: number; actionsUsed: number; actionsLeft: number; drawsUsed: number; drawsLeft: number };
    winTarget: number;
    winner: number | null;
    winReason: string | null;
    over: boolean;
    pendingWinner: number | null;
    players: Array<PlayerView>;
    cards: Record<Iid, CardView>;
    deckCount: number;
    discard: Array<Iid>;
    nursery: Array<Iid>;
    handLimit: number;
    prompt: PromptView | null;
    promptOpen: boolean;
    waitingOn: Array<number>;
    chain: ChainView;
    playable: Array<Iid>;
    needsTarget: Array<Iid>;
    blockers: Record<Iid, string>;
    targets: Record<Iid, Array<number>>;
    futile: Record<Iid, boolean>;
}

function faceUp(view: GameState, seat: number, iid: Iid, handShown: (owner: number) => boolean): boolean {
    const card = view.cards[iid];
    if (!card) return false;
    if (isPublicZone(card.zone) || card.owner === seat || card.revealedTo.includes(seat)) return true;
    return card.zone === 'hand' && handShown(card.owner);
}

export function viewModel(
    state: GameState,
    seat: number,
    playable: Array<Iid>,
    chain: ChainView,
    needsTarget: Array<Iid>,
    handVisible: (owner: number) => boolean,
    actionsLeft: number,
    drawsLeft: number,
    handLimit: number,
    unicornCounts: Array<number> = [],
    neighable: (iid: Iid) => boolean = () => false,
    blockers: Record<Iid, string> = {},
    targets: Record<Iid, Array<number>> = {},
    inert: Record<Iid, Array<number>> = {},
    futile: Record<Iid, boolean> = {}
): ViewModel {
    const cards: Record<Iid, CardView> = {};
    const handShown = (owner: number) => owner === seat || handVisible(owner);
    const remember = (iid: Iid) => {
        const card = state.cards[iid];
        if (!card) return;
        const view: CardView = {
            defId: faceUp(state, seat, iid, handShown) ? card.defId : WILDCARD,
            owner: card.owner,
            zone: card.zone,
            revealed: card.revealedTo.includes(seat),
            neighable: neighable(iid)
        };
        if (inert[iid]) view.inertAt = [...inert[iid]];
        cards[iid] = view;
    };

    const players = state.players.map(player => {
        for (const iid of player.stable) remember(iid);
        const shown = handShown(player.id);
        if (shown) for (const iid of player.hand) remember(iid);
        else for (const iid of player.hand) if (state.cards[iid].revealedTo.includes(seat)) remember(iid);
        return {
            id: player.id,
            handCount: player.hand.length,
            hand: shown ? [...player.hand] : null,
            stable: [...player.stable],
            babyChosen: player.babyChosen,
            unicorns: unicornCounts[player.id] ?? 0
        };
    });

    for (const iid of state.discard) remember(iid);
    for (const iid of state.nursery) remember(iid);
    for (const iid of state.limbo) remember(iid);

    const prompt = state.prompt && state.prompt.player === seat
        ? {
            id: state.prompt.id,
            player: state.prompt.player,
            kind: state.prompt.kind,
            reason: state.prompt.reason,
            source: state.prompt.source,
            cards: [...state.prompt.cards],
            players: [...state.prompt.players],
            min: state.prompt.min,
            max: state.prompt.max
        }
        : null;
    if (prompt) for (const iid of prompt.cards) remember(iid);

    return {
        seat,
        phase: state.phase,
        turn: {
            player: state.turn.player,
            actionsUsed: state.turn.actionsUsed,
            actionsLeft,
            drawsUsed: state.turn.drawsUsed,
            drawsLeft
        },
        winTarget: state.winTarget,
        winner: state.winner,
        winReason: state.winReason,
        over: state.phase === 'OVER',
        pendingWinner: state.pendingWinner,
        players,
        cards,
        deckCount: state.deck.length,
        discard: [...state.discard],
        nursery: [...state.nursery],
        handLimit,
        prompt,
        promptOpen: state.prompt !== null,
        waitingOn: state.phase === 'OVER' || state.winner !== null ? [] : [state.prompt ? state.prompt.player : state.turn.player],
        chain,
        playable,
        needsTarget,
        blockers,
        targets,
        futile
    };
}
