/** The four match screens: production, economy, defense and offense. */
import { companyIcon } from './company-icon.js';
import { GAME_CONFIG, companyTheme, tierMilestone } from './config.js';
import {
    abilityById, abilityCost, abilityStatus, canAfford, computeRates, machinePrice, machineUnlockAt, maxQuantity,
    ownedInTier, previewPpsGain, projectCost, projectLock, quantityCost, upgradeById, visibleTier
} from './engine.js';
import type { ProjectLock } from './engine.js';
import {
    describeAbility, formatClock, formatCost, formatExact, formatMoney, formatNumber, formatPercent, formatSeconds
} from './format.js';
import { CONTENT } from './upgrades.js';
import type { Ability, Context, GameEvent, Lane, Machine, Move, PlayerState, PublicPlayer, Rates, Upgrade, View } from './types.js';

export interface Live {
    view: View;
    you: PlayerState;
    rates: Rates;
    now: number;
    context: Context;
    names: Array<string>;
    seat: number;
    spectating: boolean;
}

interface Actions {
    move: (message: Move) => void;
    details: (id: string) => void;
}

const ORDINALS = ['1st', '2nd', '3rd', '4th'];
const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface NativeDialog extends HTMLDialogElement {
    open: boolean;
    showModal(): void;
    close(): void;
}

export const dialog = (id: string): NativeDialog => el<NativeDialog>(id);

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function icon(name: string): HTMLSpanElement {
    const node = make('span', 'material-icons', name);
    node.setAttribute('aria-hidden', 'true');
    return node;
}

function button(className: string, text = ''): HTMLButtonElement {
    const node = make('button', className, text);
    node.type = 'button';
    return node;
}

function setText(node: Element, text: string): void {
    if (node.textContent !== text) node.textContent = text;
}

function lockText(lock: ProjectLock): string {
    if (lock.kind === 'peaceful') return 'Disabled in peaceful matches';
    if (lock.kind === 'phones') return `Unlocks at ${formatNumber(lock.amount)} phones`;
    if (lock.kind === 'projects') return `Buy ${lock.amount} more earlier project${lock.amount === 1 ? '' : 's'}`;
    return 'Requires another project';
}

export function projectState(live: Live, upgrade: Upgrade): { owned: boolean; lock: ProjectLock | null; affordable: boolean; cost: ReturnType<typeof projectCost> } {
    const cost = projectCost(upgrade, live.you, live.context);
    return {
        owned: live.you.owned.includes(upgrade.id),
        lock: projectLock(live.you, upgrade, live.view.settings),
        affordable: canAfford(live.you, cost),
        cost
    };
}

class UpgradeCard {
    readonly element = make('div', 'upgrade-card');
    private price = make('span', 'card-price');
    private stat = make('span', 'card-stat');
    private buy = button('button buy');

    constructor(readonly upgrade: Upgrade, actions: Actions) {
        const body = button('card-body');
        body.setAttribute('aria-label', `${upgrade.name}, details`);
        body.append(icon(upgrade.icon), make('span', 'card-name', upgrade.name), this.stat);
        body.onclick = () => actions.details(upgrade.id);
        this.buy.onclick = () => actions.move({ action: 'buy_project', upgradeId: upgrade.id });
        this.element.append(body, this.price, this.buy);
    }

    update(live: Live): void {
        const state = projectState(live, this.upgrade);
        const gain = this.upgrade.lane === 'economy' && !state.owned ? previewPpsGain(live.you, this.upgrade, live.now) : 0;
        this.element.classList.toggle('is-owned', state.owned);
        this.element.classList.toggle('is-locked', !state.owned && state.lock !== null);
        setText(this.stat, gain > 0.5 ? `+${formatNumber(gain)} PPS` : this.upgrade.stat);
        setText(this.price, state.owned ? 'Owned' : formatCost(state.cost));
        setText(this.buy, state.owned ? '✓ Owned' : state.lock ? 'Locked' : 'Buy');
        this.buy.disabled = state.owned || state.lock !== null || !state.affordable;
        this.buy.title = state.lock ? lockText(state.lock) : '';
    }
}

