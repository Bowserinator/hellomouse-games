import { Rng } from '../../../shared/ts/seeded-random.js';
import { boards, isProperty } from '../boards/index.js';
import type { Property } from '../boards/index.js';
import type { Command, Deck, Deed, Pose, Position, Profile, Settings, Space, Trade, Upgrade } from '../types.js';
import { upgrades } from '../types.js';
import { station } from '../stations.js';
import { validPose } from '../card-pose.js';
import { SPIN_MS, eventDuration } from '../ui/timing.js';
import { fallback } from './afk.js';
import { BID_GRACE_MS, eligible } from './auctions.js';
import { available, bailAmount, shortfall, transact } from './banking.js';
import { deckOf, shuffle } from './decks.js';
import type { Card } from '../cards/cardEffects.js';
import { walk } from './movement.js';
import { interest, management } from './propertyManagement.js';
import { calculateRent } from './rent.js';
import { sectors, stockReturn } from './stockMarket.js';
import { mortgageFee, ownsOffer, tradeSide } from './trades.js';
import type { Debt, GameEvent, LedgerEntry, Phase, Player, View } from './state.js';

type Next = { kind: 'debt'; debt: Debt } | { kind: 'auction'; property: string } |
{ kind: 'special' } | { kind: 'releaseMove'; seat: number; dice: number } | { kind: 'return'; card: Card } |
{ kind: 'transferMortgage' | 'releaseMortgage'; seat: number; property: string } |
{ kind: 'bankruptcyTransfer'; payer: number; creditor: number | null };

type InitPlayer = Profile & { name: string };

export class MonopolyEngine {
    readonly board = boards.classicUs;
    readonly properties: Array<Property>;
    readonly players: Array<Player>;
    readonly deeds: Record<string, Deed>;
    readonly settings: Settings;
    readonly events: Array<GameEvent> = [];
    readonly ledger: Array<LedgerEntry> = [];
    readonly started: number;
    readonly rng: Rng;
    readonly decks: Record<Deck, Array<Card>>;
    readonly queue: Array<Next> = [];
    phase: Phase = { kind: 'roll' };
    trade: Trade | null = null;
    turn: number;
    round = 1;
    deadline: number | null = null;
    readyAt = 0;
    spins = 0;
    shops = 0;
    houses: number;
    hotels: number;
    doubles = 0;
    rolled = false;
    extra = false;
    landed = false;
    now: number;
    private roundSeen = new Set<number>();
    private auctionOpenedAtSeq = 0;

    constructor(profiles: ReadonlyArray<InitPlayer>, settings: Settings, seed: number, now: number) {
        if (profiles.length < 2 || profiles.length > settings.playerLimit) throw new Error('Invalid player count');
        this.settings = { ...settings };
        this.now = this.started = now;
        this.rng = new Rng(seed);
        const { chance, chest } = this.board.cards;
        this.decks = { chance: shuffle(chance, this.rng), chest: shuffle(chest, this.rng) };
        this.houses = settings.houses;
        this.hotels = settings.hotels;
        this.properties = [...this.board.spaces, ...(settings.hell ? this.board.hell.spaces : [])].filter(isProperty);
        this.deeds = Object.fromEntries(this.properties.map(({ id }) => [id, {
            owner: null, level: 0, mortgaged: false, destroyed: false, lifetimeRent: 0
        }]));
        this.players = profiles.map((profile, seat) => ({
            ...profile, cash: 0, reserved: 0, position: { board: 'main', index: 0 }, pose: station(seat, profiles.length),
            bail: null, hellSteps: 0, failedRolls: 0, cards: [], upgrades: [], eliminated: false,
            rescues: 0, laps: 0, rentPaid: 0, rentEarned: 0, stockNet: 0, donations: 0, auctionsWon: 0,
            hellTurns: 0, upgradesUsed: 0
        }));
        let candidates = this.active();
        while (candidates.length > 1) {
            const rolls = candidates.map(() => this.dice(2).reduce((sum, die) => sum + die, 0));
            candidates = candidates.filter((_, index) => rolls[index] === Math.max(...rolls));
        }
        this.turn = candidates[0];
        for (const seat of this.active()) this.pay(null, seat, settings.startingBalance, 'Starting balance');
        this.emit('turn', 'First turn', { seat: this.turn });
        this.setPhase({ kind: 'roll' });
    }

    get seq(): number {
        return this.events.length;
    }

    /** When the current phase stops accepting commands; auctions allow slightly late bids for latency. */
    get expiry(): number | null {
        if (this.deadline === null) return null;
        return this.phase.kind === 'auction' ? this.deadline + BID_GRACE_MS : this.deadline;
    }

    isCurrentAuctionSnapshot(seq: number): boolean {
        return this.phase.kind === 'auction' && seq >= this.auctionOpenedAtSeq && seq <= this.seq;
    }

    active(): Array<number> {
        return this.players.flatMap((player, seat) => player.eliminated ? [] : [seat]);
    }

    group(property: Property): Array<Property> {
        return this.properties.filter(item => item.deed.groupId === property.deed.groupId);
    }

    property(id: unknown): Property | undefined {
        return this.properties.find(item => item.id === id);
    }

    private latestDice: ReadonlyArray<number> = [];

    emit(kind: string, text: string, fields: Partial<GameEvent> = {}): void {
        if (kind === 'roll' && fields.dice) this.latestDice = fields.dice;
        this.events.push({ ...fields, kind, text, seq: this.seq + 1, timestamp: this.now });
    }

    setPhase(phase: Phase, seconds = this.settings.turnSeconds): void {
        this.phase = phase;
        this.deadline = phase.kind === 'over' ? null : Math.min(this.safeTimeCap(),
            Math.max(this.now, this.readyAt) + seconds * 1000);
        this.emit('phase', '', { seat: this.actor() });
    }

