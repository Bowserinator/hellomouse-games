import { terrainUniformBlastResistance, terrainUsesUniformBlastResistance,
    worldWaterSurfaceHeightInVoxels } from '../../config.js';

export enum Material {
    AIR,
    SEABED,
    WET_SAND,
    SAND,
    SANDSTONE,
    MEADOW_LIGHT,
    MEADOW,
    MEADOW_DARK,
    FOREST_FLOOR,
    DRY_GRASS,
    DIRT,
    MUD,
    GRAVEL,
    LIGHT_STONE,
    DARK_STONE,
    STRATA_LIGHT,
    STRATA_DARK,
    SNOW,
    ICE,
    ASH,
    SCORCHED_GROUND,
    TREE_TRUNK,
    LEAVES_LIGHT,
    LEAVES,
    LEAVES_DARK,
    PINE_NEEDLES,
    MAGIC_WALL,
    DOME_BARRIER
}

export enum MaterialFlag {
    SOLID = 1,
    SOIL = 2,
    FLAMMABLE = 4,
    FOLIAGE = 8,
    CONSTRUCTED = 16
}

export interface MaterialDefinition {
    readonly name: string;
    readonly baseColour: number;
    readonly colourVariationStrength: number;
    readonly blastResistance: number;
    readonly isIndestructible: boolean;
    readonly flags: number;
}

export function underwaterMaterial(material: Material, y: number): Material {
    return y <= worldWaterSurfaceHeightInVoxels && material === Material.DIRT ? Material.SAND : material;
}

const solid = MaterialFlag.SOLID;
const soil = solid | MaterialFlag.SOIL;
const foliage = solid | MaterialFlag.FLAMMABLE | MaterialFlag.FOLIAGE;

export const materialTable: ReadonlyArray<Readonly<MaterialDefinition>> = Object.freeze([
    { name: 'Air', baseColour: 0x000000, colourVariationStrength: 0, blastResistance: 0,
        isIndestructible: false, flags: 0 },
    { name: 'Seabed', baseColour: 0x32607a, colourVariationStrength: .09, blastResistance: .5,
        isIndestructible: true, flags: solid },
    { name: 'Wet sand', baseColour: 0xc4b37a, colourVariationStrength: .08, blastResistance: .02,
        isIndestructible: false, flags: soil },
    { name: 'Sand', baseColour: 0xd8c78d, colourVariationStrength: .09, blastResistance: .02,
        isIndestructible: false, flags: soil },
    { name: 'Sandstone', baseColour: 0xb9a372, colourVariationStrength: .08, blastResistance: .2,
        isIndestructible: false, flags: solid },
    { name: 'Light meadow', baseColour: 0x4a8a31, colourVariationStrength: .12, blastResistance: .05,
        isIndestructible: false, flags: soil },
    { name: 'Meadow', baseColour: 0x2f6d21, colourVariationStrength: .12, blastResistance: .05,
        isIndestructible: false, flags: soil },
    { name: 'Dark meadow', baseColour: 0x255a1b, colourVariationStrength: .12, blastResistance: .05,
        isIndestructible: false, flags: soil },
    { name: 'Forest floor', baseColour: 0x405c37, colourVariationStrength: .12, blastResistance: .06,
        isIndestructible: false, flags: soil },
    { name: 'Dry grass', baseColour: 0x558d36, colourVariationStrength: .12, blastResistance: .04,
        isIndestructible: false, flags: soil },
    { name: 'Dirt', baseColour: 0x795739, colourVariationStrength: .12, blastResistance: .08,
        isIndestructible: false, flags: soil },
    { name: 'Mud', baseColour: 0x514b36, colourVariationStrength: .1, blastResistance: .03,
        isIndestructible: false, flags: soil },
    { name: 'Gravel', baseColour: 0x8e8980, colourVariationStrength: .15, blastResistance: .1,
        isIndestructible: false, flags: soil },
    { name: 'Light stone', baseColour: 0x9b9d99, colourVariationStrength: .1, blastResistance: .3,
        isIndestructible: false, flags: solid },
    { name: 'Dark stone', baseColour: 0x555d63, colourVariationStrength: .1, blastResistance: .4,
        isIndestructible: false, flags: solid },
    { name: 'Light strata', baseColour: 0xa89d8d, colourVariationStrength: .08, blastResistance: .3,
        isIndestructible: false, flags: solid },
    { name: 'Dark strata', baseColour: 0x736c66, colourVariationStrength: .08, blastResistance: .4,
        isIndestructible: false, flags: solid },
    { name: 'Snow', baseColour: 0xe8edf0, colourVariationStrength: .04, blastResistance: .02,
        isIndestructible: false, flags: soil },
    { name: 'Ice', baseColour: 0x9eced7, colourVariationStrength: .05, blastResistance: .15,
        isIndestructible: false, flags: solid },
    { name: 'Ash', baseColour: 0x777478, colourVariationStrength: .1, blastResistance: .01,
        isIndestructible: false, flags: soil },
    { name: 'Scorched ground', baseColour: 0x403932, colourVariationStrength: .14, blastResistance: .08,
        isIndestructible: false, flags: soil },
    { name: 'Tree trunk', baseColour: 0x705035, colourVariationStrength: .12, blastResistance: .15,
        isIndestructible: false, flags: solid | MaterialFlag.FLAMMABLE },
    { name: 'Light leaves', baseColour: 0x8aaf4a, colourVariationStrength: .14, blastResistance: 0,
        isIndestructible: false, flags: foliage },
    { name: 'Leaves', baseColour: 0x5e913e, colourVariationStrength: .14, blastResistance: 0,
        isIndestructible: false, flags: foliage },
    { name: 'Dark leaves', baseColour: 0x3c6c37, colourVariationStrength: .14, blastResistance: 0,
        isIndestructible: false, flags: foliage },
    { name: 'Pine needles', baseColour: 0x315d45, colourVariationStrength: .12, blastResistance: 0,
        isIndestructible: false, flags: foliage },
    { name: 'Magic wall', baseColour: 0xa279cc, colourVariationStrength: .06, blastResistance: .45,
        isIndestructible: false, flags: solid | MaterialFlag.CONSTRUCTED },
    { name: 'Dome barrier', baseColour: 0x71bdcf, colourVariationStrength: .04, blastResistance: .5,
        isIndestructible: false, flags: solid | MaterialFlag.CONSTRUCTED }
].map(definition => Object.freeze(definition)));

/** How strongly a material resists blasts, from 0 (carved fully) up to 1 (never carved). */
export function blastResistanceOf(material: Material): number {
    return terrainUsesUniformBlastResistance ? terrainUniformBlastResistance : materialTable[material].blastResistance;
}
