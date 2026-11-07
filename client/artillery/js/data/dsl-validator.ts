import { modelMaximumDimensionInVoxels, weaponMaximumActionDepth, weaponMaximumSpawnsPerFire,
    simulationTicksPerSecond } from '../config.js';
import { compileVoxelModel } from './voxel-model-compiler.js';
import { WeaponAction, WeaponDataFiles, ProjectileDefinition } from '../sim/weapon-types.js';
import { Material } from '../sim/world/material-table.js';
import { soundCatalog } from '../audio/sound-catalog.js';

type Rule = (value: unknown, path: string) => void;
type Fields = Record<string, Rule>;

function invalid(path: string, message: string): never {
    throw new Error(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
        invalid(path, 'Expected an object');
    return value as Record<string, unknown>;
}

function object(required: Fields, optional: Fields = {}): Rule {
    return (value, path) => {
        const fields = record(value, path);
        for (const key of Object.keys(fields)) {
            const rule = Object.prototype.hasOwnProperty.call(required, key) ? required[key]
                : Object.prototype.hasOwnProperty.call(optional, key) ? optional[key] : null;
            if (!rule) invalid(`${path}.${key}`, 'Unknown key');
            rule(fields[key], `${path}.${key}`);
        }
        for (const key of Object.keys(required))
            if (!Object.prototype.hasOwnProperty.call(fields, key)) invalid(`${path}.${key}`, 'Missing required key');
    };
}

function number(minimum: number, maximum: number, integer = false): Rule {
    return (value, path) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum ||
            (integer && !Number.isInteger(value))) invalid(path, `Expected ${integer ? 'integer' : 'number'} in ` +
                `[${minimum}, ${maximum}]`);
    };
}

function choice(...values: ReadonlyArray<string>): Rule {
    return (value, path) => {
        if (typeof value !== 'string' || !values.includes(value))
            invalid(path, `Expected one of ${values.join(', ')}`);
    };
}

const boolean: Rule = (value, path) => {
    if (typeof value !== 'boolean') invalid(path, 'Expected boolean');
};
const identifier: Rule = (value, path) => {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,95}$/.test(value)) invalid(path, 'Invalid identifier');
};
const text: Rule = (value, path) => {
    if (typeof value !== 'string' || !value.length || value.length > 1024) invalid(path, 'Expected nonempty text');
};
const positive = number(.001, 4096), nonnegative = number(0, 4096), seconds = number(0, 30);
const count = number(1, weaponMaximumSpawnsPerFire, true), angle = number(-360, 360);
const material: Rule = (value, path) => {
    if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(Material, value) ||
        typeof Material[value as keyof typeof Material] !== 'number' || value === 'AIR' || value === 'SEABED')
        invalid(path, 'Invalid editable material');
};

function array(rule: Rule, minimum = 0, maximum = weaponMaximumSpawnsPerFire): Rule {
    return (value, path) => {
        if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
            invalid(path, `Expected array length in [${minimum}, ${maximum}]`);
        value.forEach((entry, index) => rule(entry, `${path}[${index}]`));
    };
}

function tuple(rules: ReadonlyArray<Rule>): Rule {
    return (value, path) => {
        if (!Array.isArray(value) || value.length !== rules.length) invalid(path, `Expected ${rules.length} values`);
        rules.forEach((rule, index) => rule(value[index], `${path}[${index}]`));
    };
}

function dictionary(rule: Rule): Rule {
    return (value, path) => {
        const fields = record(value, path);
        for (const key of Object.keys(fields)) {
            identifier(key, `${path}.${key}`);
            rule(fields[key], `${path}.${key}`);
        }
    };
}

