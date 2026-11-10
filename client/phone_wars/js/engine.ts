/** Deterministic rules for a Phone Wars match: production, purchases, sabotage and victory. */
import { GAME_CONFIG, targetScale, thresholdScale, tierMilestone } from './config.js';
import { CONTENT } from './upgrades.js';
import type {
    AttackCategory, Ability, Action, ActionResult, Content, Context, Cost, Effect, EffectType, GameEvent,
    Lane, Machine, MatchState, PlayerState, PublicPlayer, Rates, Settings, Upgrade, View
} from './types.js';

const LANES: Array<Lane> = ['economy', 'defense', 'offense'];
const UPGRADES = new Map(CONTENT.upgrades.map(upgrade => [upgrade.id, upgrade]));
const ABILITIES = new Map(CONTENT.abilities.map(ability => [ability.id, ability]));
const MACHINES = new Map(CONTENT.machines.map(machine => [machine.id, machine]));
const FAILURE = (error: string): ActionResult => ({ ok: false, error });
const SUCCESS: ActionResult = { ok: true };

export const upgradeById = (id: string): Upgrade | undefined => UPGRADES.get(id);
export const abilityById = (id: string): Ability | undefined => ABILITIES.get(id);
export const machineById = (id: string): Machine | undefined => MACHINES.get(id);

export function createMatchState(settings: Settings, companies: Array<string>): MatchState {
    const { starting } = GAME_CONFIG;
    return {
        settings: { ...settings },
        players: companies.map((companyId, seat) => ({
            seat, companyId,
            phonesMade: starting.phonesMade, lifetimeCash: 0, cash: starting.cash,
            research: starting.research, influence: starting.influence,
            smoothPps: 0, clicks: 0, clickBudget: GAME_CONFIG.clickBurst, lastClickAt: 0,
            machines: Object.fromEntries(CONTENT.machines.map(machine => [machine.id, 0])),
            owned: [], readyAt: {}, offenseReadyAt: 0,
            debuffs: [], shields: [], hits: [], immuneUntil: 0
        })),
        time: 0, rngState: settings.seed >>> 0, nextEventId: 1, events: [],
        shipmentSeat: -1, winner: -1, placements: []
    };
}