    actor(): number {
        if (this.phase.kind === 'mortgageTransfer') return this.phase.seat;
        return this.phase.kind === 'debt' || this.phase.kind === 'rescue' ? this.phase.debt.payer : this.turn;
    }

    private safeTimeCap(): number {
        if (!this.settings.minuteCap || !['roll', 'extra', 'end'].includes(this.phase.kind)) return Infinity;
        return this.started + this.settings.minuteCap * 60000;
    }

    private present(from: number, phaseChanged: boolean): void {
        if (this.phase.kind === 'spin') return;
        const events = this.events.slice(from);
        // Repeatable optional actions must not postpone a mandatory decision.
        if (!phaseChanged && !events.some(event => event.kind === 'release' || event.kind === 'swap')) return;
        const duration = Math.min(8000, events.reduce((ms, event) => ms + eventDuration(event), 0));
        if (!duration) return;
        this.readyAt = Math.min(Math.max(this.now, this.readyAt) + duration, this.now + 8000);
        if (this.deadline !== null)
            this.deadline = Math.min(this.safeTimeCap(),
                phaseChanged ? this.deadline + duration : Math.max(this.deadline, this.readyAt));
    }

    pay(payer: number | null, creditor: number | null, amount: number, reason: string, property?: string): void {
        if (!amount) return;
        const entry = transact(this.players, payer, creditor, amount, reason, this.seq + 1, property);
        this.ledger.push(entry);
        if (reason === 'Rent' && property) this.deeds[property].lifetimeRent += amount;
        this.emit('ledger', reason, { seat: payer ?? undefined, target: creditor ?? undefined, amount, property });
    }

    bailCost(seat: number): number {
        const player = this.players[seat];
        return player.bail === null ? 0 : bailAmount(player.bail, available(player), this.settings.hell);
    }

    private dice(count: number): Array<number> {
        return Array.from({ length: count }, () => this.rng.int(1, 6));
    }

    private portal(seat: number, entering: boolean): void {
        const player = this.players[seat];
        const gate = this.board.spaces.findIndex(space => space.id === this.board.destinations.gate);
        player.position = entering && this.settings.hell ? { board: 'hell', index: 0 } : { board: 'main', index: gate };
        player.bail = entering ? this.board.hell.initialBail : null;
        player.hellSteps = player.failedRolls = 0;
        if (this.turn === seat) {
            this.landed = false;
            if (entering) this.extra = false;
        }
        this.emit(entering ? 'hell' : 'release', entering ? 'Sent to Hell' : 'Left Hell', { seat, path: [player.position] });
    }

    private salary(seat: number): boolean {
        const player = this.players[seat];
        const devil = player.upgrades.includes('devil');
        if (devil) {
            this.consume(seat, 'devil');
            if (!this.rng.int(0, 1)) {
                this.emit('upgrade', 'The Devil sent you to Hell', { seat });
                return false;
            }
        }
        this.pay(null, seat, this.settings.goSalary, 'GO salary');
        player.laps++;
        if (this.settings.stock) this.spins = 1;
        if (this.settings.market) this.shops++;
        if (devil) {
            this.pay(null, seat, 200, 'Devil’s Deal');
            this.emit('upgrade', 'The Devil paid out', { seat });
        }
        return true;
    }

    private move(seat: number, steps: number, dice: number, depth = 0, override?: 'railroad' | 'utility'): void {
        const player = this.players[seat];
        const board = player.position.board;
        const spaces = board === 'main' ? this.board.spaces : this.board.hell.spaces;
        const path: Array<Position> = [player.position];
        let sent = false;
        for (const index of walk(player.position.index, steps, spaces.length)) {
            player.position = { board, index };
            path.push(player.position);
            if (board === 'hell') {
                player.hellSteps++;
                if (index === 0) player.bail = Math.max(this.board.hell.minBail,
                    (player.bail as number) - this.board.hell.reductionPerLap);
            } else if (index === 0 && steps > 0 && !this.salary(seat)) {
                sent = true;
                break;
            }
        }
        if (path.length > 1) this.emit('move', `Moved to ${spaces[player.position.index].name}`, { seat, path });
        if (sent || (board === 'hell' && player.position.index === 0)) {
            this.portal(seat, sent);
            this.progress();
            return;
        }
        this.landed = true;
        this.land(seat, spaces[player.position.index], dice, depth, override);
    }

    private roll(): void {
        const player = this.players[this.turn];
        const inHell = player.bail !== null;
        const dice = this.dice(2);
        const total = dice.reduce((sum, die) => sum + die, 0);
        const double = dice.length === 2 && dice[0] === dice[1];
        this.rolled = true;
        this.landed = false;
        this.emit('roll', `Rolled ${dice.join(' + ')}`, { seat: this.turn, dice });
        if (inHell) {
            player.hellTurns++;
            this.extra = false;
            if (this.settings.hell) this.move(this.turn, total, total);
            else if (double) {
                this.portal(this.turn, false);
                this.move(this.turn, total, total);
            } else if (++player.failedRolls === 3) {
                this.queue.push({ kind: 'releaseMove', seat: this.turn, dice: total });
                this.charge({ payer: this.turn, creditor: null, amount: 50, reason: 'Bail' });
            } else this.progress();
            return;
        }
        this.extra = double;
        if (double && ++this.doubles === 3) {
            this.portal(this.turn, true);
            this.progress();
        } else this.move(this.turn, total, total);
    }

