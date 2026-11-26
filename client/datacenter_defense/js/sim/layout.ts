import { LOBBY_LIMIT } from '../shared/protocol.js';

export const PARAM = {
    tick: 0, count: 1, columns: 2, rows: 3, cellQ: 4, seed: 5, terrain: 6, spawns: 7,
    terrainColumns: 8, terrainRows: 9, widthQ: 10, depthQ: 11, objectiveX: 12, objectiveZ: 13,
    objectiveRadius: 14, field: 15, gridColumns: 16, gridRows: 17, gridCellQ: 18, sortSize: 19,
    sortA: 20, sortB: 21, counts: 22, offsets: 23, scanA: 24, scanB: 25, emitScanA: 26, emitScanB: 27,
    j: 28, k: 29, input: 30, output: 31, length: 32, stride: 33, commands: 34,
    weapons: 35, players: 36, projectiles: 37, emits: 38, compact: 39, compactCount: 40,
    snapshot: 41, damage: 42, credits: 43, commandHash: 44, previousEmits: 45, extraWords: 46,
    locomotion: 47, flowRuntime: 48, scanTotals: 49, sorted: 50, flowArgs: 51, separation: 52, flowGrid: 53,
    gridKeys: 54, spawnCount: 55, slotRecords: 56, radixKeysA: 57, radixKeysB: 58,
    radixHist: 59, artilleryQueue: 60, splashQueue: 61
} as const;
export const MAX_ENTITIES = 1024;
export const MAX_GHOSTS = 1024;
export const GHOST_STRIDE = 7;
export const GHOST_WORDS = 1 + MAX_GHOSTS * GHOST_STRIDE;
export const GHOST = { definition: 0, x: 1, z: 2, rotation: 3, owner: 4, source: 5 } as const;
export const ENTITY_WORDS = 33;
export const ENTITY_DESTROYED = 8;
export const RENDER_AIMS = ENTITY_WORDS;
export const RENDER_ORDERS = RENDER_AIMS + 4;
export const MAX_ORDERS = 64;
export const ORDER_WORDS = MAX_ORDERS * 4;
export const RENDER_STORAGE_BONUS = RENDER_ORDERS + ORDER_WORDS;
export const RENDER_ENTITY_WORDS = RENDER_STORAGE_BONUS + 1;
export const RENDER_ZOMBIE_STATE_SHIFT = 22;
export const RENDER_ZOMBIE_HP_MASK = (1 << (RENDER_ZOMBIE_STATE_SHIFT - 8)) - 1;
export function zombieHp(packed: number): number {
    return (packed >>> 8) & RENDER_ZOMBIE_HP_MASK;
}
export const RENDER_AIM_ACTIVE = 0x10000;
export const RENDER_CHARGE_SHIFT = 20;
export const RENDER_PROJECTILE_WORDS = 9;
export const RENDER_PROJECTILE_LAUNCH = 8;
export const RENDER_BEAM_WORDS = 8;
export const RENDER_EXPLOSION_WORDS = 6;
export const RENDER_SALE_EFFECT = -1;
export const ENTITY = {
    state: 0, owner: 1, def: 2, x: 3, z: 4, facing: 5, hp: 6, power: 7, rotation: 8,
    orderHead: 9, orderCount: 10, priorityLow: 11, priorityHigh: 12, flags: 13, speed: 14, timer: 15,
    progress: 16, assist: 17, buildTask: 18, decay: 19, taskGeneration: 20, explicitTask: 21,
    repairProgress: 22, repairBase: 23, upgradeTarget: 24, upgradeProgress: 25, upgradeGain: 26,
    clearX: 27, clearZ: 28, clearUntil: 29, skippedTask: 30, skippedGeneration: 31, queuedUpgrade: 32
} as const;
export const ECONOMY = {
    money: 0, power: 1, moneyCap: 2, powerCap: 3, moneyIncome: 4, powerIncome: 5,
    moneyUsed: 6, powerUsed: 7, rejected: 8, starterShare: 9,
    moneyRate: 13, powerRate: 14, sampleTick: 15,
    moneyHistory: 56, powerHistory: 76,
    moneyCarry: 99, powerCarry: 100, kills: 106,
    players: 114, moneyCursor: 116, powerCursor: 117
} as const;
export const PLAYER_ECONOMY_WORDS = 101;
const PLAYER_ECONOMY_START = ECONOMY.powerCursor + 1;
export const ECONOMY_WORDS = PLAYER_ECONOMY_START + (LOBBY_LIMIT - 1) * PLAYER_ECONOMY_WORDS;
export function playerEconomyOffset(slot: number) {
    return slot === 0 ? 0 : PLAYER_ECONOMY_START + (slot - 1) * PLAYER_ECONOMY_WORDS;
}
export function isLive(row?: Int32Array): row is Int32Array {
    return !!row && row[ENTITY.state] !== 0 && row[ENTITY.hp] > 0;
}
export function isActive(row?: Int32Array): row is Int32Array {
    return isLive(row) && row[ENTITY.state] === 1;
}
export const PLAYER_WORDS = 6;
export const WEAPON_WORDS = 8;
export const PROJECTILE_WORDS = 8;
export const MAX_WEAPONS = 64;
export const SCRATCH = { convergence: 0, hash: 1, objectiveDamage: 2, blockedSpawn: 3, hostileEnd: 4 } as const;