class Shop {
    private cards: Array<UpgradeCard> = [];
    private earlier: Array<UpgradeCard> = [];
    private key = '';
    private abilityKey = '';
    private targetSeat = -1;
    private abilityRows: Array<{ ability: Ability; row: HTMLElement; button: HTMLButtonElement }> = [];

    constructor(private lane: Lane, private actions: Actions) {}

    private fill(container: HTMLElement, upgrades: Array<Upgrade>): Array<UpgradeCard> {
        const cards = upgrades.map(upgrade => new UpgradeCard(upgrade, this.actions));
        container.replaceChildren(...cards.map(card => card.element));
        return cards;
    }

    render(live: Live, targetName: string, targetSeat: number): void {
        const { lane } = this, { settings } = live.view;
        this.targetSeat = targetSeat;
        const tier = visibleTier(live.you, lane, settings);
        if (this.key !== `${tier}`) {
            this.key = `${tier}`;
            this.cards = this.fill(el(`${lane}-cards`), CONTENT.upgrades.filter(u => u.lane === lane && u.tier === tier));
            this.earlier = this.fill(el(`${lane}-earlier`).querySelector('.earlier-list') as HTMLElement,
                CONTENT.upgrades.filter(u => u.lane === lane && u.tier < tier));
            el(`${lane}-earlier`).hidden = tier === 1;
        }
        const owned = ownedInTier(live.you, lane, tier);
        setText(el(`${lane}-tier`), `TIER ${tier} · ${owned}/3 OWNED`);
        const missing: Array<string> = [];
        if (owned < 2) missing.push(`${2 - owned} more project${owned === 1 ? '' : 's'}`);
        if (tier < 5 && live.you.phonesMade < tierMilestone(settings.target, tier + 1))
            missing.push(`${formatNumber(tierMilestone(settings.target, tier + 1))} phones`);
        setText(el(`${lane}-next`), lane === 'offense' && settings.mode === 'peaceful' ? 'Attacks are disabled in this match'
            : tier < 5 && missing.length ? `Tier ${tier + 1}: ${missing.join(' and ')}` : '');
        [...this.cards, ...this.earlier].forEach(card => card.update(live));
        if (lane !== 'economy') this.renderAbilities(live, targetName, targetSeat);
    }

    private renderAbilities(live: Live, targetName: string, targetSeat: number): void {
        const kind = this.lane === 'offense' ? 'attack' : 'defense';
        const unlocked = CONTENT.abilities.filter(ability => ability.kind === kind &&
            abilityStatus(live.you, ability, live.now).unlocked);
        const key = unlocked.map(ability => ability.id).join();
        if (key !== this.abilityKey) {
            this.abilityKey = key;
            this.abilityRows = unlocked.map(ability => {
                const row = make('li', 'ability');
                const action = button('button');
                const source = upgradeById(ability.sourceUpgradeId);
                const info = make('div', 'ability-info');
                info.append(make('b', '', ability.name), make('small', '', describeAbility(ability)));
                action.onclick = () => this.actions.move({
                    action: 'activate_ability', abilityId: ability.id, ...kind === 'attack' ? { targetSeat: this.targetSeat } : {}
                });
                row.append(icon(source?.icon ?? 'bolt'), info, action);
                return { ability, row, button: action };
            });
            el(`${this.lane}-abilities`).replaceChildren(...this.abilityRows.map(entry => entry.row));
        }
        for (const { ability, button: action } of this.abilityRows) {
            const status = abilityStatus(live.you, ability, live.now);
            const cost = abilityCost(ability, live.view.settings);
            const waiting = Math.max(status.cooldownLeft, status.globalLeft);
            const influenceWait = ((cost.influence ?? 0) - live.you.influence) / GAME_CONFIG.influence.regenPerSecond;
            let label = `${ability.verb}${kind === 'attack' ? ` ${targetName}` : ''} — ${formatCost(cost)}`;
            if (waiting > 0) label = `READY IN ${formatSeconds(waiting)}`;
            else if (kind === 'attack' && targetSeat < 0) label = 'No rival to target';
            else if (influenceWait > 0 && canAfford(live.you, { ...cost, influence: 0 })) label = `${label} · ${formatSeconds(influenceWait)}`;
            setText(action, label);
            action.disabled = waiting > 0 || !canAfford(live.you, cost) || kind === 'attack' && targetSeat < 0 ||
                live.view.settings.mode === 'peaceful' && kind === 'attack';
        }
    }
}