    private land(seat: number, space: Space, dice: number, depth: number, override?: 'railroad' | 'utility'): void {
        const special = !!space.specialAuction && this.settings.specialAuctions;
        if (isProperty(space)) {
            const deed = this.deeds[space.id];
            if (!deed.destroyed && deed.owner === null) {
                this.setPhase({ kind: 'purchase', property: space.id });
                return;
            }
            if (deed.owner !== null && deed.owner !== seat && !deed.mortgaged && !deed.destroyed) {
                if (deed.level > 0 && deed.level < 5 && this.players[seat].upgrades.includes('arson')) {
                    this.setPhase({ kind: 'arson', property: space.id, dice });
                    return;
                }
                this.rent(space, dice, override);
                return;
            }
        } else if (space.type === 'detention') this.portal(seat, true);
        else if (space.type === 'tax') {
            this.charge({ payer: seat, creditor: null, amount: space.tax as number, reason: space.name });
            return;
        } else if ((space.type === 'chance' || space.type === 'chest') && depth < 8 && this.decks[space.type].length) {
            this.setPhase({ kind: 'draw', deck: space.type, special, dice, depth });
            return;
        }
        if (special) this.queue.push({ kind: 'special' });
        this.progress();
    }

    private rent(property: Property, dice: number, override?: 'railroad' | 'utility'): void {
        if (override === 'utility') {
            const roll = this.dice(2);
            dice = roll[0] + roll[1];
            this.emit('roll', `Utility roll: ${roll.join(' + ')}`, { seat: this.turn, dice: roll });
        }
        const amount = calculateRent(property, this.group(property), this.deeds, this.turn, dice, override);
        this.charge({ payer: this.turn, creditor: this.deeds[property.id].owner, amount, reason: 'Rent', property: property.id });
    }

    private draw(phase: Extract<Phase, { kind: 'draw' }>): void {
        const deck = this.decks[phase.deck];
        const card = deck.shift() as Card;
        const { effect } = card;
        const seat = this.turn;
        const player = this.players[seat];
        this.emit('draw', card.text, { seat, card: card.id });
        if (effect.kind === 'escape') player.cards.push(card.id);
        if (effect.kind === 'advance' || effect.kind === 'nearest') {
            const length = this.board.spaces.length;
            const path = walk(player.position.index, length, length);
            const index = path.findIndex(i => effect.kind === 'advance'
                ? this.board.spaces[i].id === effect.destination : this.board.spaces[i].type === effect.type);
            if (index !== -1) {
                this.queue.unshift({ kind: 'return', card });
                this.move(seat, index + 1, phase.dice, phase.depth + 1, effect.kind === 'nearest' ? effect.type : undefined);
                return;
            }
        }
        if (effect.kind === 'back') {
            this.queue.unshift({ kind: 'return', card });
            this.move(seat, -effect.steps, phase.dice, phase.depth + 1);
            return;
        }
        const resolution: Array<Next> = [];
        if (effect.kind === 'hell') this.portal(seat, true);
        if (effect.kind === 'bank')
            if (effect.amount > 0) this.pay(null, seat, effect.amount, card.text);
            else resolution.push({ kind: 'debt', debt: { payer: seat, creditor: null, amount: -effect.amount, reason: card.text } });

        if (effect.kind === 'repairs') {
            const amount = Object.values(this.deeds).reduce((sum, deed) => sum + (deed.owner !== seat ? 0
                : deed.level === 5 ? effect.hotel : deed.level * effect.house), 0);
            resolution.push({ kind: 'debt', debt: { payer: seat, creditor: null, amount, reason: card.text } });
        }
        if (effect.kind === 'opponents')
            for (const rival of this.active().filter(other => other !== seat)) {
                const [payer, creditor] = effect.amount > 0 ? [rival, seat] : [seat, rival];
                resolution.push({ kind: 'debt', debt: { payer, creditor, amount: Math.abs(effect.amount), reason: card.text } });
            }

        if (effect.kind !== 'escape') resolution.push({ kind: 'return', card });
        // Finish a destination card before returning the card that sent the player there.
        this.queue.unshift(...resolution);
        if (phase.special && effect.kind !== 'hell') this.queue.push({ kind: 'special' });
        this.progress();
    }

    private charge(debt: Debt): void {
        this.queue.unshift({ kind: 'debt', debt });
        this.progress();
    }

    private progress(): void {
        while (this.queue.length) {
            // Resolve linked bankruptcy effects before opening any bank auction.
            const mandatory = this.queue[0].kind === 'auction'
                ? this.queue.findIndex(effect => effect.kind !== 'auction' && effect.kind !== 'special') : 0;
            const [effect] = this.queue.splice(Math.max(0, mandatory), 1);
            if (effect.kind === 'return') this.decks[deckOf(effect.card.id)].push(effect.card);
            if (effect.kind === 'bankruptcyTransfer') this.transferBankruptAssets(effect.payer, effect.creditor);
            if (effect.kind === 'debt') {
                const { payer, creditor, amount, reason, property } = effect.debt;
                if (this.players[payer].eliminated ||
                    (creditor !== null && this.players[creditor].eliminated)) continue;
                if (shortfall(this.players, effect.debt)) {
                    this.setPhase({ kind: 'debt', debt: effect.debt });
                    return;
                }
                this.pay(payer, creditor, amount, reason, property);
            }
            if (effect.kind === 'releaseMove' && !this.players[effect.seat].eliminated) {
                this.portal(effect.seat, false);
                this.move(effect.seat, effect.dice, effect.dice);
                return;
            }
            if (effect.kind === 'transferMortgage' || effect.kind === 'releaseMortgage') {
                const deed = this.deeds[effect.property];
                if (deed.owner !== effect.seat || !deed.mortgaged) continue;
                if (effect.kind === 'releaseMortgage') deed.mortgaged = false;
                else {
                    this.setPhase({ kind: 'mortgageTransfer', seat: effect.seat, property: effect.property });
                    return;
                }
            }
            if (this.active().length < 2) continue;
            if (effect.kind === 'auction') {
                if (this.deeds[effect.property].destroyed) continue;
                this.openAuction(effect.property);
                return;
            }
            if (effect.kind === 'special' && !this.players[this.turn].eliminated) {
                const properties = this.eligibleProperties();
                if (properties.length) {
                    this.setPhase({ kind: 'select', properties });
                    return;
                }
            }
        }
        if (this.active().length < 2) this.finish(false);
        else if (this.players[this.turn].eliminated) this.endTurn();
        else this.setPhase({ kind: this.extra ? 'extra' : 'end' });
    }