const vector = tuple([number(-4096, 4096), number(-4096, 4096), number(-4096, 4096)]);
const damageFields: Fields = {
    directHitDamage: number(0, 1e6), splashDamage: number(0, 1e6), splashRadiusInVoxels: nonnegative,
    falloff: choice('constant', 'linear', 'quadratic'), knockbackImpulse: number(0, 1e4),
    knockbackUpwardBias: number(0, 1), damageOverTime: object({ amountPerSecond: number(0, 1e6),
        durationSeconds: seconds, stacking: choice('perSource') })
};
const damage = object({}, damageFields);
const terrainFields: Fields = {
    radiusInVoxels: positive, materialIdentifier: material, irregularityFraction: number(0, 1),
    noiseFrequency: positive, rayCount: number(0, 64, true), rayLengthInVoxels: nonnegative,
    rayAngularSharpness: positive, rippleRingCount: number(0, 32, true), rippleSpacingInVoxels: positive,
    lengthInVoxels: positive, heightInVoxels: positive, widthInVoxels: positive, thicknessInVoxels: positive,
    offset: vector
};
const terrainOperation: Rule = (value, path) => {
    const fields = record(value, path);
    const radius = { radiusInVoxels: positive };
    const required: Record<string, Fields> = {
        carveSphere: radius, carveShapedBlast: radius, addSphere: radius,
        carveCapsule: { ...radius, lengthInVoxels: positive },
        carveLineAlongRay: { radiusInVoxels: nonnegative, lengthInVoxels: positive },
        carveCylinder: { ...radius, heightInVoxels: positive },
        carveRavine: { lengthInVoxels: positive, widthInVoxels: positive, heightInVoxels: positive },
        addHollowDome: { ...radius, thicknessInVoxels: positive },
        liftColumn: { ...radius, heightInVoxels: positive, thicknessInVoxels: positive }, scorch: radius
    };
    if (typeof fields.operation !== 'string' || !Object.prototype.hasOwnProperty.call(required, fields.operation))
        invalid(`${path}.operation`, 'Unknown terrain operation');
    const optional: Fields = { offset: vector };
    if (['addSphere', 'addHollowDome', 'scorch'].includes(fields.operation)) optional.materialIdentifier = material;
    if (fields.operation === 'carveShapedBlast')
        for (const key of ['irregularityFraction', 'noiseFrequency', 'rayCount', 'rayLengthInVoxels',
            'rayAngularSharpness', 'rippleRingCount', 'rippleSpacingInVoxels']) optional[key] = terrainFields[key];
    object({ operation: choice(fields.operation), ...required[fields.operation] }, optional)(value, path);
};
const terrainContact = choice('explode', 'bounce', 'tunnel', 'stick', 'pass', 'roll');
const modeFields: Fields = { terrainContact, gravityScale: number(-10, 10), lifetimeSeconds: number(.001, 30),
    speedInVoxelsPerSecond: nonnegative, maximumTravelDistanceInVoxels: positive };
const deployableFields: Fields = {
    modelIdentifier: identifier, delaySeconds: seconds, durationSeconds: seconds, intervalSeconds: seconds,
    shotCount: count, projectileIdentifier: identifier, damageProfileIdentifier: identifier,
    terrainProfileIdentifier: identifier, rangeInVoxels: positive, widthInVoxels: positive, heightInVoxels: positive,
    thicknessInVoxels: positive, radiusInVoxels: positive, lengthInVoxels: positive, speedInVoxelsPerSecond: positive,
    dropSpeedInVoxelsPerSecond: nonnegative, liftInVoxels: positive, materialIdentifier: material,
    embeddedDepthInVoxels: nonnegative,
    coneDegrees: number(0, 360), persistTurns: number(1, 32, true),
    onFinish: (value, path) => actions(value, path)
};