class MachineRow {
    readonly element = make('li', 'machine-row');
    private title = make('b');
    private detail = make('small');
    private buttons: Array<{ button: HTMLButtonElement; quantity: number | 'max' }> = [];

    constructor(private machine: Machine, actions: Actions) {
        const info = make('div', 'machine-info');
        info.append(this.title, this.detail);
        const quantities = make('div', 'quantities');
        for (const quantity of [1, 10, 'max'] as const) {
            const action = button('button small', quantity === 'max' ? 'Max' : `×${quantity}`);
            action.onclick = () => actions.move({ action: 'buy_machine', machineId: machine.id, quantity });
            this.buttons.push({ button: action, quantity });
            quantities.appendChild(action);
        }
        this.element.append(icon(machine.icon), info, quantities);
    }

    update(live: Live): void {
        const { machine } = this, { you } = live;
        const owned = you.machines[machine.id] ?? 0;
        const unlockAt = machineUnlockAt(machine, live.view.settings);
        const locked = you.phonesMade < unlockAt;
        const price = machinePrice(machine, owned);
        const withOne = computeRates({ ...you, machines: { ...you.machines, [machine.id]: owned + 1 } }, live.now);
        const gain = machine.baseRps > 0 ? withOne.rps - live.rates.rps : withOne.effectivePps - live.rates.effectivePps;
        this.element.classList.toggle('is-locked', locked);
        setText(this.title, `${machine.name} · ${owned}`);
        setText(this.detail, locked ? `Unlocks at ${formatNumber(unlockAt)} phones`
            : `+${formatNumber(gain)} ${machine.baseRps > 0 ? 'RP/s' : 'PPS'} · ${formatMoney(price)}`);
        for (const { button: action, quantity } of this.buttons) {
            const count = quantity === 'max' ? maxQuantity(machine, owned, you.cash) : quantity;
            action.disabled = locked || count < 1 || you.cash < quantityCost(machine, owned, count);
            if (quantity === 'max') setText(action, count > 0 ? `Max (${count})` : 'Max');
        }
    }
}

interface Chip {
    text: string;
    kind: string;
    tip: string;
}

function renderChips(container: HTMLElement, chips: Array<Chip>): void {
    const key = JSON.stringify(chips);
    if (container.dataset.key === key) return;
    container.dataset.key = key;
    container.replaceChildren(...chips.map(chip => {
        const node = make('span', `chip ${chip.kind}`, chip.text);
        node.title = chip.tip;
        node.tabIndex = 0;
        return node;
    }));
}

export class Screens {
    targetSeat = -1;
    private shops: Record<Lane, Shop>;
    private machines: Array<MachineRow>;
    private detailsId = '';
    private feedId = 0;
    private rows = new Map<number, { row: HTMLElement; fill: HTMLElement; stats: HTMLElement }>();
    private targetButtons = new Map<number, HTMLButtonElement>();
    private latest: Live | null = null;

    constructor(private actions: Actions) {
        this.shops = {
            economy: new Shop('economy', actions), defense: new Shop('defense', actions), offense: new Shop('offense', actions)
        };
        this.machines = CONTENT.machines.map(machine => new MachineRow(machine, actions));
        el('machine-list').replaceChildren(...this.machines.map(row => row.element));
        el('assemble').addEventListener('keydown', event => {
            if (event.repeat) event.preventDefault();
        });
        el('details-close').onclick = () => dialog('details').close();
        el('details-buy').onclick = () => {
            actions.move({ action: 'buy_project', upgradeId: this.detailsId });
            dialog('details').close();
        };
        el('toast-action').onclick = () => this.select('defense');
        document.querySelectorAll<HTMLButtonElement>('#screen-tabs button').forEach(tab => {
            tab.onclick = () => this.select(tab.dataset.tab as string);
        });
    }