    private eligibleProperties(): Array<string> {
        return this.properties.filter(property => eligible(property, this.group(property), this.deeds)).map(p => p.id);
    }

    private openAuction(property: string): void {
        const duration = this.settings.auctionSeconds;
        const start = Math.max(1, Math.round((this.property(property) as Property).deed.price / 2));
        this.setPhase({ kind: 'auction', property, leader: null, bid: 0, start, history: [], abstained: [] }, duration);
        this.emit('auction', 'Auction opened', { property });
        this.auctionOpenedAtSeq = this.seq;
    }

    private bid(seat: number, amount: unknown): boolean {
        const phase = this.phase;
        const player = this.players[seat];
        if (phase.kind !== 'auction' || phase.abstained.includes(seat) || typeof amount !== 'number' ||
            !Number.isSafeInteger(amount) || amount < (phase.leader === null ? phase.start : phase.bid + 1) || amount > available(player) + (phase.leader === seat ? phase.bid : 0)) return false;
        if (phase.leader !== null) this.players[phase.leader].reserved -= phase.bid;
        player.reserved += amount;
        phase.leader = seat;
        phase.bid = amount;
        phase.history.push({ seat, amount });
        this.emit('bid', 'Bid', { seat, amount, property: phase.property });
        return true;
    }

    private abstain(seat: number): boolean {
        const phase = this.phase;
        if (phase.kind !== 'auction' || phase.abstained.includes(seat) ||
            phase.history.some(bid => bid.seat === seat)) return false;
        phase.abstained.push(seat);
        this.emit('abstain', 'Abstained', { seat, property: phase.property });
        if (this.active().filter(other => !phase.abstained.includes(other)).length < 2) this.settle();
        return true;
    }

    private assign(property: string, seat: number, amount: number, reason: string): void {
        this.pay(seat, null, amount, reason, property);
        this.deeds[property].owner = seat;
        this.trade = null;
        this.emit('deed', reason, { seat, property });
    }

    private pendingMortgage(property: string): boolean {
        return (this.phase.kind === 'debt' && this.phase.debt.reason === 'Mortgage transfer' &&
            this.phase.debt.property === property) ||
            this.queue.some(effect => effect.kind === 'transferMortgage' && effect.property === property);
    }

    private manage(seat: number, property: Property, action: string, debt: boolean): boolean {
        if (this.pendingMortgage(property.id)) return false;
        const group = this.group(property);
        if (!management(property, group, this.deeds, seat, available(this.players[seat]),
            this.houses, this.hotels, debt).includes(action)) return false;
        const deed = this.deeds[property.id];
        const { mortgageValue, buildingCost } = property.deed;
        if (action === 'MORTGAGE') {
            deed.mortgaged = true;
            this.pay(null, seat, mortgageValue, 'Mortgage', property.id);
        } else if (action === 'UNMORTGAGE') {
            this.pay(seat, null, mortgageValue + interest(mortgageValue), 'Unmortgage', property.id);
            deed.mortgaged = false;
        } else if (action === 'BUILD') {
            // Allocate scarce buildings at list price in server command order.
            this.pay(seat, null, buildingCost, 'Construction', property.id);
            if (++deed.level === 5) {
                this.hotels--; this.houses += 4;
            } else this.houses--;
            this.emit('build', 'Built', { seat, property: property.id });
        } else if (action === 'SELL') {
            if (deed.level-- === 5) {
                this.hotels++; this.houses -= 4;
            } else this.houses++;
            this.pay(null, seat, buildingCost / 2, 'Building sale', property.id);
            this.emit('build', 'Sold building', { seat, property: property.id });
        } else for (const item of group) this.clearBuildings(item, seat);
        this.trade = null;
        return true;
    }

    private clearBuildings(property: Property, seat: number | null): void {
        const deed = this.deeds[property.id];
        if (!deed.level) return;
        if (deed.level === 5) this.hotels++;
        else this.houses += deed.level;
        if (seat !== null) this.pay(null, seat, property.deed.buildingCost * deed.level / 2, 'Liquidation', property.id);
        deed.level = 0;
        this.emit('destroy', 'Buildings removed', { property: property.id });
    }

    private rescueOrBankrupt(debt: Debt): void {
        const payer = this.players[debt.payer];
        while (shortfall(this.players, debt)) {
            const choices = ['SELL', 'LIQUIDATE', 'MORTGAGE'];
            const raised = choices.some(action => this.properties.some(property =>
                this.manage(debt.payer, property, action, true)));
            if (!raised) break;
        }
        const target = shortfall(this.players, debt);
        if (!target)
            this.charge(debt);
        else if (this.settings.rescue && payer.rescues < this.settings.rescueLimit) {
            this.setPhase({ kind: 'rescue', debt, target, pledges: {}, declined: [] }, this.settings.rescueSeconds);
            this.emit('rescue', 'GoFundMe opened', { seat: debt.payer, amount: target });
        } else this.bankrupt(debt);
    }