function random(state: MatchState): number {
    state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
    let t = state.rngState;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

function ownedEffects(player: PlayerState): Array<Effect> {
    const effects: Array<Effect> = [];
    for (const id of player.owned)
        effects.push(...UPGRADES.get(id)?.effects ?? []);
    return effects;
}

/** Effects sharing a stack group add their bonuses, every other effect multiplies. */
function stackedFactor(effects: Array<Effect>, type: EffectType, machine?: string): number {
    const groups = new Map<string, number>();
    let product = 1;
    for (const effect of effects) {
        if (effect.type !== type || effect.factor === undefined) continue;
        if (machine !== undefined && effect.machineCategory !== machine) continue;
        if (effect.stackGroup === undefined) product *= effect.factor;
        else groups.set(effect.stackGroup, (groups.get(effect.stackGroup) ?? 0) + effect.factor - 1);
    }
    for (const bonus of groups.values()) product *= 1 + bonus;
    return product;
}

function activeSlow(debuffs: PlayerState['debuffs'], time: number, kind: 'pps' | 'revenue'): number {
    let remaining = 1;
    for (const debuff of debuffs)
        if (debuff.kind === kind && debuff.expiresAt > time) remaining *= 1 - debuff.slow;
    return 1 - remaining;
}

export function mitigationOf(player: PlayerState): number {
    let total = 0;
    for (const effect of ownedEffects(player))
        if (effect.type === 'add_mitigation') total += effect.fraction ?? 0;
    return Math.min(GAME_CONFIG.sabotage.passiveMitigationCap, total);
}

export function computeRates(player: PlayerState, time: number, moneyMultiplier = 1): Rates {
    const effects = ownedEffects(player);
    const { sabotage, starting } = GAME_CONFIG;
    const mitigation = mitigationOf(player);
    const sabotaged = player.debuffs.some(debuff => debuff.kind === 'pps' && debuff.expiresAt > time);
    const slow = Math.min(sabotage.maxPpsSlow, activeSlow(player.debuffs, time, 'pps') * (1 - mitigation));
    const revenueSlow = Math.min(sabotage.revenueSlowCap, activeSlow(player.debuffs, time, 'revenue') * (1 - mitigation));

    let machinePps = 0, labRps = 0;
    for (const machine of CONTENT.machines) {
        const count = player.machines[machine.id] ?? 0;
        machinePps += count * machine.basePps * stackedFactor(effects, 'multiply_machine_category', machine.category);
        labRps += count * machine.baseRps;
    }
    const production = stackedFactor(effects, 'multiply_production') *
        (sabotaged ? stackedFactor(effects, 'multiply_while_sabotaged') : 1);
    const autoPps = machinePps * stackedFactor(effects, 'multiply_auto_production');
    const prePps = autoPps * production;
    const flatClicks = effects.reduce((sum, effect) => sum + (effect.type === 'add_manual_click' ? effect.count ?? 0 : 0), 0);

    return {
        autoPps, prePps, slow, revenueSlow, mitigation, sabotaged,
        effectivePps: prePps * (1 - slow),
        salePrice: starting.salePrice * stackedFactor(effects, 'multiply_sale_price') * (1 - revenueSlow) * moneyMultiplier,
        clickPhones: (starting.manualPhonesPerClick + flatClicks) * production * (1 - slow),
        rps: labRps * stackedFactor(effects, 'multiply_research_rate')
    };
}

export function contextOf(state: MatchState): Context {
    return {
        settings: state.settings,
        leaderPhones: state.players.reduce((best, player) => Math.max(best, player.phonesMade), 0)
    };
}

function isBehind(player: PlayerState, context: Context): boolean {
    return player.phonesMade < context.leaderPhones * GAME_CONFIG.catchup.behindLeaderFraction;
}

export function projectCost(upgrade: Upgrade, player: PlayerState, context: Context): Cost {
    const scale = upgrade.tier >= 2 ? targetScale(context.settings.target) : 1;
    const discount = upgrade.lane === 'economy' && isBehind(player, context)
        ? 1 - GAME_CONFIG.catchup.economyProjectDiscount : 1;
    const { cash, research } = upgrade.purchase;
    return {
        ...cash === undefined ? {} : { cash: Math.round(cash * scale * discount) },
        ...research === undefined ? {} : { research }
    };
}

export function abilityCost(ability: Ability, settings: Settings): Cost {
    const tier = UPGRADES.get(ability.sourceUpgradeId)?.tier ?? 1;
    const { cash, influence } = ability.activation;
    return {
        ...cash === undefined ? {} : { cash: Math.round(cash * (tier >= 2 ? targetScale(settings.target) : 1)) },
        ...influence === undefined ? {} : { influence }
    };
}

export function canAfford(player: PlayerState, cost: Cost): boolean {
    return player.cash >= (cost.cash ?? 0) && player.research >= (cost.research ?? 0) &&
        player.influence >= (cost.influence ?? 0);
}

function spend(player: PlayerState, cost: Cost): void {
    player.cash -= cost.cash ?? 0;
    player.research -= cost.research ?? 0;
    player.influence -= cost.influence ?? 0;
}

export function ownedInTier(player: PlayerState, lane: Lane, tier: number): number {
    return player.owned.filter(id => {
        const upgrade = UPGRADES.get(id);
        return upgrade?.lane === lane && upgrade.tier === tier;
    }).length;
}

export function visibleTier(player: PlayerState, lane: Lane, settings: Settings): number {
    let tier = 1;
    while (tier < 5 && ownedInTier(player, lane, tier) >= 2 &&
        player.phonesMade >= tierMilestone(settings.target, tier + 1)) tier++;
    return tier;
}

export type ProjectLock =
    | { kind: 'phones'; amount: number }
    | { kind: 'projects'; amount: number }
    | { kind: 'requires'; ids: Array<string> }
    | { kind: 'peaceful' };

export function projectLock(player: PlayerState, upgrade: Upgrade, settings: Settings): ProjectLock | null {
    if (upgrade.lane === 'offense' && settings.mode === 'peaceful') return { kind: 'peaceful' };
    if (upgrade.tier > visibleTier(player, upgrade.lane, settings)) {
        const milestone = tierMilestone(settings.target, upgrade.tier);
        if (player.phonesMade < milestone) return { kind: 'phones', amount: milestone };
        return { kind: 'projects', amount: 2 - ownedInTier(player, upgrade.lane, upgrade.tier - 1) };
    }
    const missing = upgrade.requires?.filter(id => !player.owned.includes(id)) ?? [];
    return missing.length ? { kind: 'requires', ids: missing } : null;
}

export function machinePrice(machine: Machine, owned: number): number {
    return Math.round(machine.baseCost * machine.growth ** owned);
}

export function machineUnlockAt(machine: Machine, settings: Settings): number {
    return Math.round(machine.unlock * thresholdScale(settings.target));
}

export function quantityCost(machine: Machine, owned: number, quantity: number): number {
    let total = 0;
    for (let i = 0; i < quantity; i++) total += machinePrice(machine, owned + i);
    return total;
}

export function maxQuantity(machine: Machine, owned: number, cash: number): number {
    let quantity = 0, total = 0;
    while (quantity < GAME_CONFIG.maximumBuyQuantity) {
        total += machinePrice(machine, owned + quantity);
        if (total > cash) break;
        quantity++;
    }
    return quantity;
}

export function previewPpsGain(player: PlayerState, upgrade: Upgrade, time: number): number {
    const before = computeRates(player, time).effectivePps;
    const after = computeRates({ ...player, owned: [...player.owned, upgrade.id] }, time).effectivePps;
    return after - before;
}

export interface AbilityStatus {
    unlocked: boolean;
    cooldownLeft: number;
    globalLeft: number;
}

export function abilityStatus(player: PlayerState, ability: Ability, time: number): AbilityStatus {
    return {
        unlocked: player.owned.includes(ability.sourceUpgradeId),
        cooldownLeft: Math.max(0, (player.readyAt[ability.id] ?? 0) - time),
        globalLeft: ability.kind === 'attack' ? Math.max(0, player.offenseReadyAt - time) : 0
    };
}

export function pressureOn(player: PlayerState, time: number, except = -1): number {
    const window = GAME_CONFIG.sabotage.antiDogpileWindowSec;
    const attackers = new Set<number>();
    for (const hit of player.hits)
        if (hit.kind === 'pps' && hit.attacker !== except && time - hit.at < window) attackers.add(hit.attacker);
    return attackers.size;
}

function pushEvent(state: MatchState, event: Omit<GameEvent, 'id' | 'at'>): void {
    state.events.push({ id: state.nextEventId++, at: state.time, ...event });
    if (state.events.length > GAME_CONFIG.eventHistory)
        state.events.splice(0, state.events.length - GAME_CONFIG.eventHistory);
}

function durationFactor(defender: PlayerState, category: AttackCategory): number {
    let factor = 1;
    for (const effect of ownedEffects(defender))
        if (effect.type === 'reduce_attack_duration' && (!effect.category || effect.category === category))
            factor *= 1 - (effect.fraction ?? 0);
    return Math.max(GAME_CONFIG.sabotage.minimumDurationFraction, factor);
}

function severityFactor(defender: PlayerState, category: AttackCategory, time: number): number {
    let factor = 1;
    for (const effect of ownedEffects(defender))
        if (effect.type === 'reduce_attack_severity' && (!effect.category || effect.category === category))
            factor *= 1 - (effect.fraction ?? 0);
    for (const shield of defender.shields)
        if (shield.kind === 'mitigation' && shield.until > time) factor *= 1 - shield.fraction;
    return factor;
}

function bonusDuration(attacker: PlayerState, base: number): number {
    let extra = 0;
    for (const effect of ownedEffects(attacker))
        if (effect.type === 'modify_attack_duration')
            extra += Math.min(effect.capSec ?? Infinity, base * (effect.fraction ?? 0));
    return extra;
}

export function heistFraction(attackerPhones: number, targetPhones: number): number {
    const { heist } = GAME_CONFIG;
    if (targetPhones <= attackerPhones) return heist.behindFraction;
    const ratio = attackerPhones > 0 ? targetPhones / attackerPhones : Infinity;
    return Math.min(heist.maxFraction, heist.aheadBaseFraction * (1 + Math.log(ratio)));
}

export function heistShare(attackerPhones: number, targetPhones: number, targetTheftFactor: number): number {
    return heistFraction(attackerPhones, targetPhones) * targetTheftFactor;
}

export function theftFactor(defender: PlayerState): number {
    let factor = 1;
    for (const effect of ownedEffects(defender))
        if (effect.type === 'reduce_theft') factor *= 1 - (effect.fraction ?? 0);
    return factor;
}

function stealPhones(state: MatchState, attacker: PlayerState, target: PlayerState,
    base: Pick<GameEvent, 'seat' | 'target' | 'ref'>): boolean {
    const stolen = target.phonesMade * heistShare(attacker.phonesMade, target.phonesMade, theftFactor(target));
    if (stolen <= 0) {
        pushEvent(state, { type: 'attack', outcome: 'failed', ...base });
        return false;
    }
    const earned = stolen * computeRates(attacker, state.time, state.settings.moneyMultiplier).salePrice;
    target.phonesMade -= stolen;
    attacker.phonesMade += stolen;
    attacker.cash += earned;
    attacker.lifetimeCash += earned;
    pushEvent(state, { type: 'attack', outcome: 'stolen', amount: stolen, ...base });
    resolveVictory(state);
    return true;
}

function resolveAttack(state: MatchState, attacker: PlayerState, target: PlayerState,
    ability: Ability, activationCash: number): void {
    const time = state.time, { sabotage } = GAME_CONFIG;
    const base = { seat: attacker.seat, target: target.seat, ref: ability.id };

    const grid = target.shields.findIndex(shield => shield.kind === 'block' && shield.until > time);
    if (grid >= 0) {
        target.shields.splice(grid, 1);
        pushEvent(state, { type: 'attack', outcome: 'blocked', ...base });
        return;
    }
    const whiff = ownedEffects(target).find(effect => effect.type === 'whiff_chance');
    if (whiff && random(state) < (whiff.chance ?? 0)) {
        pushEvent(state, { type: 'attack', outcome: 'whiff', ...base });
        return;
    }

    const targetAhead = target.phonesMade > attacker.phonesMade;
    let landed = ability.effects.some(effect => effect.type === 'steal_phones') &&
        stealPhones(state, attacker, target, base);
    for (const effect of ability.effects) {
        const kind = effect.type === 'activate_slow' ? 'pps' : effect.type === 'activate_revenue_slow' ? 'revenue' : null;
        if (!kind) continue;
        const category = effect.category ?? 'marketing';
        if (kind === 'pps' && target.immuneUntil > time) {
            pushEvent(state, { type: 'attack', outcome: 'immune', ...base });
            continue;
        }
        const repeated = target.hits.some(hit => hit.attacker === attacker.seat &&
            time - hit.at < sabotage.repeatTargetWindowSec);
        const crowd = sabotage.antiDogpileMultipliers[Math.min(pressureOn(target, time, attacker.seat),
            sabotage.antiDogpileMultipliers.length - 1)];
        const slow = (effect.fraction ?? 0) * (repeated ? sabotage.repeatTargetMultiplier : 1) *
            (kind === 'pps' ? crowd : 1) * severityFactor(target, category, time);
        const baseDuration = (effect.durationSec ?? 0);
        const duration = (baseDuration + bonusDuration(attacker, baseDuration)) * durationFactor(target, category);

        const existing = target.debuffs.find(debuff => debuff.attacker === attacker.seat &&
            debuff.kind === kind && debuff.expiresAt > time);
        if (existing && existing.slow >= slow) {
            pushEvent(state, { type: 'attack', outcome: 'weaker', ...base });
            continue;
        }
        target.debuffs = target.debuffs.filter(debuff => debuff !== existing);
        target.debuffs.push({
            attacker: attacker.seat, kind, abilityId: ability.id, category, slow, expiresAt: time + duration
        });
        target.hits.push({ attacker: attacker.seat, at: time, kind });
        pushEvent(state, { type: 'attack', outcome: 'landed', slow, duration, ...base });
        landed = true;
    }

    if (landed && targetAhead)
        attacker.cash += Math.min(activationCash * sabotage.leaderBountyCashRefundFraction,
            attacker.cash * sabotage.leaderBountyCurrentCashCapFraction);
}

function resolveDefense(state: MatchState, player: PlayerState, ability: Ability): void {
    const time = state.time;
    for (const effect of ability.effects)
        if (effect.type === 'cleanse_debuffs') {
            player.debuffs.sort((a, b) => b.slow - a.slow);
            player.debuffs.splice(0, effect.count ?? player.debuffs.length);
            if (effect.durationSec) player.immuneUntil = time + effect.durationSec;
        } else if (effect.type === 'temporary_mitigation' || effect.type === 'block_next_attack')
            player.shields.push({
                kind: effect.type === 'block_next_attack' ? 'block' : 'mitigation', abilityId: ability.id,
                fraction: effect.fraction ?? 1, until: time + (effect.durationSec ?? 0)
            });
    pushEvent(state, { type: 'defend', seat: player.seat, ref: ability.id });
}

function activate(state: MatchState, player: PlayerState, abilityId: string, targetSeat?: number): ActionResult {
    const ability = ABILITIES.get(abilityId);
    if (!ability) return FAILURE('Unknown ability');
    const status = abilityStatus(player, ability, state.time);
    if (!status.unlocked) return FAILURE('Buy the project first');
    if (ability.kind === 'attack' && state.settings.mode === 'peaceful') return FAILURE('Attacks are disabled in this match');
    if (status.cooldownLeft > 0) return FAILURE('Still cooling down');
    if (status.globalLeft > 0) return FAILURE('Your attack crew is recharging');
    const target = ability.kind === 'attack' ? state.players[targetSeat ?? -1] : undefined;
    if (ability.kind === 'attack' && (!target || target === player)) return FAILURE('Choose a rival');
    const cost = abilityCost(ability, state.settings);
    if (!canAfford(player, cost)) return FAILURE('Not enough resources');

    spend(player, cost);
    player.readyAt[ability.id] = state.time + ability.cooldownSec;
    if (target) {
        player.offenseReadyAt = state.time + GAME_CONFIG.sabotage.globalOffenseCooldownSec;
        resolveAttack(state, player, target, ability, cost.cash ?? 0);
    } else resolveDefense(state, player, ability);
    return SUCCESS;
}

function buyProject(state: MatchState, player: PlayerState, upgradeId: string): ActionResult {
    const upgrade = UPGRADES.get(upgradeId);
    if (!upgrade) return FAILURE('Unknown project');
    if (player.owned.includes(upgrade.id)) return FAILURE('Already owned');
    if (projectLock(player, upgrade, state.settings)) return FAILURE('That project is locked');
    const cost = projectCost(upgrade, player, contextOf(state));
    if (!canAfford(player, cost)) return FAILURE('Not enough resources');
    spend(player, cost);
    player.owned.push(upgrade.id);
    pushEvent(state, { type: 'project', seat: player.seat, ref: upgrade.id });
    return SUCCESS;
}

function buyMachine(state: MatchState, player: PlayerState, machineId: string, quantity: number | 'max'): ActionResult {
    const machine = MACHINES.get(machineId);
    if (!machine) return FAILURE('Unknown machine');
    if (player.phonesMade < machineUnlockAt(machine, state.settings)) return FAILURE('That machine is locked');
    const owned = player.machines[machine.id] ?? 0;
    const count = quantity === 'max' ? maxQuantity(machine, owned, player.cash) : quantity;
    if (!Number.isInteger(count) || count < 1 || count > GAME_CONFIG.maximumBuyQuantity) return FAILURE('Invalid quantity');
    const cost = quantityCost(machine, owned, count);
    if (player.cash < cost) return FAILURE('Not enough cash');
    player.cash -= cost;
    player.machines[machine.id] = owned + count;
    pushEvent(state, { type: 'machine', seat: player.seat, ref: machine.id, amount: count });
    return SUCCESS;
}

export function applyAction(state: MatchState, action: Action): ActionResult {
    if (state.winner >= 0) return FAILURE('The match is over');
    const player = state.players[action.playerId];
    if (!player) return FAILURE('Unknown player');
    expireStatuses(state);

    if (action.type === 'make_phone') {
        const budget = Math.min(GAME_CONFIG.clickBurst,
            player.clickBudget + (state.time - player.lastClickAt) * GAME_CONFIG.maximumClicksPerSecond);
        if (budget < 1) return FAILURE('Too fast');
        const rates = computeRates(player, state.time, state.settings.moneyMultiplier);
        player.clickBudget = budget - 1;
        player.lastClickAt = state.time;
        player.clicks++;
        player.phonesMade += rates.clickPhones;
        player.cash += rates.clickPhones * rates.salePrice;
        player.lifetimeCash += rates.clickPhones * rates.salePrice;
        resolveVictory(state);
        return SUCCESS;
    }
    if (action.type === 'buy_project') return buyProject(state, player, action.upgradeId);
    if (action.type === 'buy_machine') return buyMachine(state, player, action.machineId, action.quantity);
    return activate(state, player, action.abilityId, action.targetPlayerId);
}

function expireStatuses(state: MatchState): void {
    const time = state.time;
    for (const player of state.players) {
        player.debuffs = player.debuffs.filter(debuff => debuff.expiresAt > time);
        player.shields = player.shields.filter(shield => shield.until > time);
        player.hits = player.hits.filter(hit => time - hit.at < GAME_CONFIG.sabotage.antiDogpileWindowSec);
    }
}

export function rankPlayers(state: MatchState): Array<number> {
    return state.players.slice().sort((a, b) =>
        b.phonesMade - a.phonesMade || b.smoothPps - a.smoothPps || a.seat - b.seat).map(player => player.seat);
}

function resolveVictory(state: MatchState): void {
    if (state.winner >= 0) return;
    const { target } = state.settings;
    const finished = state.players.filter(player => player.phonesMade >= target);
    if (!finished.length) return;
    finished.sort((a, b) => b.phonesMade - a.phonesMade || b.lifetimeCash - a.lifetimeCash || a.seat - b.seat);
    state.winner = finished[0].seat;
    state.placements = [state.winner, ...rankPlayers(state).filter(seat => seat !== state.winner)];
    pushEvent(state, { type: 'win', seat: state.winner });
}

export function advanceGame(state: MatchState, dt: number): void {
    if (state.winner >= 0) return;
    expireStatuses(state);
    const { influence, smoothingSeconds, finalShipmentFraction } = GAME_CONFIG;
    const blend = 1 - Math.exp(-dt / smoothingSeconds);

    for (const player of state.players) {
        const rates = computeRates(player, state.time, state.settings.moneyMultiplier);
        const phones = rates.effectivePps * dt;
        player.phonesMade += phones;
        player.cash += phones * rates.salePrice;
        player.lifetimeCash += phones * rates.salePrice;
        player.research += rates.rps * dt;
        player.influence = Math.min(influence.cap, player.influence + influence.regenPerSecond * dt);
        player.smoothPps += (rates.effectivePps - player.smoothPps) * blend;
    }
    state.time += dt;

    if (state.shipmentSeat < 0) {
        const leader = state.players.filter(player => player.phonesMade >= state.settings.target * finalShipmentFraction)
            .sort((a, b) => b.phonesMade - a.phonesMade || a.seat - b.seat)[0];
        if (leader) {
            state.shipmentSeat = leader.seat;
            pushEvent(state, { type: 'shipment', seat: leader.seat });
        }
    }
    resolveVictory(state);
}

export function selectPlayerView(state: MatchState, seat: number): View {
    const you = state.players[seat];
    const ranking = rankPlayers(state);
    const players: Array<PublicPlayer> = state.players.map(player => ({
        seat: player.seat, companyId: player.companyId, phonesMade: player.phonesMade, pps: player.smoothPps,
        rank: ranking.indexOf(player.seat) + 1,
        shielded: player.shields.length > 0, immune: player.immuneUntil > state.time,
        pressure: pressureOn(player, state.time),
        mitigation: mitigationOf(player),
        theftFactor: theftFactor(player)
    }));
    return {
        time: state.time, settings: state.settings, leaderPhones: contextOf(state).leaderPhones,
        you, players, events: state.events.slice(-12),
        shipmentSeat: state.shipmentSeat, winner: state.winner, placements: state.placements
    };
}

export function validateContent(content: Content = CONTENT): Array<string> {
    const problems: Array<string> = [];
    const ids = new Set<string>();
    const unique = (id: string): void => {
        if (ids.has(id)) problems.push(`Duplicate id ${id}`);
        ids.add(id);
    };
    content.machines.forEach(machine => unique(machine.id));
    content.upgrades.forEach(upgrade => unique(upgrade.id));
    content.abilities.forEach(ability => unique(ability.id));

    for (const lane of LANES)
        for (let tier = 1; tier <= 5; tier++)
            if (content.upgrades.filter(upgrade => upgrade.lane === lane && upgrade.tier === tier).length !== 3)
                problems.push(`${lane} tier ${tier} must have exactly 3 projects`);

    for (const upgrade of content.upgrades) {
        if (!Object.values(upgrade.purchase).every(value => value > 0)) problems.push(`${upgrade.id} has a bad cost`);
        for (const required of upgrade.requires ?? [])
            if (!content.upgrades.some(other => other.id === required)) problems.push(`${upgrade.id} requires unknown ${required}`);
        for (const effect of upgrade.effects) {
            if (effect.type === 'unlock_ability') {
                const ability = content.abilities.find(other => other.id === effect.abilityId);
                if (!ability || ability.sourceUpgradeId !== upgrade.id) problems.push(`${upgrade.id} has a bad ability link`);
            }
            if (effect.factor !== undefined && effect.factor <= 0) problems.push(`${upgrade.id} has a bad factor`);
            if (effect.fraction !== undefined && (effect.fraction < 0 || effect.fraction > 1))
                problems.push(`${upgrade.id} has a bad fraction`);
        }
    }

    for (const ability of content.abilities) {
        if (!content.upgrades.some(upgrade => upgrade.id === ability.sourceUpgradeId)) problems.push(`${ability.id} has no source`);
        if (ability.cooldownSec <= 0 || !ability.activation.cash) problems.push(`${ability.id} needs a cost and cooldown`);
        for (const effect of ability.effects)
            if (effect.type === 'activate_slow' && (effect.fraction ?? 1) > GAME_CONFIG.sabotage.maxPpsSlow)
                problems.push(`${ability.id} exceeds the slow cap`);
    }

    const visiting = new Set<string>();
    const cyclic = (id: string): boolean => {
        if (visiting.has(id)) return true;
        visiting.add(id);
        const found = (content.upgrades.find(upgrade => upgrade.id === id)?.requires ?? []).some(cyclic);
        visiting.delete(id);
        return found;
    };
    content.upgrades.forEach(upgrade => {
        if (cyclic(upgrade.id)) problems.push(`${upgrade.id} has circular requirements`);
    });
    return problems;
}

const PROBLEMS = validateContent();
if (PROBLEMS.length) throw new Error(`Invalid Phone Wars content: ${PROBLEMS.join('; ')}`);
