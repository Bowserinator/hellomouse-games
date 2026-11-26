export interface Pose {
    x: number;
    y: number;
    angle: number;
}

export interface Position {
    board: 'main' | 'hell';
    index: number;
}

export const tokens = ['Top hat', 'Race car', 'Scottie dog', 'Battleship', 'Thimble', 'Boot', 'Wheelbarrow', 'Iron'];
export const tokenImage = (token: number): string => `img/tokens/${token}.png`;
export const seatColors = ['#af352f', '#326db0', '#417744', '#7c4cac', '#a15d1a', '#877516', '#27847c', '#86506d'];

export const defaults = {
    playerLimit: 8,
    startingBalance: 1500,
    goSalary: 200,
    auctionSeconds: 15,
    rescueSeconds: 30,
    specialAuctions: true,
    stock: true,
    market: true,
    hell: true,
    rescue: true,
    literalDeadHand: true,
    houses: 32,
    hotels: 12,
    hiddenBalances: false,
    turnSeconds: 60,
    afkForfeit: false,
    rescueLimit: 1,
    upgradeLimit: 3,
    roundCap: 0,
    minuteCap: 60
};

export type Settings = typeof defaults;

export const settingBounds: Record<{
    [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings], [number, number]> = {
    playerLimit: [2, 8],
    startingBalance: [1, 100000],
    goSalary: [0, 10000],
    auctionSeconds: [5, 300],
    rescueSeconds: [5, 300],
    houses: [0, 128],
    hotels: [0, 64],
    turnSeconds: [5, 600],
    rescueLimit: [0, 10],
    upgradeLimit: [0, 5],
    roundCap: [0, 1000],
    minuteCap: [0, 1440]
};

export interface Profile {
    token: number;
    skin: number;
}

export interface DeedTerms {
    groupId: string;
    price: number;
    mortgageValue: number;
    buildingCost: number;
    rent: ReadonlyArray<number>;
}

export type SpaceType = 'go' | 'street' | 'railroad' | 'utility' | 'tax' | 'chest' | 'chance' |
'visiting' | 'parking' | 'detention' | 'rest';

export interface Space {
    id: string;
    name: string;
    type: SpaceType;
    tax?: number;
    specialAuction?: boolean;
    deed?: DeedTerms;
}

export interface BoardDefinition {
    id: string;
    name: string;
    version: number;
    currency: string;
    startingBalance: number;
    goSalary: number;
    dimensions: { width: number; height: number; cornerSize: number; thickness: number };
    colors: Readonly<Record<string, string>>;
    destinations: { go: string; gate: string };
    decks: { chance: string; chest: string };
    terms: { railroad: string; utility: string };
    spaces: ReadonlyArray<Space>;
    hell: {
        initialBail: number;
        minBail: number;
        reductionPerLap: number;
        spaces: ReadonlyArray<Space>;
    };
}

export interface Deed {
    owner: number | null;
    level: number;
    mortgaged: boolean;
    destroyed: boolean;
    lifetimeRent: number;
}

export const upgrades = {
    deadHand: { name: 'Dead Hand', price: 350, icon: '☠', description: 'When you go bankrupt, explode and bankrupt everyone else on your square with you.' },
    robber: { name: 'Robber’s Knife', price: 80, icon: '†', description: 'One-time: Steal $100 when you land on the same square as someone else.' },
    arson: { name: 'Arson', price: 200, icon: '♨', description: 'One-time: Destroy one house before paying rent.' },
    identity: { name: 'Identity Theft', price: 350, icon: '⇄', description: 'One-time: Swap positions with another player before rolling.' },
    devil: { name: 'Devil’s Deal', price: 50, icon: '♠', description: 'Next time you pass GO, 50/50 chance of either an extra $200 or going to hell without collecting GO salary.' }
};

export type Upgrade = keyof typeof upgrades;
export type Deck = 'chance' | 'chest';

export interface TradeSide {
    cash: number;
    deeds: Array<string>;
    cards: Array<string>;
    release: Array<string>;
}

export interface Trade {
    id: number;
    from: number;
    to: number;
    give: TradeSide;
    take: TradeSide;
}

export interface Command {
    action: string;
    [key: string]: unknown;
}
