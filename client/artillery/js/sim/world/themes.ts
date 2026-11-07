import { islandThemeIdentifiers, oceanWaterLiquid, randomIslandTheme, tankWaterDamagePerTurn,
    worldGenerationNoise, worldTerrainSettings } from '../../config.js';
import { Rng } from '../../../../shared/ts/seeded-random.js';
import { BiomeRule, parseBiomeRules, parseMaterialName } from './biomes.js';
import { Material } from './material-table.js';

export type TerrainSettings = { -readonly [Key in keyof typeof worldTerrainSettings]: number };
export type Colour3 = readonly [number, number, number];

export interface StrataBand {
    material: Material;
    thickness: number;
}

export interface ThemeMaterials {
    soil?: Material;
    shoreSoil?: Material;
    stoneLight?: Material;
    stoneDark?: Material;
    floatingTop?: Material;
    boulder?: Material;
    soilDepth?: number;
    strataBands?: ReadonlyArray<Readonly<StrataBand>>;
}

export interface ThemeDecoration {
    treeProbabilityScale?: number;
    speciesOverride?: number;
    boulderProbability?: number;
}

export interface ThemeLiquid {
    damagePerTurn: number;
    absorption: Colour3;
    scatter: Colour3;
    foam: Colour3;
    emissive: number;
}

export interface ThemeSky {
    zenithColour?: number;
    horizonColour?: number;
    cloudColour?: number;
    sunColour?: number;
    /** How far the colours above move toward the theme, from 0 (preset) to 1 (theme). */
    strength?: number;
    lightLevelScale?: number;
}

export interface WorldTheme {
    identifier: typeof islandThemeIdentifiers[number];
    weight: number;
    biomes: ReadonlyArray<Readonly<BiomeRule>>;
    materials: Readonly<ThemeMaterials>;
    terrain: Readonly<Partial<TerrainSettings>>;
    regionRange: readonly [number, number] | null;
    decoration: Readonly<ThemeDecoration>;
    liquid: Readonly<ThemeLiquid>;
    sky: Readonly<ThemeSky>;
}

function record(value: unknown, message: string): Record<string, unknown> {
    if (value === undefined) return {};
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
    return value as Record<string, unknown>;
}

function number(value: unknown, minimum: number, maximum: number, message: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
        throw new Error(message);
    return value;
}

function colour3(value: unknown, defaults: Colour3): Colour3 {
    if (value === undefined) return defaults;
    if (!Array.isArray(value) || value.length !== 3) throw new Error('Invalid liquid colour');
    return Object.freeze([number(value[0], 0, 16, 'Invalid liquid colour'),
        number(value[1], 0, 16, 'Invalid liquid colour'), number(value[2], 0, 16, 'Invalid liquid colour')] as const);
}

function hexColour(value: unknown): number {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error('Invalid sky colour');
    return parseInt(value.slice(1), 16);
}

function parseMaterials(value: unknown): ThemeMaterials {
    const input = record(value, 'Invalid theme materials');
    const materials: ThemeMaterials = {};
    for (const key of ['soil', 'shoreSoil', 'stoneLight', 'stoneDark', 'floatingTop', 'boulder'] as const)
        if (input[key] !== undefined) materials[key] = parseMaterialName(input[key]);
    if (input.soilDepth !== undefined) materials.soilDepth = number(input.soilDepth, 0, 16, 'Invalid soil depth');
    if (input.strataBands !== undefined) {
        if (!Array.isArray(input.strataBands) || input.strataBands.length === 0)
            throw new Error('Invalid strata bands');
        materials.strataBands = Object.freeze(input.strataBands.map((entry: unknown) => {
            const band = record(entry, 'Invalid strata band');
            return Object.freeze({ material: parseMaterialName(band.material),
                thickness: Math.floor(number(band.thickness, 1, 64, 'Invalid strata thickness')) });
        }));
    }
    return Object.freeze(materials);
}

function parseTerrain(value: unknown): { terrain: Partial<TerrainSettings>; regionRange: [number, number] | null } {
    const input = record(value, 'Invalid theme terrain');
    const terrain: Partial<TerrainSettings> = {};
    let regionRange: [number, number] | null = null;
    for (const [key, entry] of Object.entries(input)) {
        if (key === 'regionRange') {
            if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid region range');
            const low = number(entry[0], 0, 1, 'Invalid region range');
            const high = number(entry[1], 0, 1, 'Invalid region range');
            if (low > high) throw new Error('Invalid region range');
            regionRange = [low, high];
        } else if (Object.prototype.hasOwnProperty.call(worldTerrainSettings, key))
            terrain[key as keyof TerrainSettings] = number(entry, -1e6, 1e6, 'Invalid terrain setting');
        else throw new Error(`Unknown terrain setting ${key}`);
    }
    return { terrain: Object.freeze(terrain), regionRange };
}