const deployable: Rule = (value, path) => {
    const fields = record(value, path);
    const requiredByKind: Record<string, Array<string>> = {
        turret: ['projectileIdentifier', 'shotCount', 'intervalSeconds'],
        spider: ['damageProfileIdentifier', 'terrainProfileIdentifier', 'rangeInVoxels', 'shotCount', 'delaySeconds'],
        wall: ['widthInVoxels', 'heightInVoxels', 'thicknessInVoxels', 'durationSeconds', 'materialIdentifier'],
        dome: ['radiusInVoxels', 'thicknessInVoxels', 'durationSeconds', 'materialIdentifier'],
        elevator: ['radiusInVoxels', 'thicknessInVoxels', 'liftInVoxels', 'speedInVoxelsPerSecond'],
        ravine: ['lengthInVoxels', 'widthInVoxels', 'heightInVoxels', 'speedInVoxelsPerSecond'],
        storm: ['damageProfileIdentifier', 'terrainProfileIdentifier', 'rangeInVoxels', 'intervalSeconds'],
        marker: ['modelIdentifier', 'persistTurns'],
        airstrike: ['modelIdentifier', 'projectileIdentifier', 'intervalSeconds', 'shotCount', 'heightInVoxels',
            'speedInVoxelsPerSecond']
    };
    if (typeof fields.kind !== 'string' || !Object.prototype.hasOwnProperty.call(requiredByKind, fields.kind))
        invalid(`${path}.kind`, 'Unknown deployable kind');
    const required: Fields = { kind: choice(fields.kind), effectProfileIdentifier: identifier };
    for (const key of requiredByKind[fields.kind]) required[key] = deployableFields[key];
    if (fields.kind === 'wall' || fields.kind === 'dome') required.durationSeconds = number(.001, 30);
    if (fields.kind === 'turret' || fields.kind === 'storm' || fields.kind === 'airstrike')
        required.intervalSeconds = number(.001, 30);
    if (fields.kind === 'elevator') {
        required.thicknessInVoxels = number(1, 128, true);
        required.liftInVoxels = number(1, 128, true);
    }
    object(required, deployableFields)(value, path);
};

let actionDepth = 0;
const action: Rule = (value, path) => {
    if (++actionDepth > weaponMaximumActionDepth) {
        actionDepth--;
        invalid(path, 'Action depth exceeds limit');
    }
    try {
        const fields = record(value, path);
        if (typeof fields.action !== 'string' || !Object.prototype.hasOwnProperty.call(actionRules, fields.action))
            invalid(`${path}.action`, 'Unknown action');
        actionRules[fields.action](value, path);
    } finally {
        actionDepth--;
    }
};
const actions = array(action);
const actionRules: Record<string, Rule> = {};
function actionRule(kind: string, required: Fields, optional: Fields = {}): void {
    actionRules[kind] = object({ action: choice(kind), ...required }, { offset: vector, ...optional });
}
actionRule('launchProjectile', { projectileIdentifier: identifier }, { yawOffsetDegrees: angle, pitchOffsetDegrees: angle,
    speedScale: number(0, 100), speedInVoxelsPerSecond: nonnegative, velocity: vector,
    target: choice('aim', 'nearestTank', 'up', 'down'), origin: choice('context', 'owner', 'sky') });
actionRule('spawnProjectiles', { projectileIdentifier: identifier, count,
    pattern: choice('single', 'spread', 'cone', 'ring', 'fountain', 'sphereShell', 'randomArea', 'line') }, {
    yawSpreadDegrees: number(0, 360), pitchSpreadDegrees: number(0, 180), pitchDegrees: angle,
    coneDegrees: number(0, 360), gridColumns: count,
    radiusInVoxels: nonnegative, speedInVoxelsPerSecond: nonnegative, intervalSeconds: seconds, randomSpread: boolean
});
actionRule('explode', { terrainProfileIdentifier: identifier, damageProfileIdentifier: identifier,
    effectProfileIdentifier: identifier }, { terrainOverrides: object({}, terrainFields), damageOverrides: damage });
