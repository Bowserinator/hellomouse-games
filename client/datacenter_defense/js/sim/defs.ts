import { hashWords, Q } from './fixed.js';
import { GHOST_WORDS, ECONOMY_WORDS, ENTITY_WORDS, MAX_ENTITIES, MAX_WEAPONS, PARAM,
    PLAYER_WORDS, PROJECTILE_WORDS, WEAPON_WORDS } from './layout.js';
import { variantTable, VARIANT_STRIDE } from './variants.js';
import { entities, UNIT_STRIDE } from './entity/registry.js';
import { PROJECTILE_STRIDE, projectileTable } from './projectile/registry.js';
import { WEAPON, WEAPON_STRIDE, weaponTable } from './weapon/registry.js';
import { BALANCE } from './balance.js';
import './content/index.js';

export const DEF_HEADER_WORDS = 132;
export const DEF_HEADER = {
    zombie: 0,
    zombieCount: 1,
    zombieStride: 2,
    unit: 3,
    unitCount: 4,
    unitStride: 5,
    weapon: 6,
    weaponCount: 7,
    weaponStride: 8,
    projectile: 9,
    projectileCount: 10,
    projectileStride: 11,
    entities: 12,
    weaponState: 13,
    orders: 14,
    projectiles: 15,
    beams: 16,
    occupancy: 17,
    entityDamage: 18,
    powerDrain: 19,
    flowControl: 20,
    density: 21,
    sonicAggro: 22,
    buildings: 23,
    entitySnapshot: 24,
    projectileSnapshot: 25,
    zombieShots: 26,
    projectileCountMax: 27,
    flowPasses: 28,
    flowTicks: 29,
    flowStride: 30,
    flowActive: 31,
    flowCosts: 32,
    projectileRing: 33,
    projectileAux: 34,
    coarseCounts: 35,
    coarseIds: 36,
    coarseColumns: 37,
    coarseRows: 38,
    coarseScale: 39,
    coarseScan: 40,
    gasSlow: 41,
    priority: 42,
    stuck: 43,
    spawnPerSource: 44,
    spawnHpScale: 45,
    explosions: 46,
    damageTime: 47,
    unitMotion: 48,
    sonicForce: 49,
    flowClasses: 50,
    flowTiles: 51,
    hashRanges: 52,
    hashRangeCount: 53,
    hashWords: 54,
    flowColumns: 55,
    flowRows: 56,
    flowScale: 57,
    shields: 58,
    pursuitRange: 59,
    pursuitLeash: 60,
    pursuitDistance: 61,
    unitRecovery: 62,
    continuousSpawn: 63,
    staticParams: 64,
    explosionImpulse: 120,
    explosionPush: 121,
    maxRadius: 122,
    targetSpread: 123,
    waves: 124,
    waveMode: 125,
    economy: 127,
    construction: 128,
    ghosts: 129,
    winTick: 130,
    unlimitedEconomy: 131
} as const;
export const STATIC_PARAMS: ReadonlyArray<keyof typeof PARAM> = [
    'terrain', 'spawns', 'terrainColumns', 'terrainRows', 'widthQ', 'depthQ', 'objectiveX',
    'objectiveZ', 'objectiveRadius', 'gridColumns', 'gridRows', 'gridCellQ', 'sortSize',
    'sortA', 'sortB', 'counts', 'scanA', 'scanB', 'emitScanA', 'emitScanB',
    'weapons', 'players', 'projectiles', 'compact', 'compactCount', 'snapshot', 'damage',
    'credits', 'commandHash', 'extraWords', 'spawnCount'
];
export interface CompiledDefs {
    words: Int32Array;
    hash: number;
}
export function compileDefs(parameters = new Uint32Array(64),
    regions: Partial<Record<keyof typeof DEF_HEADER, number>> = {}): CompiledDefs {
    const zombies = variantTable(), weaponWords = weaponTable(), projectileWords = projectileTable();
    const healthScale = regions.spawnHpScale ?? 1;
    for (let i = 0; i < zombies.length; i += VARIANT_STRIDE) {
        if (zombies[i] > 2147483647 / healthScale) throw Error('Test zombie health exceeds integer range');
        zombies[i] *= healthScale;
    }
    const ranges = [
        [0, 16],
        [parameters[PARAM.commandHash], 1],
        [parameters[PARAM.weapons], MAX_WEAPONS * WEAPON_WORDS],
        [parameters[PARAM.players], 8 * PLAYER_WORDS],
        [parameters[PARAM.projectiles], MAX_WEAPONS * PROJECTILE_WORDS],
        [parameters[PARAM.emits], parameters[PARAM.count] * 8],
        ...['entities', 'weaponState', 'orders', 'occupancy', 'projectiles', 'projectileAux', 'beams', 'gasSlow']
            .map((name, i) => [regions[name as keyof typeof DEF_HEADER] ?? 0,
                [MAX_ENTITIES * ENTITY_WORDS, MAX_ENTITIES * 4 * 8, MAX_ENTITIES * 32,
                    Math.ceil(parameters[PARAM.columns] * parameters[PARAM.rows] / 2),
                    (regions.projectileCountMax ?? 0) * 12, (regions.projectileCountMax ?? 0) * 8,
                    MAX_ENTITIES * 4 * 8, parameters[PARAM.count]][i]]),
        [regions.pursuitDistance ?? 0, parameters[PARAM.count]],
        [regions.stuck ?? 0, parameters[PARAM.count] * 4],
        [regions.unitRecovery ?? 0, MAX_ENTITIES * 4],
        [regions.sonicAggro ?? 0, parameters[PARAM.count] * 3],
        [regions.damageTime ?? 0, parameters[PARAM.count]],
        [regions.explosionImpulse ?? 0, parameters[PARAM.count] * 2],
        [regions.economy ?? 0, ECONOMY_WORDS],
        [regions.ghosts ?? 0, GHOST_WORDS]
    ];
    const words = new Int32Array(DEF_HEADER_WORDS + zombies.length + entities.length * UNIT_STRIDE +
        weaponWords.length + projectileWords.length + 8 + ranges.length * 2);
    words[DEF_HEADER.explosionPush] = Math.round(BALANCE.explosionPushSpeed * Q / 20);
    words[DEF_HEADER.targetSpread] = BALANCE.targetSpread;
    for (let i = 2; i < zombies.length; i += VARIANT_STRIDE)
        words[DEF_HEADER.maxRadius] = Math.max(words[DEF_HEADER.maxRadius], zombies[i]);
    words[DEF_HEADER.pursuitRange] = Math.round(BALANCE.zombie.pursuitRange * 100);
    words[DEF_HEADER.pursuitLeash] = Math.round(BALANCE.zombie.pursuitLeash * 100);
    words[DEF_HEADER.zombie] = DEF_HEADER_WORDS;
    words[DEF_HEADER.zombieCount] = zombies.length / VARIANT_STRIDE;
    words[DEF_HEADER.zombieStride] = VARIANT_STRIDE;
    for (const name of [...STATIC_PARAMS, 'columns', 'rows', 'cellQ'] as const)
        words[DEF_HEADER.staticParams + PARAM[name]] = parameters[PARAM[name]];
    words.set(zombies, DEF_HEADER_WORDS);
    words[DEF_HEADER.unit] = DEF_HEADER_WORDS + zombies.length;
    words[DEF_HEADER.unitCount] = entities.length; words[DEF_HEADER.unitStride] = UNIT_STRIDE;
    entities.forEach((entity, i) => words.set(entity.pack(), words[DEF_HEADER.unit] + i * UNIT_STRIDE));
    words[DEF_HEADER.weapon] = words[DEF_HEADER.unit] + entities.length * UNIT_STRIDE;
    words[DEF_HEADER.weaponCount] = weaponWords.length / WEAPON_STRIDE;
    words[DEF_HEADER.weaponStride] = WEAPON_STRIDE;
    words.set(weaponWords, words[DEF_HEADER.weapon]);
    words[DEF_HEADER.projectile] = words[DEF_HEADER.weapon] + weaponWords.length;
    words[DEF_HEADER.projectileCount] = projectileWords.length / PROJECTILE_STRIDE;
    words[DEF_HEADER.projectileStride] = PROJECTILE_STRIDE;
    words.set(projectileWords, words[DEF_HEADER.projectile]);
    words[DEF_HEADER.priority] = words[DEF_HEADER.projectile] + projectileWords.length;
    let ring = 1;
    for (let i = WEAPON.slots; i < weaponWords.length; i += WEAPON_STRIDE) ring = Math.max(ring, weaponWords[i]);
    words[DEF_HEADER.projectileRing] = ring;
    words[DEF_HEADER.hashRanges] = words[DEF_HEADER.priority] + 8;
    words[DEF_HEADER.hashRangeCount] = ranges.length;
    words[DEF_HEADER.hashWords] = ranges.reduce((sum, [, length]) => sum + length, 0);
    ranges.forEach((range, i) => words.set(range, words[DEF_HEADER.hashRanges] + i * 2));
    for (const [name, value] of Object.entries(regions)) words[DEF_HEADER[name as keyof typeof DEF_HEADER]] = value;
    return { words, hash: hashWords(words) };
}
export const DEFS_WGSL = Object.entries(DEF_HEADER)
    .map(([key, value]) => `const D_${key}: u32 = ${value}u;`).join('\n');
