import { TICK_HZ } from './fixed.js';

export function formatCountdown(seconds: number): string {
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
    return hours ? `${hours}h${String(minutes).padStart(2, '0')}m`
        : `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
}

export function timeline(tick: number, firstWaveTick: number, winTick: number) {
    const phase = tick >= winTick ? 'over' : tick < firstWaveTick ? 'prep' : 'waves';
    return { phase, seconds: Math.max(0, Math.ceil(((phase === 'prep' ? firstWaveTick : winTick) - tick) / TICK_HZ)) };
}
