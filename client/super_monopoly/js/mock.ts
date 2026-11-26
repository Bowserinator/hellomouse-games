// Offline sandbox that drives the game interface with a fake server.
import { boards, isProperty } from './boards/index.js';
import { sectors } from './engine/stockMarket.js';
import type { GameEvent, View } from './engine/state.js';
import type { Sync } from './protocol.js';
import { station } from './stations.js';
import { SPIN_MS } from './ui/timing.js';
import { button, byId, el } from './ui/dom.js';
import { defaults, upgrades } from './types.js';
import type { Deck, Pose, Position, TradeSide, Upgrade } from './types.js';

type Player = Omit<View['players'][number], 'cash' | 'reserved' | 'netWorth'> &
    { cash: number; reserved: number; netWorth: number };
type EventInput = Omit<GameEvent, 'seq' | 'timestamp'>;
type Handler = (action: string, fields: Record<string, unknown>) => void;

const board = boards.classicUs;
const { cards } = board;
const properties = [...board.spaces, ...board.hell.spaces].filter(isProperty);
const names = ['Alexandra Montgomery', 'Ada Lovelace-Byron', 'Bartholomew Fitzgerald', 'Cyrus Vandenberg'];
const main = (index: number): Position => ({ board: 'main', index });
const hell = (index: number): Position => ({ board: 'hell', index });
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const property = (id: string) => properties.find(item => item.id === id);

function makePlayer(seat: number, position: Position, extra: Partial<Player> = {}): Player {
    return {
        token: seat, skin: seat + 1, name: names[seat], cash: 1500, reserved: 0, position,
        pose: station(seat, names.length), bail: null, hellSteps: 0, failedRolls: 0, cards: [], upgrades: [],
        eliminated: false, rescues: 0, laps: 2, rentPaid: 140, rentEarned: 260, stockNet: 0,
        donations: 0, auctionsWon: 0, hellTurns: 0, upgradesUsed: 0, netWorth: 0, ...extra
    };
}

const players = [
    makePlayer(0, main(5), { cards: ['C09'], upgrades: ['arson', 'identity'] }),
    makePlayer(1, main(12), { upgrades: ['deadHand', 'robber'] }),
    makePlayer(2, hell(2), { bail: 50, hellSteps: 2, cards: ['CC05'], upgrades: ['devil'] }),
    makePlayer(3, main(25))
];

const deeds: View['deeds'] = {};
for (const { id } of properties) deeds[id] = { owner: null, level: 0, mortgaged: false, destroyed: false, lifetimeRent: 0 };
const own = (seat: number, ids: Array<string>, level = 0) => ids.forEach(id => {
    deeds[id].owner = seat;
    deeds[id].level = level;
    deeds[id].lifetimeRent = 40 * (seat + 1);
});
own(0, ['mediterranean_avenue'], 2);
own(0, ['baltic_avenue'], 1);
own(0, ['oriental_avenue', 'vermont_avenue', 'connecticut_avenue', 'reading_railroad', 'electric_company']);
own(1, ['st_charles_place', 'states_avenue', 'virginia_avenue'], 5);
own(1, ['short_line']);
own(2, ['brimstone_estate'], 2);
own(2, ['the_abyss']);
own(3, ['park_place', 'boardwalk'], 4);
own(3, ['bo_railroad', 'pennsylvania_railroad']);
deeds.reading_railroad.mortgaged = true;
deeds.short_line.mortgaged = true;
deeds.kentucky_avenue.destroyed = true;

const view: View = {
    board: board.id, version: board.version, players, deeds, phase: { kind: 'end' }, turn: 0, round: 7,
    dice: [4, 3], swapTargets: [], deadline: null, started: Date.now() - 12 * 60000, seq: 0, houses: 20, hotels: 9,
    deckCounts: { chance: cards.chance.length, chest: cards.chest.length }, spins: 2, shops: 1, robber: [],
    trade: null,
    ledger: [{ payer: 1, creditor: 0, amount: 120, reason: 'Rent', seq: 0, payerBefore: 1500, payerAfter: 1380,
        creditorBefore: 1380, creditorAfter: 1500 }]
};

