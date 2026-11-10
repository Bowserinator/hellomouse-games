export type Lane = 'economy' | 'defense' | 'offense';
export type MatchMode = 'standard' | 'peaceful';
export type MachineCategory = 'bench' | 'line' | 'contract' | 'automated' | 'mega' | 'nano' | 'research';
export type AttackCategory = 'supply' | 'cyber' | 'power' | 'workforce' | 'marketing' | 'legal';
export type EffectType =
    | 'add_manual_click' | 'multiply_production' | 'multiply_auto_production'
    | 'multiply_machine_category' | 'multiply_sale_price' | 'multiply_research_rate'
    | 'add_mitigation' | 'reduce_attack_duration' | 'reduce_attack_severity'
    | 'unlock_ability' | 'reduce_theft' | 'whiff_chance'
    | 'multiply_while_sabotaged' | 'modify_attack_duration'
    | 'activate_slow' | 'activate_revenue_slow' | 'steal_phones'
    | 'cleanse_debuffs' | 'temporary_mitigation' | 'block_next_attack';

export interface Cost {
    cash?: number;
    research?: number;
    influence?: number;
}

export interface Effect {
    type: EffectType;
    target: 'self' | 'selectedOpponent';
    factor?: number;
    fraction?: number;
    count?: number;
    chance?: number;
    durationSec?: number;
    capSec?: number;
    category?: AttackCategory;
    machineCategory?: MachineCategory;
    stackGroup?: string;
    abilityId?: string;
}

export interface Upgrade {
    id: string;
    name: string;
    lane: Lane;
    tier: 1 | 2 | 3 | 4 | 5;
    description: string;
    stat: string;
    icon: string;
    purchase: Cost;
    requires?: Array<string>;
    effects: Array<Effect>;
}

export interface Ability {
    id: string;
    name: string;
    verb: string;
    kind: 'attack' | 'defense';
    sourceUpgradeId: string;
    activation: Cost;
    cooldownSec: number;
    effects: Array<Effect>;
}

export interface Machine {
    id: string;
    name: string;
    icon: string;
    category: MachineCategory;
    baseCost: number;
    growth: number;
    basePps: number;
    baseRps: number;
    unlock: number;
}

export interface Content {
    contentVersion: number;
    machines: Array<Machine>;
    upgrades: Array<Upgrade>;
    abilities: Array<Ability>;
}

export interface CompanyTheme {
    id: string;
    name: string;
    primary: string;
    accent: string;
    icon: string;
}

export interface Settings {
    target: number;
    mode: MatchMode;
    moneyMultiplier: number;
    seed: number;
}

export interface Debuff {
    attacker: number;
    kind: 'pps' | 'revenue';
    abilityId: string;
    category: AttackCategory;
    slow: number;
    expiresAt: number;
}

export interface Shield {
    kind: 'mitigation' | 'block';
    abilityId: string;
    fraction: number;
    until: number;
}

export interface Hit {
    attacker: number;
    at: number;
    kind: 'pps' | 'revenue';
}

export interface PlayerState {
    seat: number;
    companyId: string;
    phonesMade: number;
    lifetimeCash: number;
    cash: number;
    research: number;
    influence: number;
    smoothPps: number;
    clicks: number;
    clickBudget: number;
    lastClickAt: number;
    machines: Record<string, number>;
    owned: Array<string>;
    readyAt: Record<string, number>;
    offenseReadyAt: number;
    debuffs: Array<Debuff>;
    shields: Array<Shield>;
    hits: Array<Hit>;
    immuneUntil: number;
}

export type EventType = 'project' | 'machine' | 'attack' | 'defend' | 'shipment' | 'win';
export type Outcome = 'landed' | 'blocked' | 'whiff' | 'immune' | 'weaker' | 'stolen' | 'failed';

export interface GameEvent {
    id: number;
    at: number;
    type: EventType;
    seat: number;
    target?: number;
    ref?: string;
    outcome?: Outcome;
    slow?: number;
    duration?: number;
    amount?: number;
}

export interface MatchState {
    settings: Settings;
    players: Array<PlayerState>;
    time: number;
    rngState: number;
    nextEventId: number;
    events: Array<GameEvent>;
    shipmentSeat: number;
    winner: number;
    placements: Array<number>;
}

export type Action =
    | { type: 'make_phone'; playerId: number }
    | { type: 'buy_project'; playerId: number; upgradeId: string }
    | { type: 'buy_machine'; playerId: number; machineId: string; quantity: number | 'max' }
    | { type: 'activate_ability'; playerId: number; abilityId: string; targetPlayerId?: number };

export interface ActionResult {
    ok: boolean;
    error?: string;
}

export interface Rates {
    autoPps: number;
    prePps: number;
    effectivePps: number;
    slow: number;
    revenueSlow: number;
    mitigation: number;
    salePrice: number;
    clickPhones: number;
    rps: number;
    sabotaged: boolean;
}

export interface Context {
    settings: Settings;
    leaderPhones: number;
}

export interface PublicPlayer {
    seat: number;
    companyId: string;
    phonesMade: number;
    pps: number;
    rank: number;
    shielded: boolean;
    immune: boolean;
    pressure: number;
    mitigation: number;
    theftFactor: number;
}

export interface View {
    time: number;
    settings: Settings;
    leaderPhones: number;
    you: PlayerState;
    players: Array<PublicPlayer>;
    events: Array<GameEvent>;
    shipmentSeat: number;
    winner: number;
    placements: Array<number>;
}

export interface LobbySettings {
    target: number;
    mode: MatchMode;
    moneyMultiplier: number;
}

export interface SeatInfo {
    username: string;
    ready: boolean;
    company: string;
    connected: boolean;
}

export interface Sync {
    type: 'SYNC';
    started: boolean;
    youAre: number;
    isHost: boolean;
    settings: LobbySettings;
    seats: Array<SeatInfo>;
    view?: View;
}

export interface Move {
    action: string;
    target?: number;
    mode?: MatchMode;
    moneyMultiplier?: number;
    company?: string;
    upgradeId?: string;
    machineId?: string;
    quantity?: number | 'max';
    abilityId?: string;
    targetSeat?: number;
}