    private donate(seat: number, amount: unknown): boolean {
        const phase = this.phase;
        if (phase.kind !== 'rescue' || phase.debt.payer === seat || phase.declined.includes(seat) ||
            typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 ||
            amount > available(this.players[seat])) return false;
        const remaining = phase.target - Object.values(phase.pledges).reduce((sum, value) => sum + value, 0);
        if (!this.settings.hiddenBalances && amount > remaining) return false;
        const accepted = Math.min(amount, remaining);
        this.players[seat].reserved += accepted;
        phase.pledges[seat] = (phase.pledges[seat] ?? 0) + accepted;
        this.emit('pledge', 'Pledged', { seat, amount: accepted, target: phase.debt.payer });
        if (accepted === remaining) {
            for (const [donor, pledge] of Object.entries(phase.pledges)) {
                const player = this.players[Number(donor)];
                player.reserved -= pledge;
                player.donations += pledge;
                this.pay(Number(donor), phase.debt.payer, pledge, 'Donation');
            }
            this.players[phase.debt.payer].rescues++;
            this.charge(phase.debt);
        }
        return true;
    }

    private optOut(seat: number): boolean {
        const phase = this.phase;
        if (phase.kind !== 'rescue' || phase.debt.payer === seat || this.players[seat].eliminated ||
            phase.declined.includes(seat)) return false;
        phase.declined.push(seat);
        if (this.active().every(other => other === phase.debt.payer || phase.declined.includes(other))) this.settle();
        return true;
    }

    private bankrupt(debt: Debt): void {
        const { payer } = debt;
        const player = this.players[payer];
        const victims = [payer];
        const follow: Array<Next> = [];
        if (!debt.preventsDeadHand && player.upgrades.includes('deadHand')) {
            const { board, index } = player.position;
            const collocated = this.active().filter(seat => {
                const other = this.players[seat];
                return seat !== payer && board === other.position.board && index === other.position.index &&
                    (other.bail !== null) === (player.bail !== null);
            });
            const property = (board === 'main' ? this.board.spaces : this.board.hell.spaces)[index];
            if (isProperty(property)) {
                this.clearBuildings(property, null);
                if (this.settings.literalDeadHand) Object.assign(this.deeds[property.id], {
                    owner: null, mortgaged: false, destroyed: true
                });
            }
            if (this.settings.literalDeadHand) victims.push(...collocated);
            else for (const seat of collocated) follow.push({ kind: 'debt', debt: {
                payer: seat, creditor: null, amount: 500, reason: 'Dead Hand', preventsDeadHand: true
            } });
            this.emit('deadHand', 'Dead Hand struck', { seat: payer, property: property.id });
        }
        this.trade = null;
        for (const seat of victims) {
            this.players[seat].eliminated = true;
            this.emit('bankrupt', 'Bankrupt', { seat });
            follow.push({ kind: 'bankruptcyTransfer', payer: seat, creditor: seat === payer ? debt.creditor : null });
        }
        this.queue.unshift(...follow);
        this.progress();
    }

    private transferBankruptAssets(payer: number, creditor: number | null): void {
        const victim = this.players[payer];
        const receiver = creditor !== null && !this.players[creditor].eliminated ? creditor : null;
        const follow: Array<Next> = [];
        for (const property of this.properties.filter(item => this.deeds[item.id].owner === payer)) {
            this.clearBuildings(property, payer);
            const deed = this.deeds[property.id];
            deed.owner = receiver;
            if (receiver === null) {
                deed.mortgaged = false;
                follow.push({ kind: 'auction', property: property.id });
            } else {
                if (deed.mortgaged) follow.push({ kind: 'transferMortgage', seat: receiver, property: property.id });
                this.emit('deed', 'Bankruptcy transfer', { seat: receiver, property: property.id });
            }
        }
        for (const id of victim.cards.splice(0))
            if (receiver !== null) this.players[receiver].cards.push(id);
            else this.returnHeldCard(id);

        this.pay(payer, receiver, available(victim), 'Bankruptcy');
        // Settle all eliminated players' estates before asking for a mortgage decision.
        let afterEstates = 0;
        while (this.queue[afterEstates]?.kind === 'bankruptcyTransfer') afterEstates++;
        this.queue.splice(afterEstates, 0, ...follow);
    }

    private consume(seat: number, upgrade: Upgrade): void {
        const player = this.players[seat];
        player.upgrades.splice(player.upgrades.indexOf(upgrade), 1);
        player.upgradesUsed++;
    }

    private swapTargets(): Array<number> {
        const player = this.players[this.turn];
        if (this.phase.kind !== 'roll' || this.rolled || player.bail !== null || !player.upgrades.includes('identity'))
            return [];
        return this.active().filter(seat => seat !== this.turn && this.players[seat].bail === null);
    }

    private robberyTargets(): Array<number> {
        const player = this.players[this.turn];
        if (!this.landed || !player.upgrades.includes('robber') ||
            (this.phase.kind !== 'end' && this.phase.kind !== 'extra')) return [];
        return this.active().filter(seat => {
            const other = this.players[seat];
            return seat !== this.turn && available(other) > 0 && other.position.board === player.position.board &&
                other.position.index === player.position.index && (other.bail !== null) === (player.bail !== null);
        });
    }

    private netWorth(seat: number): number {
        return this.properties.reduce((total, { id, deed }) => {
            const state = this.deeds[id];
            return state.owner === seat ? total + deed.price + state.level * deed.buildingCost -
                (state.mortgaged ? deed.mortgageValue : 0) : total;
        }, this.players[seat].cash);
    }

    private finish(capped: boolean): void {
        const active = this.active().sort((a, b) => this.netWorth(b) - this.netWorth(a));
        const eliminated = [...new Set(this.events.filter(event => event.kind === 'bankrupt').reverse().map(e => e.seat as number))];
        const winners = capped ? active.filter(seat => this.netWorth(seat) === this.netWorth(active[0])) : active;
        this.trade = null;
        this.setPhase({ kind: 'over', winners, placements: [...active, ...eliminated], ended: this.now });
        this.emit('result', winners.length === 0 ? 'Draw' : 'Game over');
    }