actionRule('applyTerrain', { terrainProfileIdentifier: identifier }, { terrainOverrides: object({}, terrainFields) });
actionRule('applyDamage', { damageProfileIdentifier: identifier }, { damageOverrides: damage });
actionRule('playEffect', { effectProfileIdentifier: identifier }, { durationSeconds: seconds });
actionRule('schedule', { delaySeconds: seconds, actions });
actionRule('repeat', { count, intervalSeconds: seconds, actions }, { offsetPerIteration: vector });
actionRule('setProjectileMode', {}, modeFields);
actionRule('setProjectileVelocity', {}, { velocity: vector, speedInVoxelsPerSecond: nonnegative,
    verticalSpeedInVoxelsPerSecond: number(-4096, 4096), horizontalSpeedScale: number(0, 10),
    target: choice('aim', 'nearestTank', 'up', 'down') });
actionRule('fireRay', { lengthInVoxels: positive, radiusInVoxels: nonnegative, damageProfileIdentifier: identifier,
    effectProfileIdentifier: identifier, passesThroughTerrain: boolean }, { terrainProfileIdentifier: identifier,
    target: choice('aim', 'nearestTank', 'allLivingTanks', 'down'), targetRangeInVoxels: positive,
    randomConeDegrees: number(0, 180), origin: choice('context', 'sky'), stopsAtFirstTank: boolean });
actionRule('createLiquid', { kind: choice('oil', 'lava', 'fire'), cellCount: number(1, 4000, true) }, {
    durationSeconds: seconds, spreadBudget: number(0, 4000, true), igniteAfterSeconds: seconds,
    damageProfileIdentifier: identifier
});
actionRule('igniteLiquidNear', { radiusInVoxels: positive });
actionRule('deployEntity', { definition: deployable });
actionRule('liftColumn', { radiusInVoxels: positive, thicknessInVoxels: number(1, 128, true),
    liftInVoxels: number(1, 128, true),
    speedInVoxelsPerSecond: positive });
actionRules.destroySelf = object({ action: choice('destroySelf') });

const projectile = object({ modelIdentifier: identifier }, { ...modeFields, trailEffectIdentifier: identifier,
    massClass: number(.001, 128), speedScale: number(0, 100), tankContact: choice('explode', 'pass'),
    bounce: object({ maximumCount: number(0, 512, true), restitution: number(0, 1) }, {
        verticalSpeedInVoxelsPerSecond: nonnegative, horizontalSpeedScale: number(0, 10), randomHeading: boolean,
        horizontalSpeedInVoxelsPerSecond: nonnegative, nearestTankHeadingBias: number(0, 1),
        bouncesOffTanks: boolean }),
    guidance: object({ target: choice('nearest', 'above'), acquisitionRangeInVoxels: positive,
        speedInVoxelsPerSecond: positive }, { turnRateInDegreesPerSecond: number(0, 3600), delaySeconds: seconds,
        requireLineOfSight: boolean, onlyWhileInTerrain: boolean }),
    hitOncePerBounce: boolean, onLaunch: actions, onFlightTick: object({ everyTicks: number(1, 1800, true), actions }),
    onApex: actions, onTerrainImpact: actions, onTankImpact: actions, onBounce: actions,
    onTimer: object({ afterSeconds: seconds, actions }), onExpire: actions
});
const model = object({ size: tuple([number(1, modelMaximumDimensionInVoxels, true),
    number(1, modelMaximumDimensionInVoxels, true), number(1, modelMaximumDimensionInVoxels, true)]),
pivot: vector, voxels: array(tuple([number(0, modelMaximumDimensionInVoxels - 1, true),
    number(0, modelMaximumDimensionInVoxels - 1, true), number(0, modelMaximumDimensionInVoxels - 1, true), text]),
0, modelMaximumDimensionInVoxels * modelMaximumDimensionInVoxels * modelMaximumDimensionInVoxels) });
const dataRule = object({ weapons: array(object({ identifier, displayName: text, description: text,
    massClass: (value, path) => {
        if (value !== null) number(.001, 128)(value, path);
    }, turretIdentifier: identifier,
    aimPreviewMode: choice('ballistic', 'straight', 'fan', 'self', 'direction', 'none'), onFire: array(action, 1),
    projectiles: dictionary(projectile) }, { fireSoundIdentifier: choice(...Object.keys(soundCatalog)) }), 1, 512),
terrainProfiles: dictionary((value, path) => {
    object({ operations: array(terrainOperation) }, { durationSeconds: number(.001, 10) })(value, path);
    const profile = value as { operations: ReadonlyArray<{ operation: string }>; durationSeconds?: number };
    if (profile.durationSeconds !== undefined && profile.operations.some(entry =>
        !['carveShapedBlast', 'carveSphere', 'addSphere'].includes(entry.operation)))
        invalid(path, 'Only blasts and spheres can be spread over time');
}),
damageProfiles: dictionary(damage), models: dictionary(model), turrets: dictionary(object({
    turretModelIdentifier: identifier, barrelModelIdentifier: identifier, turretPivot: vector, barrelPivot: vector,
    muzzleOffset: vector, recoilDistanceInVoxels: nonnegative })) });

