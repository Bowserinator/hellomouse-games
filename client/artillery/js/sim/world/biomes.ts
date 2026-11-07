import { Material } from './material-table.js';

export interface BiomeRule {
    material: Material;
    minimumHeight?: number;
    maximumHeight?: number;
    minimumSlope?: number;
    maximumSlope?: number;
    minimumMoisture?: number;
    maximumMoisture?: number;
}

const biomeNumericKeys = ['minimumHeight', 'maximumHeight', 'minimumSlope', 'maximumSlope',
    'minimumMoisture', 'maximumMoisture'] as const;

export function parseBiomeRules(value: unknown): ReadonlyArray<Readonly<BiomeRule>> {
    if (!Array.isArray(value) || value.length === 0) throw new Error('Biome table must be a non-empty array');
    return Object.freeze(value.map((entry: unknown) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
            throw new Error('Invalid biome rule');
        const record = entry as Record<string, unknown>;
        const materialName = record.material;
        if (typeof materialName !== 'string' || !Object.prototype.hasOwnProperty.call(Material, materialName) ||
            typeof Material[materialName as keyof typeof Material] !== 'number')
            throw new Error('Invalid biome material');
        const material = Material[materialName as keyof typeof Material];
        if (material === Material.AIR || material === Material.SEABED) throw new Error('Invalid biome surface');
        const rule: BiomeRule = { material };
        for (const key of biomeNumericKeys) {
            const bound = record[key];
            if (bound === undefined) continue;
            if (typeof bound !== 'number' || !Number.isFinite(bound) || bound < 0)
                throw new Error('Invalid biome bound');
            rule[key] = bound;
        }
        if ((rule.minimumHeight ?? 0) > (rule.maximumHeight ?? Infinity) ||
            (rule.minimumSlope ?? 0) > (rule.maximumSlope ?? Infinity) ||
            (rule.minimumMoisture ?? 0) > (rule.maximumMoisture ?? 1) ||
            (rule.maximumMoisture ?? 1) > 1) throw new Error('Invalid biome interval');
        return Object.freeze(rule);
    }));
}

export function surfaceMaterial(rules: ReadonlyArray<Readonly<BiomeRule>>, height: number,
    slope: number, moisture: number): Material {
    for (const rule of rules)
        if (height >= (rule.minimumHeight ?? 0) && height <= (rule.maximumHeight ?? Infinity) &&
            slope >= (rule.minimumSlope ?? 0) && slope <= (rule.maximumSlope ?? Infinity) &&
            moisture >= (rule.minimumMoisture ?? 0) && moisture <= (rule.maximumMoisture ?? 1)) return rule.material;
    throw new Error('Biome table does not cover the generated surface');
}