let seq = 0;
let render: (sync: Sync) => void = () => undefined;
let clickedDeck: Deck | undefined;

const worth = (seat: number) => players[seat].cash + properties.reduce((sum, { id, deed }) => {
    const owned = deeds[id];
    return owned.owner !== seat || owned.destroyed ? sum
        : sum + (owned.mortgaged ? 0 : deed.price) + owned.level * deed.buildingCost;
}, 0);

function push(events: Array<EventInput> = []): void {
    const stamped = events.map(event => ({ ...event, seq: ++seq, timestamp: Date.now() }));
    view.seq = seq;
    players.forEach((player, seat) => {
        player.netWorth = worth(seat);
    });
    render({
        type: 'SYNC', started: true, youAre: 0, isHost: true, settings: { ...defaults }, view,
        seats: players.map(player => ({ token: player.token, skin: player.skin, username: player.name,
            ready: true, connected: true })),
        events: stamped, generation: 1
    });
    byId('world').querySelectorAll<HTMLButtonElement>('button:disabled').forEach(node => {
        node.disabled = false;
    });
}

function seedLog(): Array<EventInput> {
    const script: Array<EventInput> = [
        { kind: 'turn', seat: 1, text: 'Turn started' },
        { kind: 'roll', seat: 1, dice: [3, 4], text: 'Rolled 3 + 4' },
        { kind: 'move', seat: 1, path: [main(12)], text: 'Moved to St. Charles Place' },
        { kind: 'ledger', seat: 1, amount: 140, property: 'st_charles_place', text: 'Purchase' },
        { kind: 'deed', seat: 1, property: 'st_charles_place', text: 'Purchase' },
        { kind: 'scan', seat: 1, text: 'Scanned credit card' },
        { kind: 'phase', seat: 1, text: '' },
        { kind: 'turn', seat: 2, text: 'Turn started' },
        { kind: 'roll', seat: 2, dice: [2, 2], text: 'Rolled 2 + 2' },
        { kind: 'move', seat: 2, path: [main(5)], text: 'Moved to Reading Railroad' },
        { kind: 'ledger', seat: 2, target: 0, amount: 25, property: 'reading_railroad', text: 'Rent' },
        { kind: 'turn', seat: 3, text: 'Turn started' },
        { kind: 'roll', seat: 3, dice: [6, 1], text: 'Rolled 6 + 1' },
        { kind: 'auction', property: 'marvin_gardens', text: 'Auction opened' },
        { kind: 'bid', seat: 3, amount: 100, property: 'marvin_gardens', text: 'Bid' },
        { kind: 'bid', seat: 1, amount: 120, property: 'marvin_gardens', text: 'Bid' },
        { kind: 'abstain', seat: 3, property: 'marvin_gardens', text: 'Abstained' },
        { kind: 'ledger', seat: 1, amount: 120, property: 'marvin_gardens', text: 'Auction' },
        { kind: 'deed', seat: 1, property: 'marvin_gardens', text: 'Auction' },
        { kind: 'turn', seat: 0, text: 'Turn started' }
    ];
    script.forEach((event, index) => {
        if (event.kind !== 'ledger') return;
        view.ledger.push({ payer: event.seat ?? null, creditor: event.target ?? null, amount: event.amount ?? 0,
            reason: event.text, property: event.property, seq: seq + 1 + index, payerBefore: 1500,
            payerAfter: 1500 - (event.amount ?? 0), creditorBefore: event.target === undefined ? null : 1500,
            creditorAfter: event.target === undefined ? null : 1500 + (event.amount ?? 0) });
    });
    return script;
}

function advance(seat: number, steps: number): Array<Position> {
    const player = players[seat];
    const start = player.position.board === 'main' ? player.position.index : 10;
    const path = Array.from({ length: steps + 1 }, (_, step) => main((start + step) % 40));
    player.position = path[steps];
    return path;
}

