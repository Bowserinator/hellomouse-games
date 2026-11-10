/** Number, time and effect text formatting shared by the lobby and the match screens. */
import type { Ability, Cost, Effect } from './types.js';

export function formatNumber(value: number): string {
    const sign = value < 0 ? '-' : '';
    const amount = Math.abs(value);
    const units: Array<[number, number, string]> = [[1e12, 1e12, 'T'], [1e9, 1e9, 'B'], [1e6, 1e6, 'M'], [1e4, 1e3, 'k']];
    for (const [threshold, divisor, suffix] of units)
        if (amount >= threshold) {
            const scaled = amount / divisor;
            return `${sign}${scaled >= 100 ? scaled.toFixed(0) : String(Number(scaled.toFixed(1)))}${suffix}`;
        }
    return sign + Math.floor(amount).toLocaleString('en-US');
}

export function formatExact(value: number): string {
    return Math.floor(value).toLocaleString('en-US');
}

export function formatMoney(value: number): string {
    return value > 0 && value < 10 ? `$${value.toFixed(2)}` : `$${formatNumber(value)}`;
}

export function formatClock(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function formatSeconds(seconds: number): string {
    return `${Math.ceil(Math.max(0, seconds))}s`;
}

export function formatCost(cost: Cost): string {
    const parts: Array<string> = [];
    if (cost.cash !== undefined) parts.push(formatMoney(cost.cash));
    if (cost.research !== undefined) parts.push(`${formatNumber(cost.research)} RP`);
    if (cost.influence !== undefined) parts.push(`${formatNumber(cost.influence)}⚡`);
    return parts.join(' + ');
}

export function formatPercent(fraction: number): string {
    return `${Math.round(fraction * 100)}%`;
}

function describeEffect(effect: Effect): string {
    const percent = formatPercent(effect.fraction ?? 0);
    const seconds = `${effect.durationSec ?? 0}s`;
    switch (effect.type) {
        case 'activate_slow': return `-${percent} production for ${seconds}`;
        case 'activate_revenue_slow': return `-${percent} cash per phone for ${seconds}`;
        case 'steal_phones': return 'Steal rivals phones (more if they are ahead)';
        case 'cleanse_debuffs': return effect.count ? `Removes ${effect.count} active attack` : 'Removes every active attack';
        case 'temporary_mitigation': return `Attacks are ${percent} weaker for ${seconds}`;
        case 'block_next_attack': return `Blocks the next attack within ${seconds}`;
        default: return '';
    }
}

export function describeAbility(ability: Ability): string {
    return ability.effects.map(describeEffect).filter(Boolean).join(', ');
}