    private endTurn(): void {
        if (this.settings.minuteCap && this.now >= this.started + this.settings.minuteCap * 60000) {
            this.finish(true);
            return;
        }
        this.roundSeen.add(this.turn);
        if (this.active().every(seat => this.roundSeen.has(seat))) {
            if (this.settings.roundCap && this.round >= this.settings.roundCap) {
                this.finish(true);
                return;
            }
            this.round++;
            this.roundSeen.clear();
        }
        do this.turn = (this.turn + 1) % this.players.length;
        while (this.players[this.turn].eliminated);
        this.rolled = this.extra = this.landed = false;
        this.spins = this.shops = this.doubles = 0;
        this.trade = null;
        this.emit('turn', 'Turn started', { seat: this.turn });
        this.setPhase({ kind: 'roll' });
    }

    private classicPermissions(): boolean {
        const { hell, market, specialAuctions, stock, rescue } = this.settings;
        return !hell && !market && !specialAuctions && !stock && !rescue;
    }

    private trading(seat: number, other: number): boolean {
        if (!this.players[other] || this.players[other].eliminated || seat === other) return false;
        if (this.phase.kind === 'debt') return [seat, other].includes(this.phase.debt.payer);
        return this.phase.kind === 'end' &&
            (this.classicPermissions() || [seat, other].includes(this.turn));
    }

    private tradeAction(seat: number, command: Command): boolean {
        if (command.action === 'OFFER') {
            const to = command.to;
            const give = tradeSide(command.give), take = tradeSide(command.take);
            const classic = this.classicPermissions();
            if (typeof to !== 'number' || !this.trading(seat, to) || (!classic && seat !== this.actor()) ||
                !give || !take || give.release.length ||
                [...give.deeds, ...take.deeds].some(property => this.pendingMortgage(property)) ||
                !ownsOffer(give, this.players[seat], seat, this.deeds, this.properties) ||
                !ownsOffer(this.settings.hiddenBalances ? { ...take, cash: 0 } : take,
                    this.players[to], to, this.deeds, this.properties)) return false;
            this.trade = { id: this.seq + 1, from: seat, to, give, take };
            this.emit('trade', 'Trade offered', { seat, target: to });
            return true;
        }
        const offer = this.trade;
        if (!offer || command.id !== offer.id || ![offer.from, offer.to].includes(seat)) return false;
        if (command.action === 'CANCEL_TRADE') {
            if (seat === offer.to) this.emit('tradeDeclined', 'Trade declined', { seat, target: offer.from });
            this.trade = null;
            return true;
        }
        const { from, to, take } = offer;
        const give = tradeSide({ ...offer.give, release: command.release ?? [] });
        if (!give || seat !== to || !this.trading(from, to) ||
            [...give.deeds, ...take.deeds].some(property => this.pendingMortgage(property)) ||
            !ownsOffer(give, this.players[from], from, this.deeds, this.properties) ||
            !ownsOffer(take, this.players[to], to, this.deeds, this.properties)) return false;
        const fees = (side: typeof give) => side.deeds.reduce((total, id) => total + (this.deeds[id].mortgaged
            ? mortgageFee(this.property(id) as Property, side.release.includes(id)) : 0), 0);
        const fromFee = fees(take), toFee = fees(give);
        if (available(this.players[from]) - give.cash + take.cash < fromFee ||
            available(this.players[to]) - take.cash + give.cash < toFee) return false;
        for (const [sender, receiver, side] of [[from, to, give], [to, from, take]] as const) {
            this.pay(sender, receiver, side.cash, 'Trade');
            for (const id of side.deeds) {
                this.deeds[id].owner = receiver;
                if (side.release.includes(id)) this.deeds[id].mortgaged = false;
                this.emit('deed', 'Trade', { seat: receiver, property: id });
            }
            for (const id of side.cards) {
                const hand = this.players[sender].cards;
                hand.splice(hand.indexOf(id), 1);
                this.players[receiver].cards.push(id);
            }
        }
        this.pay(from, null, fromFee, 'Mortgage transfer');
        this.pay(to, null, toFee, 'Mortgage transfer');
        this.trade = null;
        if (this.phase.kind === 'debt' && !shortfall(this.players, this.phase.debt)) this.charge(this.phase.debt);
        return true;
    }

    private escape(seat: number, command: Command): boolean {
        const { card, target } = command;
        const player = this.players[seat];
        if (typeof target !== 'number' || typeof card !== 'string' || !player.cards.includes(card) ||
            !this.players[target] || this.players[target].eliminated || this.players[target].bail === null ||
            !['roll', 'extra', 'end'].includes(this.phase.kind)) return false;
        if (!this.settings.hell && (target !== seat || seat !== this.turn || this.phase.kind !== 'roll')) return false;
        player.cards.splice(player.cards.indexOf(card), 1);
        if (this.trade && ((this.trade.from === seat && this.trade.give.cards.includes(card)) ||
            (this.trade.to === seat && this.trade.take.cards.includes(card)))) this.trade = null;
        this.returnHeldCard(card);
        this.portal(target, false);
        return true;
    }

    private returnHeldCard(id: string): void {
        const deck = deckOf(id);
        const card = this.board.cards[deck].find(item => item.id === id);
        if (!card) throw new Error(`Unknown held card ${id}`);
        this.decks[deck].push(card);
    }