function parseDecoration(value: unknown): ThemeDecoration {
    const input = record(value, 'Invalid theme decoration');
    const decoration: ThemeDecoration = {};
    if (input.treeProbabilityScale !== undefined)
        decoration.treeProbabilityScale = number(input.treeProbabilityScale, 0, 1, 'Invalid tree scale');
    if (input.speciesOverride !== undefined) {
        const species = number(input.speciesOverride, 0, 3, 'Invalid tree species');
        if (!Number.isInteger(species)) throw new Error('Invalid tree species');
        decoration.speciesOverride = species;
    }
    if (input.boulderProbability !== undefined)
        decoration.boulderProbability = number(input.boulderProbability, 0, 1, 'Invalid boulder probability');
    return Object.freeze(decoration);
}

function parseLiquid(value: unknown): ThemeLiquid {
    const input = record(value, 'Invalid theme liquid');
    return Object.freeze({
        damagePerTurn: input.damagePerTurn === undefined ? tankWaterDamagePerTurn
            : number(input.damagePerTurn, 0, 1e4, 'Invalid liquid damage'),
        absorption: colour3(input.absorption, oceanWaterLiquid.absorption),
        scatter: colour3(input.scatter, oceanWaterLiquid.scatter),
        foam: colour3(input.foam, oceanWaterLiquid.foam),
        emissive: input.emissive === undefined ? oceanWaterLiquid.emissive
            : number(input.emissive, 0, 1, 'Invalid liquid emissive amount')
    });
}

function parseSky(value: unknown): ThemeSky {
    const input = record(value, 'Invalid theme sky');
    const sky: ThemeSky = {};
    for (const key of ['zenithColour', 'horizonColour', 'cloudColour', 'sunColour'] as const)
        if (input[key] !== undefined) sky[key] = hexColour(input[key]);
    if (input.strength !== undefined) sky.strength = number(input.strength, 0, 1, 'Invalid sky strength');
    if (input.lightLevelScale !== undefined)
        sky.lightLevelScale = number(input.lightLevelScale, 0, 4, 'Invalid light level scale');
    return Object.freeze(sky);
}

/** Parses the theme table and returns the themes in selection order. */
export function parseThemes(value: unknown): ReadonlyArray<Readonly<WorldTheme>> {
    if (!Array.isArray(value) || value.length !== islandThemeIdentifiers.length)
        throw new Error('Theme table must define every island theme');
    const parsed = value.map((entry: unknown): WorldTheme => {
        const input = record(entry, 'Invalid theme');
        const identifier = islandThemeIdentifiers.find(candidate => candidate === input.identifier);
        if (identifier === undefined) throw new Error('Unknown island theme');
        const { terrain, regionRange } = parseTerrain(input.terrain);
        return Object.freeze({ identifier, weight: number(input.weight, Number.MIN_VALUE, 1e6, 'Invalid theme weight'),
            biomes: parseBiomeRules(input.biomes), materials: parseMaterials(input.materials), terrain, regionRange,
            decoration: parseDecoration(input.decoration), liquid: parseLiquid(input.liquid),
            sky: parseSky(input.sky) });
    });
    const ordered = islandThemeIdentifiers.map(identifier => parsed.find(theme => theme.identifier === identifier));
    if (ordered.some(theme => theme === undefined) ||
        new Set(parsed.map(theme => theme.identifier)).size !== parsed.length)
        throw new Error('Theme table must define every island theme once');
    return Object.freeze(ordered as Array<WorldTheme>);
}

/** Picks the selected theme, or a weighted choice derived from the match seed for the random selection. */
export function resolveTheme(matchSeed: number, themes: ReadonlyArray<Readonly<WorldTheme>>,
    selection: number): Readonly<WorldTheme> {
    if (selection === randomIslandTheme)
        return new Rng(matchSeed).fork(worldGenerationNoise.themeForkLabel).weighted(Array.from(themes),
            theme => theme.weight);
    const theme = themes[selection - 1];
    if (!theme) throw new RangeError('Unknown island theme selection');
    return theme;
}
