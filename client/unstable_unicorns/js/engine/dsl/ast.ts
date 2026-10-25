import type { Iid } from '../ids.js';
import type { LingeringUntil, Zone } from '../state.js';

export type Kind = 'baby' | 'basic' | 'magic' | 'instant' | 'upgrade' | 'downgrade';

export type UnicornType = 'basic' | 'baby' | 'panda' | 'special';

export const KINDS: Array<Kind> = ['baby', 'basic', 'magic', 'instant', 'upgrade', 'downgrade'];
export const UNICORN_TYPES: Array<UnicornType> = ['basic', 'baby', 'panda', 'special'];

export type OwnerRef = 'self' | 'other' | 'any' | 'active';

export type EventType =
    | 'play'
    | 'enterStable'
    | 'leaveStable'
    | 'destroy'
    | 'discard'
    | 'sacrifice'
    | 'return'
    | 'draw'
    | 'neigh'
    | 'turnStart'
    | 'turnEnd'
    | 'deckOut';

export const EVENT_TYPES: Array<EventType> = [
    'play', 'enterStable', 'leaveStable', 'destroy', 'discard',
    'sacrifice', 'return', 'draw', 'neigh', 'turnStart', 'turnEnd', 'deckOut'
];

export type NodeId = string;

export type Cmp = 'lt' | 'lte' | 'eq' | 'gte' | 'gt';
export const CMPS: Array<Cmp> = ['lt', 'lte', 'eq', 'gte', 'gt'];

export type Filter =
    | { f: 'type'; type: Kind }
    | { f: 'tag'; tag: string }
    | { f: 'unicorn'; unicorn?: UnicornType }
    | { f: 'owner'; owner: OwnerRef }
    | { f: 'and'; all: Array<Filter> }
    | { f: 'or'; any: Array<Filter> }
    | { f: 'not'; not: Filter };

export const FILTER_KINDS: Array<Filter['f']> = ['type', 'tag', 'unicorn', 'owner', 'and', 'or', 'not'];

export type Cond =
    | { c: 'event'; type: EventType }
    | { c: 'count'; zone: Zone; owner: OwnerRef; filter?: Filter; cmp: Cmp; n: number }
    | { c: 'selfInStable' }
    | { c: 'and'; all: Array<Cond> }
    | { c: 'or'; any: Array<Cond> }
    | { c: 'not'; not: Cond };

export const COND_KINDS: Array<Cond['c']> = ['event', 'count', 'selfInStable', 'and', 'or', 'not'];

export type CountSpec = number | { min: number; max: number } | { var: string };

export interface Selector {
    zone: Zone | 'any';
    owner: OwnerRef;
    filter?: Filter;
    count: CountSpec;
    mode?: 'choose' | 'random';
    chooser?: 'controller' | 'zoneOwner';
    as?: string;
    reveal?: boolean;
}

export type Primitive =
    | { p: 'draw'; count: CountSpec; who?: 'self' | 'active' }
    | { p: 'discard'; sel: Selector }
    | { p: 'destroy'; sel: Selector }
    | { p: 'sacrifice'; sel: Selector }
    | { p: 'returnToHand'; sel: Selector }
    | { p: 'moveCard'; sel: Selector; zone: Zone; owner: OwnerRef }
    | { p: 'moveStable'; sel: Selector; owner: OwnerRef }
    | { p: 'stealRandom'; sel: Selector }
    | { p: 'lookAndSteal'; from: 'deck' | 'discard'; count: number }
    | { p: 'swapHands'; who: OwnerRef }
    | { p: 'tradeUnicorns'; mine: Selector; theirs: Selector }
    | { p: 'search'; from: 'deck' | 'discard'; filter?: Filter; count: CountSpec; as?: string }
    | { p: 'fetchFromDiscard'; filter?: Filter; count: CountSpec; as?: string }
    | { p: 'shuffleInto'; sel: Selector; zone: Zone; owner: OwnerRef }
    | { p: 'replaceUnicornsWithBabies'; sel?: Selector }
    | { p: 'takeExtraTurn' }
    | { p: 'endTurnNow' }
    | { p: 'addLingering'; effect: Effect; until: LingeringUntil }
    | { p: 'custom'; name: string };

export const PRIMITIVE_KINDS: Array<Primitive['p']> = [
    'draw', 'discard', 'destroy', 'sacrifice', 'returnToHand', 'moveCard',
    'moveStable', 'stealRandom', 'lookAndSteal', 'swapHands', 'tradeUnicorns',
    'search', 'fetchFromDiscard', 'shuffleInto', 'replaceUnicornsWithBabies', 'takeExtraTurn',
    'endTurnNow', 'addLingering', 'custom'
];

export type Effect = ({
    e: 'seq';
    steps: Array<Effect>;
} | {
    e: 'prim';
    prim: Primitive;
} | {
    e: 'optional';
    effect: Effect;
} | {
    e: 'ifYouDo';
    effect: Effect;
} | {
    e: 'choice';
    options: Array<Effect>;
} | {
    e: 'forEachPlayer';
    effect: Effect;
    who?: OwnerRef;
} | {
    e: 'repeat';
    count: CountSpec;
    effect: Effect;
} | {
    e: 'when';
    cond: Cond;
    effect: Effect;
}) & { id?: NodeId };

export const EFFECT_KINDS: Array<Effect['e']> = [
    'seq', 'prim', 'optional', 'ifYouDo', 'choice', 'forEachPlayer', 'repeat', 'when'
];

export type Modifier =
    | { m: 'actionsPerTurn'; value: number }
    | { m: 'drawsPerTurn'; value: number }
    | { m: 'handLimit'; value: number }
    | { m: 'stableLimit'; value: number }
    | { m: 'unicornCount'; value: number; filter?: Filter }
    | { m: 'unicornType'; type: UnicornType; filter?: Filter }
    | { m: 'protect'; against: 'destroy' | 'sacrifice' | 'neigh' | 'play'; filter?: Filter }
    | { m: 'blockPlay'; kind: Kind }
    | { m: 'handVisible' };

export const MODIFIER_KINDS: Array<Modifier['m']> = [
    'actionsPerTurn', 'drawsPerTurn', 'handLimit', 'stableLimit', 'unicornCount',
    'unicornType', 'protect', 'blockPlay', 'handVisible'
];

export type Replacement = {
    r: 'replace';
    when: EventType;
    filter?: Filter;
    effect: Effect;
    unless?: Cond;
};

export interface Trigger {
    on: EventType;
    when?: Cond;
    effect: Effect;
}

export interface CardDef {
    id: string;
    kind: Kind;
    unicornType?: UnicornType;
    tags?: Array<string>;
    playIf?: Cond;
    playTarget?: 'self' | 'any' | 'other';
    onPlay?: Effect;
    triggers?: Array<Trigger>;
    modifiers?: Array<Modifier>;
    replacements?: Array<Replacement>;
    instant?: { neigh: true; superNeigh?: boolean };
    unneighable?: boolean;
}

export interface CatalogEntry {
    id: string;
    name: string;
    kind: Kind;
    unicornType?: UnicornType;
    text: string;
    copies: number;
}

export interface CardEvent {
    type: EventType;
    card?: Iid;
    player?: number;
    cause?: string;
}