    private optional(seat: number, command: Command): boolean {
        const player = this.players[seat];
        if (command.action === 'SPIN' && this.spins > 0) {
            const wager = available(player);
            if (!Number.isSafeInteger(wager) || wager < 1) return false;

            this.spins = 0;
            player.reserved += wager;
            const sector = this.rng.int(0, sectors.length - 1);
            this.setPhase({ kind: 'spin', wager, sector, started: this.now });
            this.deadline = this.now + SPIN_MS;
            this.emit('spin', 'Stock wheel', { seat, sector });
            return true;
        }
        if (command.action === 'SHOP' && this.shops > 0 && typeof command.upgrade === 'string' &&
            Object.prototype.hasOwnProperty.call(upgrades, command.upgrade)) {
            const upgrade = command.upgrade as Upgrade;
            const item = upgrades[upgrade];
            if (player.upgrades.includes(upgrade) || player.upgrades.length >= this.settings.upgradeLimit ||
                available(player) < item.price) return false;
            this.shops--;
            this.pay(seat, null, item.price, 'Black Market');
            player.upgrades.push(upgrade);
            this.emit('upgrade', `Bought ${item.name}`, { seat });
            return true;
        }
        if (command.action === 'ROB' && typeof command.target === 'number' &&
            this.robberyTargets().includes(command.target)) {
            this.pay(command.target, seat, Math.min(100, available(this.players[command.target])), 'Robber’s Knife');
            this.consume(seat, 'robber');
            return true;
        }
        return false;
    }

    private apply(seat: number, command: Command): boolean {
        const player = this.players[seat];
        const { action } = command;
        const phase = this.phase;
        if (!player || player.eliminated || phase.kind === 'over') return false;
        if (action === 'POSE') {
            const pose = command.pose as Pose | undefined;
            if (!pose || !validPose(pose, this.board.dimensions.width, this.board.dimensions.height)) return false;
            player.pose = { x: pose.x, y: pose.y, angle: pose.angle };
            this.emit('pose', '', { seat });
            return true;
        }
        if (action === 'SCAN') {
            const target = this.players[command.target as number];
            if (command.target === undefined || command.target === seat)
                this.emit('scan', 'Scanned credit card', { seat });
            else if (target && !target.eliminated)
                this.emit('scan', 'Scanned credit card', { seat, target: command.target as number,
                    amount: target.cash, privateTo: seat });
            else return false;
            return true;
        }
        if (phase.kind === 'auction')
            return action === 'BID' ? this.bid(seat, command.amount) : action === 'ABSTAIN' && this.abstain(seat);
        if (phase.kind === 'rescue')
            return action === 'DONATE' ? this.donate(seat, command.amount) : action === 'OPT_OUT' && this.optOut(seat);
        if (action === 'ESCAPE') return this.escape(seat, command);
        if (['OFFER', 'ACCEPT_TRADE', 'CANCEL_TRADE'].includes(action)) return this.tradeAction(seat, command);
        if (['MORTGAGE', 'UNMORTGAGE', 'BUILD', 'SELL', 'LIQUIDATE'].includes(action)) {
            const property = this.property(command.property);
            const classic = this.classicPermissions();
            if (!property || (seat !== this.actor() && (!classic || phase.kind === 'debt')) ||
                !['roll', 'extra', 'end', 'purchase', 'debt'].includes(phase.kind) ||
                !this.manage(seat, property, action, phase.kind === 'debt')) return false;
            if (phase.kind === 'debt' && !shortfall(this.players, phase.debt)) this.charge(phase.debt);
            return true;
        }
        if (seat !== this.actor()) return false;
        if (phase.kind === 'mortgageTransfer' && ['KEEP_MORTGAGE', 'RELEASE_MORTGAGE'].includes(action)) {
            this.settleMortgage(phase, action === 'RELEASE_MORTGAGE');
            return true;
        }
        if (phase.kind === 'roll' || phase.kind === 'extra') {
            if (action === 'ROLL') {
                this.roll(); return true;
            }
            if (phase.kind === 'roll' && action === 'BAIL' && player.bail !== null &&
                available(player) >= this.bailCost(seat)) {
                this.pay(seat, null, this.bailCost(seat), 'Bail');
                this.portal(seat, false);
                return true;
            }
            if (action === 'SWAP' && typeof command.target === 'number' && this.swapTargets().includes(command.target)) {
                const other = this.players[command.target];
                [player.position, other.position] = [other.position, player.position];
                this.consume(seat, 'identity');
                this.emit('swap', 'Swapped positions', { seat, target: command.target, path: [player.position, other.position] });
                return true;
            }
        }
        if (phase.kind === 'draw' && action === 'DRAW') {
            this.draw(phase); return true;
        }
        if (phase.kind === 'purchase') {
            const price = this.property(phase.property)?.deed.price as number;
            if (action === 'BUY' && available(player) >= price) {
                this.assign(phase.property, seat, price, 'Purchase');
                this.progress();
                return true;
            }
            if (action === 'DECLINE') {
                this.openAuction(phase.property); return true;
            }
        }
        if (phase.kind === 'arson' && (action === 'ARSON' || action === 'DECLINE')) {
            if (action === 'ARSON') {
                this.consume(seat, 'arson');
                this.deeds[phase.property].level--;
                this.houses++;
                this.emit('destroy', 'Burned one house', { seat, property: phase.property });
            }
            this.rent(this.property(phase.property) as Property, phase.dice);
            return true;
        }
        if (phase.kind === 'select' && action === 'SELECT' && typeof command.property === 'string' &&
            this.eligibleProperties().includes(command.property)) {
            this.openAuction(command.property);
            return true;
        }
        if (phase.kind === 'debt' && action === 'UNABLE') {
            this.rescueOrBankrupt(phase.debt); return true;
        }
        if (phase.kind === 'end' && action === 'END') {
            this.endTurn(); return true;
        }
        return (phase.kind === 'end' || phase.kind === 'extra') && this.optional(seat, command);
    }