function roll(): void {
    const dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    const path = advance(0, dice[0] + dice[1]);
    const space = board.spaces[path[path.length - 1].index];
    view.dice = dice;
    view.phase = space.deed && deeds[space.id].owner === null && !deeds[space.id].destroyed
        ? { kind: 'purchase', property: space.id } : { kind: 'end' };
    push([{ kind: 'roll', seat: 0, dice, text: `Rolled ${dice[0] + dice[1]}` },
        { kind: 'move', seat: 0, path, text: `Moved to ${space.name}` }]);
}

function draw(deck: Deck, escape = false): void {
    const pool = cards[deck];
    const choices = pool.filter(item => (item.effect.kind === 'escape') === escape);
    const chosen = choices[Math.floor(Math.random() * choices.length)] ?? pool[0];
    if (escape && !players[0].cards.includes(chosen.id)) players[0].cards.push(chosen.id);
    if (view.phase.kind === 'draw') view.phase = { kind: 'end' };
    push([{ kind: 'draw', seat: 0, card: chosen.id, text: chosen.text }]);
}

function swap(target: number): void {
    const me = players[0], other = players[target];
    const path = [other.position, me.position];
    [me.position, other.position] = [other.position, me.position];
    view.swapTargets = [];
    push([{ kind: 'swap', seat: 0, target, path, text: `Swapped with ${other.name}` }]);
}

function banish(seat: number, release: boolean): void {
    const player = players[seat];
    player.position = release ? main(10) : hell(3);
    player.bail = release ? null : 50;
    push([{ kind: release ? 'release' : 'hell', seat, path: [player.position],
        text: `${player.name} ${release ? 'escaped Hell' : 'went to Hell'}` }]);
}

function spin(wager: number): void {
    const sector = Math.floor(Math.random() * sectors.length);
    const started = Date.now();
    view.phase = { kind: 'spin', wager, sector, started };
    push([{ kind: 'spin', seat: 0, sector, amount: wager, text: 'Spun the stock market' }]);
    setTimeout(() => {
        const phase = view.phase;
        if (phase.kind !== 'spin' || phase.started !== started) return;
        view.phase = { kind: 'end' };
        push();
    }, SPIN_MS + 300);
}

function pay(): void {
    const [payer, creditor] = players;
    const amount = 200;
    view.ledger.push({ payer: 0, creditor: 1, amount, reason: 'Rent', seq: seq + 1, payerBefore: payer.cash,
        payerAfter: payer.cash - amount, creditorBefore: creditor.cash, creditorAfter: creditor.cash + amount });
    payer.cash -= amount;
    creditor.cash += amount;
    push([{ kind: 'ledger', seat: 0, target: 1, amount, text: 'Paid rent' }]);
}

function acquire(id: string): void {
    const item = property(id);
    if (!item) return;
    deeds[id].owner = 0;
    players[0].cash -= item.deed.price;
    view.phase = { kind: 'end' };
    push([{ kind: 'deed', seat: 0, property: id, text: `Bought ${item.name}` }]);
}