function projectileHooks(definition: ProjectileDefinition): Array<readonly [ReadonlyArray<WeaponAction>, number]> {
    const bounceCount = (definition.bounce?.maximumCount || 0) + 1;
    return [[definition.onLaunch || [], 1], [definition.onApex || [], 1],
        [definition.onTerrainImpact || [], bounceCount],
        [definition.onTankImpact || [], bounceCount * 8], [definition.onBounce || [], bounceCount],
        [definition.onTimer?.actions || [], 1], [definition.onExpire || [], 1],
        [definition.onFlightTick?.actions || [], definition.onFlightTick ? Math.ceil(
            (definition.lifetimeSeconds || 15) * simulationTicksPerSecond / definition.onFlightTick.everyTicks) : 0]];
}

export function validateWeaponData(input: unknown, effectIdentifiers: ReadonlyArray<string>): WeaponDataFiles {
    let normalized = input;
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const source = input as Record<string, unknown>;
        if (source.models && typeof source.models === 'object' && !Array.isArray(source.models)) {
            const entries = Object.entries(source.models);
            const models = entries.map(([modelIdentifier, specification]) => {
                try {
                    return [modelIdentifier, compileVoxelModel(specification)] as const;
                } catch (error) {
                    return invalid(`Models.${modelIdentifier}`, String(error));
                }
            });
            if (models.some((entry, index) => entry[1] !== entries[index][1]))
                normalized = { ...source, models: Object.fromEntries(models) };
        }
    }
    dataRule(normalized, 'WeaponData');
    const data = normalized as WeaponDataFiles;
    const effects = new Set(effectIdentifiers);
    const requireReference = (identifierValue: string | undefined, pool: object | Set<string>, path: string): void => {
        if (identifierValue === undefined) return;
        if (!(pool instanceof Set ? pool.has(identifierValue)
            : Object.prototype.hasOwnProperty.call(pool, identifierValue))) invalid(path, `Dangling id ${identifierValue}`);
    };
    for (const [turretIdentifier, turret] of Object.entries(data.turrets)) {
        requireReference(turret.turretModelIdentifier, data.models, `Turrets.${turretIdentifier}`);
        requireReference(turret.barrelModelIdentifier, data.models, `Turrets.${turretIdentifier}`);
    }
    const identifiers = new Set<string>();
    for (const weapon of data.weapons) {
        const path = `Weapons.${weapon.identifier}`;
        if (identifiers.has(weapon.identifier)) invalid(path, 'Duplicate weapon identifier');
        identifiers.add(weapon.identifier);
        requireReference(weapon.turretIdentifier, data.turrets, path);
        const checkActions = (list: ReadonlyArray<WeaponAction>): void => {
            for (const entry of list) {
                if ('projectileIdentifier' in entry) requireReference(entry.projectileIdentifier, weapon.projectiles, path);
                if ('effectProfileIdentifier' in entry) requireReference(entry.effectProfileIdentifier, effects, path);
                if ('terrainProfileIdentifier' in entry)
                    requireReference(entry.terrainProfileIdentifier, data.terrainProfiles, path);
                if ('damageProfileIdentifier' in entry) requireReference(entry.damageProfileIdentifier, data.damageProfiles, path);
                if ('actions' in entry) checkActions(entry.actions);
                if (entry.action === 'deployEntity') {
                    const definition = entry.definition;
                    requireReference(definition.modelIdentifier, data.models, path);
                    requireReference(definition.projectileIdentifier, weapon.projectiles, path);
                    requireReference(definition.effectProfileIdentifier, effects, path);
                    requireReference(definition.damageProfileIdentifier, data.damageProfiles, path);
                    requireReference(definition.terrainProfileIdentifier, data.terrainProfiles, path);
                    if (definition.onFinish) checkActions(definition.onFinish);
                    if (definition.kind === 'turret' && (!definition.projectileIdentifier || !definition.shotCount ||
                        !definition.intervalSeconds)) invalid(path, 'Turret requires projectile, shot count and interval');
                    if (definition.kind === 'spider' && (!definition.damageProfileIdentifier || !definition.rangeInVoxels))
                        invalid(path, 'Spider requires damage profile and range');
                }
                if (entry.action === 'createLiquid' && entry.kind !== 'oil' && !entry.damageProfileIdentifier)
                    invalid(path, 'Burning liquid requires damage profile');
            }
        };
        checkActions(weapon.onFire);
        for (const [projectileIdentifier, definition] of Object.entries(weapon.projectiles)) {
            requireReference(definition.modelIdentifier, data.models, `${path}.${projectileIdentifier}`);
            requireReference(definition.trailEffectIdentifier, effects, `${path}.${projectileIdentifier}`);
            if (weapon.massClass === null && definition.massClass === undefined)
                invalid(`${path}.${projectileIdentifier}`, 'Projectile requires a mass class');
            if (definition.terrainContact === 'bounce' && !definition.bounce)
                invalid(`${path}.${projectileIdentifier}`, 'Bouncing projectile requires bounce settings');
            for (const [list] of projectileHooks(definition)) checkActions(list);
        }
        const visiting = new Set<string>();
        const countActions = (list: ReadonlyArray<WeaponAction>, depth: number): number => {
            if (depth > weaponMaximumActionDepth) invalid(path, 'Spawn depth exceeds limit');
            let total = 0;
            for (const entry of list) {
                if (entry.action === 'launchProjectile' || entry.action === 'spawnProjectiles')
                    total += countProjectile(entry.projectileIdentifier, depth + 1) *
                        (entry.action === 'spawnProjectiles' ? entry.count : 1);
                if (entry.action === 'deployEntity' && entry.definition.projectileIdentifier)
                    total += countProjectile(entry.definition.projectileIdentifier, depth + 1) *
                        (entry.definition.shotCount || 1);
                if (entry.action === 'deployEntity' && entry.definition.onFinish)
                    total += countActions(entry.definition.onFinish, depth + 1);
                if (entry.action === 'schedule' || entry.action === 'repeat')
                    total += countActions(entry.actions, depth + 1) * (entry.action === 'repeat' ? entry.count : 1);
                if (total > weaponMaximumSpawnsPerFire) invalid(path, 'Spawn count exceeds limit');
            }
            return total;
        };
        const countProjectile = (projectileIdentifier: string, depth: number): number => {
            if (visiting.has(projectileIdentifier)) invalid(path, 'Unbounded projectile spawn recursion');
            visiting.add(projectileIdentifier);
            let total = 1;
            for (const [list, multiplier] of projectileHooks(weapon.projectiles[projectileIdentifier]))
                total += countActions(list, depth) * multiplier;
            visiting.delete(projectileIdentifier);
            if (total > weaponMaximumSpawnsPerFire) invalid(path, 'Spawn count exceeds limit');
            return total;
        };
        countActions(weapon.onFire, 0);
        for (const projectileIdentifier of Object.keys(weapon.projectiles)) countProjectile(projectileIdentifier, 0);
    }
    return data;
}