    select(name: string): void {
        document.querySelectorAll<HTMLElement>('.game-screen').forEach(screen => {
            screen.classList.toggle('is-selected', screen.dataset.screen === name);
        });
        document.querySelectorAll<HTMLElement>('#screen-tabs button').forEach(tab => {
            tab.classList.toggle('is-selected', tab.dataset.tab === name);
        });
        const screen = el(`screen-${name}`);
        screen.scrollIntoView({ inline: 'center', block: 'nearest' });
        (screen.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus();
    }

    openDetails(id: string): void {
        this.detailsId = id;
        const upgrade = upgradeById(id);
        if (!upgrade) return;
        el('details-icon').textContent = upgrade.icon;
        setText(el('details-title'), upgrade.name);
        setText(el('details-text'), upgrade.description);
        const sheet = dialog('details');
        if (!sheet.open) sheet.showModal();
        if (this.latest) this.updateDetails(this.latest);
    }

    private updateDetails(live: Live): void {
        const upgrade = upgradeById(this.detailsId);
        if (!upgrade) return;
        const state = projectState(live, upgrade);
        setText(el('details-cost'), state.owned ? 'Owned' : formatCost(state.cost));
        setText(el('details-status'), state.lock ? lockText(state.lock) : state.affordable || state.owned ? '' : 'Not enough resources');
        (el('details-buy') as HTMLButtonElement).disabled = state.owned || state.lock !== null || !state.affordable;
    }

    setCompany(companyId: string): void {
        const theme = companyTheme(companyId);
        const game = el('game');
        game.dataset.company = theme.id;
        game.style.setProperty('--company-primary', theme.primary);
        game.style.setProperty('--company-accent', theme.accent);
        const image = el<HTMLImageElement>('company-icon');
        image.src = theme.icon;
        image.style.background = theme.primary;
        setText(el('company-name'), theme.name);
    }

    floatGain(text: string): void {
        const node = make('span', 'floater', text);
        node.style.left = `${30 + Math.random() * 40}%`;
        node.onanimationend = () => node.remove();
        el('floaters').appendChild(node);
    }

    setHint(text: string): void {
        setText(el('hint'), text);
        el('hint').hidden = !text;
    }

    render(live: Live): void {
        this.latest = live;
        const { view, you, rates, now } = live;
        const rivals = view.players.filter(player => player.seat !== live.seat).sort((a, b) => a.rank - b.rank);
        if (!rivals.some(rival => rival.seat === this.targetSeat)) this.targetSeat = rivals[0]?.seat ?? -1;
        const targetName = live.names[this.targetSeat] ?? '';

        this.renderProduction(live);
        this.shops.economy.render(live, '', -1);
        this.shops.defense.render(live, '', -1);
        this.shops.offense.render(live, targetName, this.targetSeat);
        this.machines.forEach(row => row.update(live));
        setText(el('economy-balance'), `${formatMoney(you.cash)} · ${formatNumber(you.research)} RP`);
        setText(el('defense-balance'), `${formatMoney(you.cash)} · ${formatNumber(you.research)} RP`);
        setText(el('offense-balance'), `${formatMoney(you.cash)} · ${Math.floor(you.influence)}⚡`);
        renderChips(el('defense-status'), [
            { text: `Mitigation ${formatPercent(rates.mitigation)}`, kind: 'safe', tip: 'Share of incoming sabotage your defenses ignore.' },
            ...CONTENT.abilities.filter(ability => ability.kind === 'defense').map(ability => ({ ability, status: abilityStatus(you, ability, now) }))
                .filter(entry => entry.status.unlocked)
                .map(entry => ({
                    text: entry.status.cooldownLeft > 0 ? `${entry.ability.name} ${formatSeconds(entry.status.cooldownLeft)}` : `${entry.ability.name} ready`,
                    kind: entry.status.cooldownLeft > 0 ? '' : 'safe',
                    tip: `${describeAbility(entry.ability)}. ${entry.status.cooldownLeft > 0 ? 'Recharging.' : 'Ready to use below.'}`
                }))
        ]);
        this.renderTargets(live, rivals);
        if (el('details').hasAttribute('open')) this.updateDetails(live);
    }

    private renderTargets(live: Live, rivals: Array<PublicPlayer>): void {
        for (const rival of rivals) {
            let node = this.targetButtons.get(rival.seat);
            if (!node) {
                node = button('chip target');
                node.setAttribute('role', 'radio');
                node.append(companyIcon(companyTheme(rival.companyId)), make('span'));
                node.onclick = () => {
                    this.targetSeat = rival.seat;
                };
                this.targetButtons.set(rival.seat, node);
                el('target-chips').appendChild(node);
            }
            const theme = companyTheme(rival.companyId);
            node.style.order = String(rival.rank);
            node.style.setProperty('--chip-color', theme.primary);
            node.setAttribute('aria-checked', String(rival.seat === this.targetSeat));
            setText(node.lastElementChild as Element, `${live.names[rival.seat] ?? theme.name} • ${Math.floor(rival.phonesMade / live.view.settings.target * 100)}%${rival.shielded ? ' 🛡' : ''}`);
        }
        const rival = rivals.find(candidate => candidate.seat === this.targetSeat);
        const panel = el('target-panel');
        el('target-prompt').hidden = rivals.length === 0;
        el('target-stats-label').hidden = !rival;
        if (!rival) {
            panel.replaceChildren();
            return;
        }
        setText(el('target-stats-label'), `${live.names[rival.seat] ?? companyTheme(rival.companyId).name}'s stats`);
        const chips: Array<Chip> = [{ text: `${formatNumber(rival.pps)} PPS`, kind: '', tip: 'Phones per second this rival is producing right now.' }];
        chips.push(rival.mitigation === null
            ? { text: 'Defenses hidden', kind: '', tip: 'This rival has Trade Secret Protection, so their defenses and scouting are hidden.' }
            : { text: `Mitigation ${formatPercent(rival.mitigation)}`, kind: 'safe', tip: 'Share of sabotage this rival ignores.' });
        if (rival.shielded) chips.push({ text: 'Shield active', kind: 'safe', tip: 'An active defense (Lockdown or Defense Grid) will weaken or block your next attack.' });
        if (rival.immune) chips.push({ text: 'Immune', kind: 'safe', tip: 'Production attacks have no effect on them for a few seconds after a cleanse.' });
        if (rival.pressure > 0)
            chips.push({
                text: `Under pressure ×${rival.pressure}`, kind: 'danger',
                tip: `${rival.pressure} other player${rival.pressure === 1 ? '' : 's'} slowed them in the last 30 seconds, so new production attacks only land at ${rival.pressure === 1 ? '60%' : '30%'} strength.`
            });
        if (rival.intel) {
            chips.push({ text: `Tiers ${rival.intel.tiers.join('/')}`, kind: '', tip: 'Shop tier reached in Economy, Defense and Offense.' });
            for (const entry of rival.intel.abilities) {
                const wait = entry.readyAt - live.now;
                chips.push({
                    text: `${abilityById(entry.id)?.name ?? ''} ${wait > 0 ? formatSeconds(wait) : 'ready'}`, kind: wait > 0 ? '' : 'safe',
                    tip: 'A defensive ability this rival owns and when it can be used again.'
                });
            }
        }
        if (!panel.firstChild) panel.appendChild(make('div', 'chip-row'));
        renderChips(panel.firstChild as HTMLElement, chips);
    }

    private renderProduction(live: Live): void {
        const { view, you, rates, now } = live;
        const { target } = view.settings;
        const me = view.players.find(player => player.seat === live.seat);
        setText(el('match-timer'), `${live.spectating ? 'Spectating · ' : ''}${formatClock(now)}`);
        setText(el('phones-count'), formatExact(you.phonesMade));
        el('phones-count').title = formatExact(you.phonesMade);
        setText(el('phones-target'), formatExact(target));
        const percent = Math.min(100, you.phonesMade / target * 100);
        el('progress-fill').style.width = `${percent}%`;
        el('progress').setAttribute('aria-valuenow', String(Math.floor(percent)));
        setText(el('rank-badge'), `${ORDINALS[(me?.rank ?? 1) - 1]} of ${view.players.length}`);
        setText(el('stat-pps'), `${formatNumber(rates.effectivePps)} PPS`);
        setText(el('stat-normal'), rates.sabotaged ? `normal ${formatNumber(rates.prePps)}` : 'phones per second');
        setText(el('stat-cash'), formatMoney(you.cash));
        setText(el('stat-price'), `${formatMoney(rates.salePrice)} per phone`);
        setText(el('stat-research'), formatNumber(you.research));
        setText(el('stat-influence'), `${Math.floor(you.influence)} / 100`);
        el('influence-fill').style.width = `${you.influence}%`;

        const chips: Array<Chip> = [];
        for (const debuff of you.debuffs.filter(entry => entry.expiresAt > now))
            chips.push({
                text: `${abilityById(debuff.abilityId)?.name ?? 'Attack'} -${formatPercent(debuff.slow)} ${debuff.kind === 'pps' ? 'PPS' : 'cash'} ${formatSeconds(debuff.expiresAt - now)}`,
                kind: 'danger',
                tip: debuff.kind === 'pps' ? 'A rival attack is slowing your phone production until it expires.'
                    : 'A rival attack is reducing the cash you earn per phone until it expires.'
            });
        for (const shield of you.shields.filter(entry => entry.until > now))
            chips.push({
                text: `${abilityById(shield.abilityId)?.name ?? 'Shield'} ${formatSeconds(shield.until - now)}`, kind: 'safe',
                tip: 'Your active defense is weakening or blocking incoming attacks.'
            });
        if (you.immuneUntil > now)
            chips.push({ text: `Immune ${formatSeconds(you.immuneUntil - now)}`, kind: 'safe', tip: 'New production attacks have no effect on you right now.' });
        renderChips(el('status-chips'), chips);
        el('screen-production').classList.toggle('is-attacked', rates.sabotaged);

        for (const player of view.players) {
            let entry = this.rows.get(player.seat);
            if (!entry) {
                const row = make('li', 'leader');
                const fill = make('span');
                const bar = make('div', 'progress thin');
                bar.appendChild(fill);
                const stats = make('small');
                const theme = companyTheme(player.companyId);
                const name = make('b', '', live.names[player.seat] ?? theme.name);
                row.append(companyIcon(theme), name, stats, bar);
                row.style.setProperty('--chip-color', theme.primary);
                el('leaderboard').appendChild(row);
                entry = { row, fill, stats };
                this.rows.set(player.seat, entry);
            }
            const phones = player.seat === live.seat ? you.phonesMade : player.phonesMade;
            entry.row.style.order = String(player.rank);
            entry.row.classList.toggle('is-you', player.seat === live.seat);
            entry.fill.style.width = `${Math.min(100, phones / target * 100)}%`;
            const seconds = (target - phones) / player.pps;
            const eta = player.pps > 0 && seconds < 6000 ? formatClock(seconds) : '—';
            setText(entry.stats, `${ORDINALS[player.rank - 1]} · ${formatNumber(player.pps)} PPS · ${eta}`);
        }

        const last = view.events[view.events.length - 1];
        if (last && last.id !== this.feedId) {
            this.feedId = last.id;
            el('event-feed').replaceChildren(...view.events.slice().reverse()
                .map(event => make('li', '', `${formatClock(event.at)} ${this.describeEvent(event, live.names)}`)));
        }
    }

    describeEvent(event: GameEvent, names: Array<string>): string {
        const who = names[event.seat] ?? 'A player';
        const target = names[event.target ?? -1] ?? 'a rival';
        const ability = abilityById(event.ref ?? '')?.name ?? '';
        if (event.type === 'project') return `${who} bought ${upgradeById(event.ref ?? '')?.name ?? ''}`;
        if (event.type === 'machine') return `${who} bought ${event.amount}× ${CONTENT.machines.find(m => m.id === event.ref)?.name ?? ''}`;
        if (event.type === 'defend') return `${who} used ${ability}`;
        if (event.type === 'shipment') return `${who} reached Final Shipment`;
        if (event.type === 'win') return `${who} won the match`;
        const outcomes: Record<string, string> = {
            landed: `${who} hit ${target} with ${ability}${event.slow ? ` (-${formatPercent(event.slow)}, ${formatSeconds(event.duration ?? 0)})` : ''}`,
            blocked: `${target} blocked ${ability} from ${who}`,
            whiff: `${ability} from ${who} hit a decoy at ${target}`,
            immune: `${target} was immune to ${ability} from ${who}`,
            weaker: `${ability} from ${who} was weaker than ${target}'s current debuff`,
            recon: `${who} scouted ${target}`,
            failed: `${who} failed to scout ${target}`
        };
        return outcomes[event.outcome ?? 'landed'] ?? '';
    }
}
