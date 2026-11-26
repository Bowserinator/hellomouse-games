import { entities } from '../../sim/entity/registry.js';
import { iconUrl, fontIcon } from './icons.js';
import { ENTITY as E, isActive, RENDER_AIMS, RENDER_ENTITY_WORDS, RENDER_ORDERS, RENDER_AIM_ACTIVE, RENDER_STORAGE_BONUS, zombieHp } from '../../sim/layout.js';
import { weapons } from '../../sim/weapon/registry.js';
import { GasEffect, projectiles, Motion } from '../../sim/projectile/registry.js';
import { BALANCE } from '../../sim/balance.js';
import { Q, TICK_HZ } from '../../sim/fixed.js';
import { type timeline } from '../../sim/timeline.js';
import { BUILD_ORDER, CRANES } from '../../sim/content/index.js';
import { VARIANTS } from '../../sim/variants.js';

export type ControlAction = 'move' | 'attackMove' | 'fire' | 'stop' | 'hold' | 'sell' | 'clear' | 'cancel';
type ObjectiveSelection = { name: string; hp: number };
type CraneUpgrade = ObjectiveSelection & {
    tier: number; target: number; queued: number; progress: number; held: boolean;
};
export class CommandBar {
    readonly element = document.createElement('div');
    onBuild?: (definition: number) => void;
    onUpgrade?: (tier: number, append: boolean) => void;
    onFilter?: (definition?: number) => void;
    onAction?: (action: ControlAction) => void;
    onPriority?: (mode: number, low: number, high: number) => void;
    private overview = document.createElement('div');
    private controls = document.createElement('div');
    private holdButton?: HTMLButtonElement;
    private sellButton?: HTMLButtonElement;
    private cards = document.createElement('div');
    private selectedUnits = document.createElement('div');
    private selectionKey = '';
    private upgrades = new Map<number, { button: HTMLButtonElement; badge: HTMLElement }>();
    private objective?: ObjectiveSelection;
    private upgrade?: CraneUpgrade;
    private buildTier = 0;
    private tabBar = document.createElement('div');
    private tabs: Array<HTMLButtonElement> = [];
    private zombieHover = 0;
    private zombieHpScale = 100;
    private zombieDamageScale = 100;
    private buttons = new Map<number, HTMLButtonElement>();
    private hoverName = document.createElement('div');
    private properties = document.createElement('div');
    private hovered?: number;
    private hoveredRow?: Int32Array;
    private objectiveHover?: ObjectiveSelection & { maxHp: number; clock?: ReturnType<typeof timeline> };
    private building?: number;
    private selectedRow?: Int32Array;
    private attacking = false;
    private shield = document.createElement('div');
    private selectedIcon = document.createElement('img');
    private healthFill = document.createElement('div');
    private healthText = document.createElement('span');
    private state = document.createElement('span');
    private priorityButton = document.createElement('button');
    private priorityMenu = document.createElement('div');
    private priorityOptions: Array<HTMLButtonElement> = [];
    private tier = 1;
    private controller = new AbortController();
    private saleDialog = document.createElement('dialog') as HTMLDialogElement & { showModal(): void; close(): void; open: boolean };
    private saleConfirm?: () => void;
    constructor(host: HTMLElement) {
        this.element.className = 'defense-controls'; this.element.setAttribute('role', 'toolbar');
        this.element.setAttribute('aria-label', 'Defense commands');
        this.hoverName.className = 'command-bar__hover';
        const info = document.createElement('div'), health = document.createElement('div');
        info.className = 'command-bar__info'; health.className = 'command-bar__health';
        this.selectedIcon.className = 'command-bar__selected-icon'; this.selectedIcon.alt = '';
        this.selectedIcon.hidden = true;
        this.healthFill.className = 'command-bar__health-fill';
        this.healthText.className = 'command-bar__health-text';
        this.state.className = 'command-bar__state command-bar__action';
        health.append(this.healthFill, this.healthText);
        this.shield.className = 'command-bar__shield';
        const details = document.createElement('div');
        details.className = 'command-bar__unit';
        const bars = document.createElement('div'); bars.className = 'command-bar__bars';
        bars.append(health, this.shield);
        info.append(this.selectedIcon, bars, this.state);
        details.append(this.hoverName, info);
        this.properties.className = 'command-bar__properties';
        this.overview.className = 'command-bar__overview'; this.overview.hidden = true;
        this.overview.append(details, this.properties);
        this.controls.className = 'command-bar__controls';
        const actions: Array<[string, ControlAction, string, string]> = [
            ['Move', 'move', '', 'arrow--right'], ['Attack move', 'attackMove', 'A', 'target'],
            ['Fire at', 'fire', 'F', 'target'], ['Stop', 'stop', 'S', 'stop--filled'],
            ['Hold fire', 'hold', 'Z', 'pause--filled'],
            ['Clear target', 'clear', 'C', 'close'], ['Sell', 'sell', 'Delete', 'currency--dollar']
        ];
        for (const [label, action, key, icon] of actions) {
            const button = this.button('', key ? `${label} (${key})` : label, () => this.onAction?.(action));
            button.className = 'command-bar__action'; button.append(this.actionIcon(icon));
            if (key) button.append(this.hotkeyBadge(key));
            button.setAttribute('data-action', action); this.controls.append(button);
            if (action === 'hold') {
                this.holdButton = button; button.setAttribute('aria-pressed', 'false');
            }
            if (action === 'sell') this.sellButton = button;
        }
        this.priorityButton = this.button('', 'Target priority (P)', () => {
            this.priorityMenu.hidden = !this.priorityMenu.hidden;
            this.priorityButton.setAttribute('aria-expanded', String(!this.priorityMenu.hidden));
        });
        this.priorityButton.className = 'command-bar__action'; this.priorityButton.setAttribute('data-action', 'priority');
        this.priorityButton.setAttribute('aria-haspopup', 'listbox'); this.priorityButton.setAttribute('aria-expanded', 'false');
        this.priorityButton.append(this.actionIcon('target'), this.hotkeyBadge('P'));
        this.priorityMenu.className = 'command-bar__priority'; this.priorityMenu.hidden = true;
        this.priorityMenu.setAttribute('role', 'listbox'); this.priorityMenu.setAttribute('aria-label', 'Target priority');
        for (const [index, name] of ['Nearest', 'Lowest HP', 'Highest HP', 'First along path'].entries()) {
            const option = this.button(name, name, () => {
                this.onPriority?.(index, 0, 0); this.closePriority(); this.priorityButton.focus();
            });
            option.append(this.hotkeyBadge(String(index + 1)));
            option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === 0));
            this.priorityOptions.push(option); this.priorityMenu.append(option);
        }
        this.controls.append(this.priorityButton, this.priorityMenu);
        window.addEventListener('pointerdown', event => {
            if (event.target instanceof Node && !this.controls.contains(event.target)) this.closePriority();
        }, { signal: this.controller.signal });
        const build = document.createElement('div'), tabs = this.tabBar;
        build.className = 'command-bar__build'; tabs.className = 'command-bar__tabs';
        for (const [index, label] of ['Tier I', 'Tier II', 'Tier III'].entries()) {
            const tier = index + 1;
            const tab = this.button(label, `${label} (F${tier})`, () => this.showTier(tier));
            this.tabs.push(tab); tabs.append(tab);
        }
        const upgrades = this.button('Upgrades', 'Upgrades', () => this.showTier(4));
        this.tabs.push(upgrades); tabs.append(upgrades);
        this.cards.className = 'command-bar__cards';
        BUILD_ORDER.forEach(id => {
            const definition = entities[id];
            const card = this.button('', definition.name, () => this.onBuild?.(id));
            card.className = 'command-bar__card';
            const icon = document.createElement('img');
            icon.src = iconUrl(definition.name); icon.alt = ''; icon.width = 64; icon.height = 64;
            card.addEventListener('pointerenter', () => this.hover(definition.name));
            card.addEventListener('pointerleave', () => this.hover());
            card.append(icon); this.cards.append(card); this.buttons.set(id, card);
        });
        for (const tier of [2, 3]) {
            const name = `T${tier} Upgrade`;
            const button = this.button('', name, () => {});
            button.onclick = event => this.onUpgrade?.(tier, event.shiftKey);
            button.className = 'command-bar__card';
            const icon = document.createElement('img');
            icon.src = iconUrl(name); icon.alt = ''; icon.width = 64; icon.height = 64;
            const badge = this.hotkeyBadge('');
            button.append(icon, badge); this.cards.append(button); this.upgrades.set(tier, { button, badge });
        }
        this.selectedUnits.className = 'command-bar__cards';
        build.append(tabs, this.cards, this.selectedUnits);
        const commands = document.createElement('div'); commands.className = 'command-bar__commands';
        commands.append(this.controls, build);
        const bar = document.createElement('div'); bar.className = 'command-bar'; bar.append(commands);
        this.element.append(this.overview, bar); host.append(this.element, this.saleDialog);
        this.saleDialog.className = 'command-bar__sale';
        this.saleDialog.setAttribute('aria-labelledby', 'sale-heading');
        this.saleDialog.addEventListener('keydown', event => event.stopPropagation(), { signal: this.controller.signal });
        this.saleDialog.addEventListener('close', () => {
            this.saleConfirm = undefined;
        }, { signal: this.controller.signal });
        this.selection([]);
        window.addEventListener('keydown', event => {
            if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat ||
                event.target instanceof HTMLElement &&
                (event.target.matches('input, select, textarea') || event.target.isContentEditable)) return;
            const key = event.key.toLowerCase();
            const tier = ['f1', 'f2', 'f3'].indexOf(key);
            if (tier >= 0) {
                if (tier + 1 <= this.buildTier) {
                    this.showTier(tier + 1); event.preventDefault();
                }
                return;
            }
            const hotkey = Number(key) - 1;
            if (!this.priorityMenu.hidden && this.priorityOptions[hotkey]) {
                this.priorityOptions[hotkey].click(); event.preventDefault(); return;
            }
            const action = actions.find(([, , binding]) => binding.toLowerCase() === (key === ' ' ? 'space' : key));
            if (action) {
                this.onAction?.(action[1]); event.preventDefault();
            }
            if (key === 'p') {
                this.priorityButton.click(); event.preventDefault();
            }
            if (key === 'escape') {
                this.closePriority(); this.onAction?.('cancel');
            }
        }, { signal: this.controller.signal });
    }
    confirmSale(groups: Array<{ definition: number; count: number }>, refund: number, confirm: () => void) {
        if (this.saleDialog.open || !groups.length) return;
        this.saleConfirm = confirm; this.closePriority();
        const heading = document.createElement('h2'), icons = document.createElement('div');
        heading.id = 'sale-heading';
        heading.textContent = `Are you sure you want to sell these units for $${refund}?`;
        icons.className = 'command-bar__sale-units';
        for (const { definition, count } of groups) {
            const item = document.createElement('div'), icon = document.createElement('img');
            item.className = 'command-bar__sale-unit';
            icon.src = iconUrl(entities[definition].name); icon.width = 48; icon.height = 48;
            icon.alt = `${entities[definition].name} × ${count}`; item.title = icon.alt;
            item.append(icon);
            if (count > 1) item.append(this.hotkeyBadge(String(count)));
            icons.append(item);
        }
        const actions = document.createElement('div'); actions.className = 'command-bar__sale-actions';
        const cancel = this.button('Cancel', 'Cancel sale', () => this.saleDialog.close());
        cancel.setAttribute('autofocus', '');
        const sell = this.button('Sell', 'Confirm sale', () => {
            const action = this.saleConfirm; this.saleConfirm = undefined;
            this.saleDialog.close(); action?.();
        });
        actions.append(cancel, sell); this.saleDialog.replaceChildren(heading, icons, actions);
        this.saleDialog.showModal();
    }
    private button(label: string, title: string, click: () => void) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = label; button.title = title; button.setAttribute('aria-label', title);
        button.onclick = click; return button;
    }
    private hotkeyBadge(key: string) {
        const badge = document.createElement('span'); badge.className = 'command-bar__hotkey';
        badge.textContent = key === 'Delete' ? 'Del' : key; badge.setAttribute('aria-hidden', 'true'); return badge;
    }
    private closePriority() {
        this.priorityMenu.hidden = true; this.priorityButton.setAttribute('aria-expanded', 'false');
    }
    private actionIcon(name: string) {
        const icon = document.createElement('span'); icon.className = 'command-bar__action-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.style.setProperty('--action-icon', `url("${new URL(`../../../img/action-icons/${name}.svg`, import.meta.url)}")`);
        return icon;
    }
    private showTier(tier: number) {
        const available = (level: number) => this.buildTier >= level;
        if (tier === 4 && !this.upgrade || tier <= 3 && !available(tier)) tier = this.upgrade ? 4 : 1;
        this.tier = tier;
        this.tabBar.hidden = !this.buildTier && !this.upgrade;
        this.tabs.forEach((tab, i) => {
            tab.disabled = i === 3 ? !this.upgrade : !available(i + 1);
            tab.setAttribute('aria-pressed', String(!tab.disabled && i + 1 === tier));
        });
        for (const [id, button] of this.buttons) {
            const definition = entities[id];
            button.hidden = definition.tier !== tier || definition.tier > this.buildTier;
        }
        for (const [level, { button, badge }] of this.upgrades) {
            const crane = this.upgrade;
            button.hidden = tier !== 4 || !crane;
            button.disabled = !crane || crane.tier >= level;
            if (!crane) continue;
            const active = level === crane.tier + 1 && level <= crane.target;
            const total = entities[CRANES[level - 1]].options.buildSeconds * TICK_HZ * 256;
            const progress = Math.floor(crane.progress / total * 100);
            const pending = level <= Math.max(crane.target, crane.queued);
            badge.textContent = active ? `${progress}%` : crane.tier >= level ? '✓' : pending ? '…' : '';
        }
        this.cards.hidden = !this.buildTier && !this.upgrade;
        this.selectedUnits.hidden = !!this.buildTier || !!this.upgrade || !this.selectionKey;
    }
    hoverZombie(packed: number, hpScale: number, damageScale: number) {
        this.zombieHover = packed;
        this.zombieHpScale = hpScale;
        this.zombieDamageScale = damageScale;
        this.refresh();
    }
    hoverObjective(objective: ObjectiveSelection, maxHp: number, clock?: ReturnType<typeof timeline>) {
        this.zombieHover = 0;
        this.hovered = undefined; this.hoveredRow = undefined;
        this.objectiveHover = { ...objective, maxHp, clock }; this.refresh();
    }
    hover(name = '', row?: Int32Array) {
        this.zombieHover = 0;
        this.objectiveHover = undefined;
        const id = entities.findIndex(definition => definition.name === name);
        this.hovered = id < 0 ? undefined : id; this.hoveredRow = row; this.refresh();
    }
    selection(rows: ReadonlyArray<Int32Array>, attacking = false, objective?: ObjectiveSelection,
        crane?: CraneUpgrade) {
        const row = rows[0];
        const allBuilders = rows.every(unit => !!entities[unit[E.def]].options.buildPower);
        this.selectedRow = row; this.attacking = attacking; this.objective = objective;
        this.upgrade = allBuilders && !objective ? crane : undefined;
        if (this.sellButton) this.sellButton.disabled = objective !== undefined || !rows.length;
        this.buildTier = allBuilders ? rows.reduce((tier, unit) => {
            const def = entities[unit[E.def]];
            return isActive(unit) && !(unit[E.upgradeTarget] > def.tier) ? Math.max(tier, def.tier) : tier;
        }, 0) : 0;
        if (!this.buildTier) {
            const counts = new Map<number | undefined, number>();
            if (objective) counts.set(undefined, 1);
            for (const unit of rows) counts.set(unit[E.def], (counts.get(unit[E.def]) ?? 0) + 1);
            const key = [...counts].map(([id, count]) => `${id}:${count}`).join(',');
            if (key !== this.selectionKey) {
                this.selectionKey = key;
                this.selectedUnits.replaceChildren(...[...counts].map(([id, count]) => {
                    const name = id === undefined ? 'Defense objective' : entities[id].name;
                    const card = this.button('', name, () => this.onFilter?.(id));
                    const icon = document.createElement('img');
                    card.className = 'command-bar__card command-bar__selection';
                    icon.src = iconUrl(name); icon.alt = count > 1 ? `${name} × ${count}` : name;
                    card.title = icon.alt; card.append(icon);
                    if (count > 1) card.append(this.hotkeyBadge(String(count)));
                    return card;
                }));
            }
        }
        this.showTier(this.tier);
        const priority = row ? row[E.flags] >>> 1 & 3 : 0;
        this.priorityOptions.forEach((option, index) => option.setAttribute('aria-selected', String(index === priority)));
        const held = !!row && (row[E.flags] & 1) !== 0;
        const builder = !!this.upgrade || this.buildTier > 0;
        const action = this.upgrade && this.upgrade.target > this.upgrade.tier ? 'upgrade' : builder ? 'build' : 'fire';
        const title = `${held ? 'Resume' : 'Hold'} ${action} (Z)`;
        if (this.holdButton && this.holdButton.title !== title) {
            this.holdButton.setAttribute('aria-pressed', String(held));
            this.holdButton.replaceChildren(builder ? fontIcon(held ? 'construction' : 'pause_circle')
                : this.actionIcon(held ? 'play--filled' : 'pause--filled'), this.hotkeyBadge('Z'));
            this.holdButton.title = title;
            this.holdButton.setAttribute('aria-label', this.holdButton.title);
        }
        this.refresh();
    }
    private showHealth(hp: number, maxHp: number, rate = '') {
        this.healthFill.style.width = `${Math.max(0, Math.min(100, hp / maxHp * 100))}%`;
        this.healthText.textContent = `${Math.max(0, hp)} / ${maxHp} HP${rate}`;
    }
    private property(text: string, kind?: 'money' | 'power' | 'weapon' | 'description') {
        const item = document.createElement('span');
        if (kind) item.className = `command-bar__${kind}`;
        item.textContent = text;
        return item;
    }
    private refresh() {
        const metres = (distance: number) => `${Math.round(distance * 10 / Q) / 10}m`;
        const zombie = VARIANTS[this.zombieHover & 255], zombieHealth = zombieHp(this.zombieHover);
        if (zombie && zombieHealth) {
            const projectile = zombie.ability.kind ? projectiles[zombie.ability.pack()[0]] : undefined;
            const attack = projectile?.name ?? 'Melee';
            const damage = Math.round((projectile?.damage ?? zombie.damage) * this.zombieDamageScale / 100);
            const timing = zombie.ability.kind === 2 ? ' · On detonation' : ` · Every ${zombie.attackCooldown / TICK_HZ} s`;
            this.overview.hidden = false; this.properties.hidden = false;
            this.selectedIcon.hidden = true; this.shield.hidden = true;
            this.hoverName.textContent = zombie.name[0].toUpperCase() + zombie.name.slice(1);
            this.properties.replaceChildren(this.property(`${attack} · ${damage} damage${timing}`, 'weapon'),
                '\n', this.property(`${metres(zombie.attackRange)} range`, 'weapon'));
            this.showHealth(zombieHealth, Math.round(zombie.maxHp * this.zombieHpScale / 100));
            this.state.textContent = ''; this.state.title = '';
            this.state.removeAttribute('aria-label'); this.state.removeAttribute('data-action');
            return;
        }
        const showObjective = this.hovered === undefined && this.building === undefined && this.objective;
        const objective = this.objectiveHover ?? (showObjective
            ? { ...showObjective, maxHp: BALANCE.objective.hp, clock: undefined } : undefined);
        if (objective) {
            const { name, hp, maxHp, clock } = objective;
            this.overview.hidden = false; this.selectedIcon.hidden = false;
            this.selectedIcon.src = iconUrl('Defense objective');
            this.shield.hidden = true;
            this.properties.hidden = true;
            const title = name || 'Defense objective';
            const seconds = clock?.seconds ?? 0;
            const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
            this.hoverName.textContent = clock && clock.phase !== 'over'
                ? `${title} (${clock.phase === 'prep' ? 'Waves start in' : 'Time remaining'} ${time})` : title;
            this.showHealth(hp, maxHp, ' (+0/s)');
            this.showState('idle', 'asleep', 'Idle');
            return;
        }
        const id = this.hovered ?? this.building ?? this.selectedRow?.[E.def];
        let row = this.selectedRow;
        if (this.building !== undefined) row = undefined;
        if (this.hovered !== undefined) row = this.hoveredRow;
        if (id !== undefined && !row) {
            row = new Int32Array(RENDER_ENTITY_WORDS); row[E.def] = id; row[E.hp] = entities[id].maxHp;
            row[E.power] = entities[id].options.power ?? 0; row[E.state] = 1;
        }
        this.overview.hidden = !row;
        this.selectedIcon.hidden = !row;
        this.properties.hidden = !row; this.shield.hidden = true;
        if (!row) {
            this.hoverName.textContent = ''; this.properties.textContent = '';
            this.healthText.textContent = ''; this.healthFill.setAttribute('style', 'width: 0%');
            this.state.textContent = ''; return;
        }
        const definition = entities[row[E.def]], hp = Math.max(0, row[E.hp]);
        this.hoverName.textContent = definition.name;
        this.selectedIcon.src = iconUrl(definition.name);
        const properties: Array<string | HTMLElement> = (definition.options.weapons ?? []).map(mount => {
            const weapon = weapons[mount.definition], projectile = projectiles[weapon.projectile];
            if (weapon.fire.kind === 3)
                return `${weapon.name} · ${weapon.fire.pack()[0]} intercepts / ${weapon.cooldown / 20} s · ${metres(weapon.maxRange)}`;
            const effect = projectile.effects?.[0];
            const scale = weapon.damageScalePct;
            const cloudDamage = effect instanceof GasEffect ? Math.trunc(effect.damage * scale / 100) : 0;
            const damage = Math.trunc(projectile.damage * scale / 100) + cloudDamage;
            const dps = damage * (projectile.motion === Motion.Beam ? TICK_HZ : TICK_HZ / weapon.cooldown);
            if (projectile.execute) return `${weapon.name} · One hit · ${metres(weapon.maxRange)} · ${weapon.cooldown / 20} s`;
            return `${weapon.name} (${Math.round(dps)} DPS) · ${metres(weapon.maxRange)}`;
        }).map(text => this.property(text, 'weapon'));
        if (definition.kind === 4) {
            const power = Math.max(0, row[E.power]), maximum = definition.options.power ?? 0;
            this.shield.hidden = false;
            this.shield.textContent = `${power} / ${maximum} (+0/s)`;
            this.shield.style.setProperty('--shield', `${maximum ? power / maximum * 100 : 0}%`);
            properties.push(this.property(`Sonic Emitter · ${metres(definition.options.radius ?? 0)}`, 'description'));
        }
        if (definition.options.speed) properties.push(this.property(`${definition.options.speed / Q} m/s`, 'description'));
        if (definition.options.flightHeight) properties.push(this.property(`${metres(definition.options.flightHeight)} altitude`, 'description'));
        if (definition.options.runoverDamage) properties.push(this.property(`${definition.options.runoverDamage * 20} contact DPS`, 'weapon'));
        if (definition.kind === 6) {
            const blast = projectiles[definition.options.projectile ?? 0];
            properties.push(this.property(`${blast.damage} damage · ${metres(blast.splashRadius)} blast`, 'weapon'));
        }
        const drain = definition.options.energyDrain;
        if (drain) properties.push(this.property(`-${drain.perSecond} energy/s`, 'power'));
        const bonuses = row[RENDER_STORAGE_BONUS];
        for (const [name, storage] of [['money', bonuses & 15], ['power', (bonuses >>> 4) & 15]] as const) {
            const base = definition.options.income?.[name];
            if (!base) continue;
            const bonus = storage * 0.125;
            const output = row[E.state] === 2 ? 0 : base * (1 + bonus);
            properties.push(this.property(`${Math.round(output)} ${name}/s${bonus ? ` (+${bonus * 100}% adjacency)` : ''}`, name));
        }
        const costs = document.createElement('div'); costs.className = 'command-bar__costs';
        const values = [
            ['Money', 'payments', definition.options.cost.money, 'money'],
            ['Power', 'bolt', definition.options.cost.power, 'power'],
            ['Build seconds', 'timer', definition.options.buildSeconds, undefined]
        ] as const;
        for (const [label, icon, value, kind] of values) {
            if (icon === 'timer' && definition.kind === 6) continue;
            const item = this.property(String(value), kind);
            item.setAttribute('aria-label', `${label}: ${value}`);
            item.title = label; item.prepend(fontIcon(icon)); costs.append(item);
        }
        if (row[E.state] === 2)
            properties.unshift(`${Math.floor(row[E.progress] / (Math.max(1, definition.options.buildSeconds * 20) * 256) * 100)}% complete`);
        if (definition.options.buildPower) properties.push(this.property(`${definition.options.buildPower} build power`, 'description'));
        this.properties.replaceChildren(costs, ...properties.flatMap((line, index) => index ? ['\n', line] : [line]));
        this.properties.hidden = false;
        this.showHealth(hp, definition.maxHp, ' (+0/s)');
        const kind = row[RENDER_ORDERS];
        let action = 'idle', icon = 'asleep', title = 'Idle';
        if (row[E.state] === 2) {
            action = 'hold'; icon = 'pause--filled'; title = 'Under construction';
        } else if (row[E.state] === 3) {
            action = 'hold'; icon = 'pause--filled'; title = 'Recharging';
        } else if (row[E.speed] > 0) {
            action = 'move'; icon = 'arrow--right'; title = 'Move';
        } else if (this.attacking && row.buffer === this.selectedRow?.buffer &&
            row.byteOffset === this.selectedRow.byteOffset ||
            row.subarray(RENDER_AIMS, RENDER_ORDERS).some(aim => (aim & RENDER_AIM_ACTIVE) !== 0) ||
            row[E.orderCount] > 0 && (kind === 1 || kind === 2 || kind === 3)) {
            action = 'fire'; icon = 'target'; title = 'Attack';
        } else if ((row[E.flags] & 1) !== 0) {
            action = 'hold'; icon = 'pause--filled';
            title = definition.options.buildPower ? 'Hold build' : 'Hold fire';
        }
        this.showState(action, icon, title);
    }
    private showState(action: string, icon: string, title: string) {
        if (this.state.title !== title || !this.state.firstChild) {
            this.state.textContent = ''; this.state.append(this.actionIcon(icon));
            this.state.title = title; this.state.setAttribute('aria-label', title);
            this.state.setAttribute('data-action', action);
        }
    }
    armed(id?: number) {
        this.building = id; this.refresh();
        for (const [definition, button] of this.buttons)
            button.setAttribute('aria-pressed', String(id === definition));
    }
    destroy() {
        this.saleConfirm = undefined;
        if (this.saleDialog.open) this.saleDialog.close();
        this.controller.abort(); this.saleDialog.remove(); this.element.remove();
    }
}
