/** Constants shared by the Tron client and server. */

export const MAX_PLAYERS = 6;
export const MAP_SIZES = [32, 64, 128, 256];
export const SPEED_MULTIPLIERS = [1, 1.5, 2, 3, 4];
export const ROUND_OPTIONS = [5, 10, 15, 20];
export const BASE_STEP_MS = 150;

export const DEFAULT_SETTINGS = { size: 3, speed: 1, rounds: 1 };

export const SPAWN_MARGIN = 5;
export const PRE_ROUND_DELAY = 1500;
export const DELAY_AFTER_ROUND = 3000;
export const DEATH_GRACE_MS = 300;
export const SPECTATE_DELAY = 1500;

export const COLORS = [
    '#00e5ff', '#ff9100', '#ffee00', '#ff1744',
    '#00e676', '#e040fb', '#2979ff', '#eceff1'
];

export function stepInterval(speedIndex: number): number {
    return BASE_STEP_MS / SPEED_MULTIPLIERS[speedIndex];
}