function handle(action: string, fields: Record<string, unknown>): void {
    const me = players[0];
    const id = text(fields.property);
    const phase = view.phase;
    switch (action) {
        case 'PREVIEW': case 'PREVIEW_END': break;
        case 'ROLL': roll(); break;
        case 'DRAW': draw(clickedDeck ?? (phase.kind === 'draw' ? phase.deck : 'chance')); break;
        case 'SCAN': push([{ kind: 'scan', seat: 0, text: 'Scanned card' }]); break;
        case 'SPIN': spin(Number(fields.amount) || 100); break;
        case 'BUY': if (phase.kind === 'purchase') acquire(phase.property); break;
        case 'END': push([{ kind: 'turn', seat: 0, text: 'Turn ended' }]); break;
        case 'BUILD': case 'SELL':
            if (!deeds[id]) break;
            deeds[id].level += action === 'BUILD' ? 1 : -1;
            push([{ kind: 'build', seat: 0, property: id, text: `${action === 'BUILD' ? 'Built on' : 'Sold on'} ${id}` }]);
            break;
        case 'LIQUIDATE':
            for (const item of properties.filter(other => other.deed.groupId === property(id)?.deed.groupId))
                deeds[item.id].level = 0;
            push([{ kind: 'build', seat: 0, property: id, text: 'Liquidated set' }]);
            break;
        case 'MORTGAGE': case 'UNMORTGAGE':
            if (deeds[id]) deeds[id].mortgaged = action === 'MORTGAGE';
            push();
            break;
        case 'ARSON':
            if (phase.kind !== 'arson') break;
            deeds[phase.property].level = Math.max(0, deeds[phase.property].level - 1);
            view.phase = { kind: 'end' };
            push([{ kind: 'destroy', seat: 0, property: phase.property, text: 'Arson' }]);
            break;
        case 'SWAP': swap(Number(fields.target)); break;
        case 'SHOP': {
            const key = text(fields.upgrade) as Upgrade;
            if (!upgrades[key] || me.upgrades.includes(key)) {
                push();
                break;
            }
            me.upgrades.push(key);
            me.cash -= upgrades[key].price;
            push([{ kind: 'upgrade', seat: 0, text: `Bought ${upgrades[key].name}` }]);
            break;
        }
        case 'ESCAPE': {
            const target = Number(fields.target);
            me.cards = me.cards.filter(item => item !== fields.card);
            if (players[target]) banish(target, true);
            break;
        }
        case 'OFFER':
            // SAFETY: The offer form submits the same trade sides the interface sends to the server.
            view.trade = { id: 1, from: 0, to: Number(fields.to), give: fields.give as TradeSide,
                take: fields.take as TradeSide };
            push();
            break;
        case 'ACCEPT_TRADE': case 'CANCEL_TRADE': view.trade = null; push(); break;
        case 'BID':
            if (phase.kind !== 'auction') break;
            phase.bid = Number(fields.amount);
            phase.leader = 0;
            phase.history.push({ seat: 0, amount: phase.bid });
            push();
            break;
        case 'ABSTAIN':
            if (phase.kind !== 'auction') break;
            phase.abstained.push(0);
            push();
            break;
        case 'POSE':
            // SAFETY: Card drags submit a complete pose.
            me.pose = fields.pose as Pose;
            push();
            break;
        case 'DECLINE': case 'SELECT': case 'KEEP_MORTGAGE': case 'RELEASE_MORTGAGE':
            view.phase = { kind: 'end' };
            push();
            break;
        default: push();
    }
}

function press(selector: string, match: (label: string) => boolean): void {
    [...document.querySelectorAll<HTMLButtonElement>(selector)].find(node => match(node.textContent ?? ''))?.click();
}

function reset(): void {
    view.phase = { kind: 'end' };
    view.swapTargets = [];
    view.trade = null;
    push();
}

function modal(prepare: () => void, selector: string, match: (label: string) => boolean): () => void {
    return () => {
        reset();
        prepare();
        push();
        press(selector, match);
    };
}

