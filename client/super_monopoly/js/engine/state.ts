import type { Deck, Deed, Pose, Position, Profile, Trade, Upgrade } from '../types.js';

export interface Player extends Profile {
    name: string;
    cash: number;
    reserved: number;
    position: Position;
    pose: Pose;
    bail: number | null;
    hellSteps: number;
    failedRolls: number;
    cards: Array<string>;
    upgrades: Array<Upgrade>;
    eliminated: boolean;
    rescues: number;
    laps: number;
    rentPaid: number;
    rentEarned: number;
    stockNet: number;
    donations: number;
    auctionsWon: number;
    hellTurns: number;
    upgradesUsed: number;
}

export interface Debt {
    payer: number;
    creditor: number | null;
    amount: number;
    reason: string;
    property?: string;
    preventsDeadHand?: boolean;
}

export type Phase =
    { kind: 'roll' | 'extra' | 'end' } |
    { kind: 'draw'; deck: Deck; special: boolean; dice: number; depth: number } |
    { kind: 'purchase'; property: string } |
    { kind: 'arson'; property: string; dice: number } |
    { kind: 'select'; properties: Array<string> } |
    { kind: 'auction'; property: string; leader: number | null; bid: number; start: number;
        history: Array<{ seat: number; amount: number }>; abstained: Array<number>; } |
    { kind: 'mortgageTransfer'; seat: number; property: string } |
    { kind: 'debt'; debt: Debt } |
    { kind: 'rescue'; debt: Debt; target: number; pledges: Record<number, number>; declined: Array<number> } |
    { kind: 'spin'; wager: number; sector: number; started: number } |
    { kind: 'over'; winners: Array<number>; placements: Array<number>; ended: number };

export interface LedgerEntry extends Omit<Debt, 'payer'> {
    payer: number | null;
    seq: number;
    payerBefore: number | null;
    payerAfter: number | null;
    creditorBefore: number | null;
    creditorAfter: number | null;
}

export interface GameEvent {
    seq: number;
    timestamp: number;
    kind: string;
    text: string;
    seat?: number;
    target?: number;
    amount?: number;
    property?: string;
    dice?: Array<number>;
    path?: Array<Position>;
    card?: string;
    sector?: number;
    privateTo?: number;
}

export interface View {
    board: string;
    version: number;
    players: Array<Omit<Player, 'cash' | 'reserved' | 'donations' | 'stockNet'> & {
        cash: number | null;
        reserved: number | null;
        donations: number | null;
        stockNet: number | null;
        netWorth: number | null;
    }>;
    deeds: Record<string, Deed>;
    phase: Exclude<Phase, { kind: 'debt' | 'rescue' | 'spin' }> |
    (Omit<Extract<Phase, { kind: 'spin' }>, 'wager'> & { wager: number | null }) |
    (Omit<Extract<Phase, { kind: 'debt' }>, 'debt'> & { debt: Omit<Debt, 'amount'> & { amount: number | null } }) |
    (Omit<Extract<Phase, { kind: 'rescue' }>, 'debt' | 'target'> & {
        debt: Omit<Debt, 'amount'> & { amount: number | null }; target: number | null;
    });
    turn: number;
    round: number;
    dice: ReadonlyArray<number>;
    swapTargets: Array<number>;
    deadline: number | null;
    started: number;
    seq: number;
    houses: number;
    hotels: number;
    deckCounts: Record<Deck, number>;
    spins: number;
    shops: number;
    robber: Array<number>;
    trade: Trade | null;
    ledger: Array<LedgerEntry>;
}
