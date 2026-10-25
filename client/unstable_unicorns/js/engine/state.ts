import type { Iid } from './ids.js';

export type Zone = 'hand' | 'stable' | 'deck' | 'discard' | 'nursery' | 'limbo';

export type Phase =
    | 'LOBBY'
    | 'PICK_BABY'
    | 'AWAIT_BEGIN'
    | 'TURN_START'
    | 'ACTION'
    | 'TURN_END'
    | 'DISCARD_LIMIT'
    | 'OVER';

export type Binding = Array<Iid> | Array<number> | number | string | boolean;
export type Bindings = Record<string, Binding>;

export interface Frame {
    node: string;
    pc: number;
    bindings: Bindings;
}

export interface Pending {
    source: Iid;
    player: number;
    effect: string;
}

export type LingeringUntil = 'endOfTurn' | 'sourceLeavesStable';

export interface Lingering {
    id: number;
    source: Iid;
    player: number;
    effect: string;
    until: LingeringUntil;
}

export type PromptKind = 'cards' | 'player' | 'yesno' | 'order' | 'option';

export interface Prompt {
    id: number;
    player: number;
    kind: PromptKind;
    reason: string;
    source: Iid | null;
    cards: Array<Iid>;
    players: Array<number>;
    min: number;
    max: number;
}

export interface CardInstance {
    defId: string;
    owner: number;
    zone: Zone;
    revealedTo: Array<number>;
}

export interface PlayerState {
    id: number;
    hand: Array<Iid>;
    stable: Array<Iid>;
    babyChosen: boolean;
}

export interface TurnState {
    player: number;
    actionsUsed: number;
    drawsUsed: number;
    extraTurns: number;
    endNow: boolean;
}

export interface Links {
    current: Array<Pending>;
    next: Array<Pending>;
    targeted: Array<Iid>;
}

export type WinReason = 'unicorns' | 'most' | 'letters' | 'allLose';

export interface GameState {
    phase: Phase;
    players: Array<PlayerState>;
    cards: Record<Iid, CardInstance>;
    deck: Array<Iid>;
    discard: Array<Iid>;
    nursery: Array<Iid>;
    limbo: Array<Iid>;
    turn: TurnState;
    exec: Array<Frame>;
    links: Links;
    prompt: Prompt | null;
    lingering: Array<Lingering>;
    winTarget: number;
    pendingWinner: number | null;
    winner: number | null;
    winReason: WinReason | null;
}

export function emptyState(playerCount: number, winTarget: number): GameState {
    const players: Array<PlayerState> = [];
    for (let i = 0; i < playerCount; i++)
        players.push({ id: i, hand: [], stable: [], babyChosen: false });

    return {
        phase: 'LOBBY',
        players,
        cards: {},
        deck: [],
        discard: [],
        nursery: [],
        limbo: [],
        turn: { player: 0, actionsUsed: 0, drawsUsed: 0, extraTurns: 0, endNow: false },
        exec: [],
        links: { current: [], next: [], targeted: [] },
        prompt: null,
        lingering: [],
        winTarget,
        pendingWinner: null,
        winner: null,
        winReason: null
    };
}

export function createCard(state: GameState, iid: Iid, defId: string, owner: number, zone: Zone) {
    state.cards[iid] = { defId, owner, zone, revealedTo: [] };
    zoneListOf(state, zone, owner).push(iid);
}

function zoneListOf(state: GameState, zone: Zone, owner: number): Array<Iid> {
    if (zone === 'hand') return state.players[owner].hand;
    if (zone === 'stable') return state.players[owner].stable;
    return state[zone];
}
