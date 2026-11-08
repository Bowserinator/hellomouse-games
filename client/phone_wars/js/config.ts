/** Global tuning values, lobby presets and company themes. */
import type { CompanyTheme, MatchMode } from './types.js';

export const GAME_CONFIG = {
    referenceTargetPhones: 100_000_000,
    targetPresets: [10_000_000, 30_000_000, 60_000_000, 100_000_000, 200_000_000, 500_000_000],
    estimatedMinutesAtReference: 20,
    estimateExponent: 0.44,
    targetPriceScaleExponent: 0.82,
    minimumPlayers: 2,
    minimumPlayersPeaceful: 1,
    maximumPlayers: 4,
    stepSeconds: 0.05,
    maximumClicksPerSecond: 20,
    clickBurst: 5,
    smoothingSeconds: 5,
    finalShipmentFraction: 0.9,
    maximumBuyQuantity: 10_000,
    eventHistory: 40,
    starting: {
        cash: 50, phonesMade: 0, manualPhonesPerClick: 1,
        salePrice: 0.3, research: 0, influence: 50
    },
    influence: { cap: 100, regenPerSecond: 1.5 },
    tiers: [0, 0.001, 0.02, 0.15, 0.50],
    sabotage: {
        maxPpsSlow: 0.65,
        passiveMitigationCap: 0.70,
        minimumDurationFraction: 0.35,
        globalOffenseCooldownSec: 10,
        repeatTargetWindowSec: 20,
        repeatTargetMultiplier: 0.50,
        antiDogpileWindowSec: 30,
        antiDogpileMultipliers: [1, 0.60, 0.30],
        revenueSlowCap: 0.60,
        leaderBountyCashRefundFraction: 0.15,
        leaderBountyCurrentCashCapFraction: 0.05
    },
    catchup: { behindLeaderFraction: 0.25, economyProjectDiscount: 0.10 }
};

export const MONEY_MULTIPLIERS = [1, 2, 3, 4, 5];

export const MATCH_MODES: Array<MatchMode> = ['standard', 'peaceful'];

export const COMPANY_THEMES: Array<CompanyTheme> = [
    { id: 'pear', name: 'Pear', primary: '#455a64', accent: '#90a4ae', icon: 'img/companies/pear.png' },
    { id: 'galaxy', name: 'Galaxy', primary: '#1565c0', accent: '#00acc1', icon: 'img/companies/galaxy.png' },
    { id: 'googol', name: 'Googol', primary: '#00897b', accent: '#ffca28', icon: 'img/companies/googol.png' },
    { id: 'mono', name: 'Mono', primary: '#424242', accent: '#ef5350', icon: 'img/companies/mono.png' }
];

export function estimatedMinutes(target: number): number {
    const { estimatedMinutesAtReference: base, estimateExponent, referenceTargetPhones } = GAME_CONFIG;
    return Math.min(90, Math.max(4, base * (target / referenceTargetPhones) ** estimateExponent));
}

export function targetScale(target: number): number {
    return (target / GAME_CONFIG.referenceTargetPhones) ** GAME_CONFIG.targetPriceScaleExponent;
}

export function thresholdScale(target: number): number {
    return Math.min(1, target / GAME_CONFIG.referenceTargetPhones);
}

export function tierMilestone(target: number, tier: number): number {
    return Math.round(target * GAME_CONFIG.tiers[tier - 1]);
}

export function companyTheme(id: string): CompanyTheme {
    return COMPANY_THEMES.find(theme => theme.id === id) ?? COMPANY_THEMES[0];
}