export function startMock(renderSync: (sync: Sync) => void): Handler {
    render = renderSync;
    byId('world').addEventListener('click', event => {
        const deck = (event.target as Element).closest('.deck');
        if (deck) clickedDeck = deck.classList.contains('deck--chance') ? 'chance' : 'chest';
    }, true);

    const tools = el('div');
    tools.id = 'mock-tools';
    const add = (label: string, run: () => void) => tools.append(button(label, run));
    const phases: Array<[string, View['phase']]> = [
        ['Purchase', { kind: 'purchase', property: 'illinois_avenue' }],
        ['Draw', { kind: 'draw', deck: 'chance', special: false, dice: 7, depth: 0 }],
        ['Select', { kind: 'select', properties: ['illinois_avenue', 'indiana_avenue', 'marvin_gardens'] }],
        ['Debt', { kind: 'debt', debt: { payer: 0, creditor: 1, amount: 2400, reason: 'Rent' } }],
        ['Rescue', { kind: 'rescue', debt: { payer: 1, creditor: 3, amount: 800, reason: 'Rent' }, target: 800,
            pledges: { 3: 100 }, declined: [] }],
        ['Transfer', { kind: 'mortgageTransfer', seat: 0, property: 'reading_railroad' }],
        ['Bid', { kind: 'auction', property: 'marvin_gardens', leader: 1, bid: 120, start: 100,
            history: [{ seat: 3, amount: 100 }, { seat: 1, amount: 120 }], abstained: [] }]
    ];
    const auction = phases[6][1];
    const set = (phase: View['phase']) => () => {
        view.phase = phase;
        view.deadline = phase.kind === 'rescue' ? Date.now() + 25000 : null;
        push();
    };

    add('Rules…', () => byId('rules-button').click());
    add('Trade…', modal(() => undefined, '#hud button', label => label === 'Trade'));
    add('Offer…', modal(() => {
        view.trade = { id: 1, from: 1, to: 0, give: { cash: 100, deeds: ['short_line'], cards: [], release: [] },
            take: { cash: 0, deeds: ['reading_railroad'], cards: [], release: [] } };
    }, '#hud button', label => label === 'Trade offer'));
    add('Market…', modal(() => undefined, '#optional-controls button', label => label === 'Black Market'));
    add('Stocks…', modal(() => undefined, '#optional-controls button', label => label.startsWith('Stock market')));
    add('Identity…', modal(() => {
        view.phase = { kind: 'roll' };
        view.swapTargets = [1, 3];
    }, '#phase-controls button', label => label === 'Identity Theft'));
    add('Escape…', modal(() => undefined, '#optional-controls .escape-card', () => true));
    add('Auction…', () => {
        view.phase = auction;
        view.deadline = Date.now() + 20000;
        push();
    });
    add('Log…', () => byId('log-panel').click());
    add('Deeds…', () => press('#leaderboard button', label => label.endsWith('deeds')));
    add('Results…', modal(() => {
        view.phase = { kind: 'over', winners: [0], placements: [0, 1, 3, 2], ended: Date.now() };
    }, '#phase-controls button', label => label === 'Results'));
    tools.append(el('hr'));

    add('Roll', roll);
    add('Move', () => {
        const path = advance(1, 6);
        push([{ kind: 'move', seat: 1, path, text: 'Ada moved' }]);
    });
    add('Chance', () => draw('chance'));
    add('Chest', () => draw('chest'));
    add('Hold', () => draw('chance', true));
    add('Deed', () => {
        const free = properties.find(item => deeds[item.id].owner === null && !deeds[item.id].destroyed);
        if (free) acquire(free.id);
    });
    add('Build', () => {
        deeds.baltic_avenue.level = (deeds.baltic_avenue.level + 1) % 6;
        push([{ kind: 'build', seat: 0, property: 'baltic_avenue', text: 'Built on Baltic Avenue' }]);
    });
    add('Destroy', () => {
        deeds.tennessee_avenue.destroyed = !deeds.tennessee_avenue.destroyed;
        push([{ kind: 'destroy', seat: 0, property: 'tennessee_avenue', text: 'Tennessee Avenue burned down' }]);
    });
    add('Dead Hand', () => {
        deeds.tennessee_avenue.destroyed = true;
        push([{ kind: 'deadHand', seat: 0, property: 'tennessee_avenue', text: 'Dead Hand struck' }]);
    });
    add('Hell', () => banish(1, false));
    add('Release', () => banish(1, true));
    add('Swap', () => swap(1));
    add('Pay', pay);
    add('Bankrupt', () => push([{ kind: 'bankrupt', seat: 3, text: 'Cy went bankrupt' }]));
    add('Scan', () => handle('SCAN', {}));
    add('Spin', () => spin(100));
    add('Upgrade', () => push([{ kind: 'upgrade', seat: 0, text: 'Bought Arson' }]));
    tools.append(el('hr'));

    for (const [label, phase] of phases) add(label, set(phase));
    add('Reset', reset);
    byId('game').append(tools);
    push(seedLog());
    return handle;
}