    private settleMortgage(phase: Extract<Phase, { kind: 'mortgageTransfer' }>, release: boolean): void {
        const { seat, property } = phase;
        const terms = this.property(property) as Property;
        if (release) this.queue.unshift({ kind: 'releaseMortgage', seat, property });
        this.charge({ payer: seat, creditor: null, amount: mortgageFee(terms, release),
            reason: 'Mortgage transfer', property });
    }

    private settle(): void {
        const phase = this.phase;
        if (phase.kind === 'auction') {
            if (phase.leader !== null) {
                const winner = this.players[phase.leader];
                winner.reserved -= phase.bid;
                winner.auctionsWon++;
                this.assign(phase.property, phase.leader, phase.bid, 'Auction won');
            } else this.emit('auction', 'No bids', { property: phase.property });
            this.progress();
        } else if (phase.kind === 'rescue') {
            for (const [seat, pledge] of Object.entries(phase.pledges)) this.players[Number(seat)].reserved -= pledge;
            this.bankrupt(phase.debt);
        } else if (phase.kind === 'debt') this.rescueOrBankrupt(phase.debt);
        else if (phase.kind === 'mortgageTransfer') this.settleMortgage(phase, false);
        else if (phase.kind === 'select') {
            const choices = this.eligibleProperties();
            if (choices.length) this.openAuction(this.rng.pick(choices));
            else this.progress();
        } else if (phase.kind === 'spin') {
            const player = this.players[this.turn];
            const gain = stockReturn(phase.wager, phase.sector);
            player.reserved -= phase.wager;
            player.stockNet += gain;
            this.pay(gain < 0 ? this.turn : null, gain > 0 ? this.turn : null, Math.abs(gain), 'Stock return');
            this.emit('stockResult', '', { seat: this.turn, amount: gain });
            this.progress();
        } else this.apply(this.actor(), fallback(this.view(this.actor())));
    }

    command(seat: number, command: Command, now: number): boolean {
        const { expiry } = this;
        if (expiry !== null && now >= expiry && !['POSE', 'SCAN'].includes(command.action)) return false;
        this.now = now;
        const from = this.seq;
        const phase = this.phase;
        if (!this.apply(seat, command)) return false;
        if (from === this.seq) this.emit('action', '', { seat });
        this.present(from, phase !== this.phase);
        return true;
    }

    timeout(now: number): boolean {
        const { expiry } = this;
        if (expiry === null || now < expiry) return false;
        this.now = now;
        const from = this.seq;
        const phase = this.phase;
        if (now >= this.safeTimeCap()) this.finish(true);
        else if (this.settings.afkForfeit && !['auction', 'debt', 'rescue', 'spin'].includes(phase.kind)) {
            const payer = this.actor();
            this.emit('forfeit', 'Forfeited after decision timeout', { seat: payer });
            this.bankrupt({ payer, creditor: null, amount: 0, reason: 'AFK', preventsDeadHand: true });
        } else this.settle();
        this.present(from, phase !== this.phase);
        return true;
    }

    eventsSince(seq: number, seat: number): Array<GameEvent> {
        return this.events.slice(seq).flatMap(event => {
            if (event.privateTo !== undefined && event.privateTo !== seat) return [];
            if (this.settings.hiddenBalances && (
                (event.kind === 'ledger' || event.kind === 'pledge') && event.seat !== seat && event.target !== seat ||
                event.kind === 'rescue' && event.seat !== seat ||
                event.kind === 'stockResult' && event.seat !== seat
            )) return [{ ...event, amount: undefined }];
            return [event];
        });
    }

    view(seat: number): View {
        const ownTurn = seat === this.turn;
        const { board, settings, players, deeds, phase, turn, round, deadline, started, seq, houses, hotels } = this;
        const { trade } = this;
        const ledger = this.ledger
            .filter(entry => !settings.hiddenBalances || entry.payer === seat || entry.creditor === seat)
            .map(entry => settings.hiddenBalances ? {
                ...entry,
                payerBefore: entry.payer === seat ? entry.payerBefore : null,
                payerAfter: entry.payer === seat ? entry.payerAfter : null,
                creditorBefore: entry.creditor === seat ? entry.creditorBefore : null,
                creditorAfter: entry.creditor === seat ? entry.creditorAfter : null
            } : entry);
        let visiblePhase: View['phase'] = phase;
        if (settings.hiddenBalances && phase.kind === 'spin' && !ownTurn)
            visiblePhase = { ...phase, wager: null };
        if (settings.hiddenBalances && (phase.kind === 'debt' || phase.kind === 'rescue') && seat !== phase.debt.payer) {
            const debt = { payer: phase.debt.payer, creditor: null, amount: null, reason: 'Private debt' };
            visiblePhase = phase.kind === 'rescue'
                ? { kind: 'rescue', debt, target: null, pledges: {}, declined: phase.declined } : { kind: 'debt', debt };
        }
        return structuredClone({
            board: board.id, version: board.version, players: players.map((player, i) => {
                const visible = !settings.hiddenBalances || seat === i;
                return { ...player, cash: visible ? player.cash : null, reserved: seat === i ? player.reserved : null,
                    donations: visible ? player.donations : null, stockNet: visible ? player.stockNet : null,
                    netWorth: visible ? this.netWorth(i) : null };
            }), deeds,
            phase: visiblePhase,
            turn, round, deadline, started, seq, houses, hotels,
            deckCounts: { chance: this.decks.chance.length, chest: this.decks.chest.length },
            spins: ownTurn ? this.spins : 0, shops: ownTurn ? this.shops : 0,
            dice: this.latestDice,
            swapTargets: ownTurn ? this.swapTargets() : [],
            robber: ownTurn ? this.robberyTargets() : [],
            trade: trade && [trade.from, trade.to].includes(seat) ? trade : null, ledger
        });
    }

    snapshot(): object {
        return structuredClone({ ...this, rng: this.rng.currentState });
    }
}
