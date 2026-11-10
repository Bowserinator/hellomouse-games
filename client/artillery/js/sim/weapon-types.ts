import { DamageProfile } from './damage.js';
import { VoxelModelSpec } from './model-collision.js';

export type VoxelTuple = readonly [number, number, number];
export type TerrainContact = 'explode' | 'bounce' | 'tunnel' | 'stick' | 'pass' | 'roll';
export type PreviewMode = 'ballistic' | 'straight' | 'fan' | 'self' | 'direction' | 'none';

export interface TerrainOperation {
    operation: 'carveSphere' | 'carveShapedBlast' | 'addSphere' | 'carveCapsule' | 'carveLineAlongRay' |
    'carveCylinder' | 'carveRavine' | 'addHollowDome' | 'liftColumn' | 'scorch' | 'addFunnel';
    radiusInVoxels?: number;
    materialIdentifier?: string;
    irregularityFraction?: number;
    noiseFrequency?: number;
    rayCount?: number;
    rayLengthInVoxels?: number;
    rayAngularSharpness?: number;
    rippleRingCount?: number;
    rippleSpacingInVoxels?: number;
    lengthInVoxels?: number;
    heightInVoxels?: number;
    widthInVoxels?: number;
    thicknessInVoxels?: number;
    /** Total opening angle of a cone-shaped edit. */
    spreadDegrees?: number;
    offset?: VoxelTuple;
}

export interface TerrainProfile {
    operations: ReadonlyArray<TerrainOperation>;
    /** Spreads the edit outwards from its centre over this long instead of applying it instantly. */
    durationSeconds?: number;
}
export type TerrainOverrides = Partial<Omit<TerrainOperation, 'operation'>>;

interface OffsetAction {
    offset?: VoxelTuple;
}
interface ExplosionReferences {
    terrainProfileIdentifier: string;
    damageProfileIdentifier: string;
    effectProfileIdentifier: string;
    terrainOverrides?: TerrainOverrides;
    damageOverrides?: Partial<DamageProfile>;
}

interface LaunchAction extends OffsetAction {
    action: 'launchProjectile';
    projectileIdentifier: string;
    yawOffsetDegrees?: number;
    pitchOffsetDegrees?: number;
    speedScale?: number;
    speedInVoxelsPerSecond?: number;
    velocity?: VoxelTuple;
    target?: 'aim' | 'nearestTank' | 'up' | 'down' | 'autoAim';
    origin?: 'context' | 'owner' | 'sky';
}

interface SpawnAction extends OffsetAction {
    action: 'spawnProjectiles';
    projectileIdentifier: string;
    pattern: 'single' | 'spread' | 'cone' | 'ring' | 'fountain' | 'sphereShell' | 'randomArea' | 'line';
    count: number;
    yawSpreadDegrees?: number;
    pitchSpreadDegrees?: number;
    pitchDegrees?: number;
    coneDegrees?: number;
    gridColumns?: number;
    radiusInVoxels?: number;
    speedInVoxelsPerSecond?: number;
    intervalSeconds?: number;
    randomSpread?: boolean;
    aimAtProjectedImpact?: boolean;
}

interface TimedActions extends OffsetAction {
    action: 'schedule';
    delaySeconds: number;
    actions: ReadonlyArray<WeaponAction>;
}

interface RepeatedActions extends OffsetAction {
    action: 'repeat';
    count: number;
    intervalSeconds: number;
    offsetPerIteration?: VoxelTuple;
    actions: ReadonlyArray<WeaponAction>;
}

export interface ProjectileMode {
    terrainContact?: TerrainContact;
    gravityScale?: number;
    lifetimeSeconds?: number;
    speedInVoxelsPerSecond?: number;
    maximumTravelDistanceInVoxels?: number;
}

interface ModeAction extends ProjectileMode {
    action: 'setProjectileMode';
}
interface VelocityAction {
    action: 'setProjectileVelocity';
    velocity?: VoxelTuple;
    speedInVoxelsPerSecond?: number;
    verticalSpeedInVoxelsPerSecond?: number;
    horizontalSpeedScale?: number;
    target?: 'aim' | 'nearestTank' | 'up' | 'down';
}

interface RayAction extends OffsetAction {
    action: 'fireRay';
    lengthInVoxels: number;
    radiusInVoxels: number;
    damageProfileIdentifier: string;
    effectProfileIdentifier: string;
    terrainProfileIdentifier?: string;
    passesThroughTerrain: boolean;
    stopsAtFirstTank?: boolean;
    damagesOwner?: boolean;
    target?: 'aim' | 'nearestTank' | 'allLivingTanks' | 'down';
    targetRangeInVoxels?: number;
    randomConeDegrees?: number;
    /** Once the ray passes this close to an enemy tank, it turns and heads straight for it. */
    bendTowardTankRangeInVoxels?: number;
    origin?: 'context' | 'sky';
}

interface LiquidAction extends OffsetAction {
    action: 'createLiquid';
    kind: 'oil' | 'lava' | 'fire';
    cellCount: number;
    durationSeconds?: number;
    spreadBudget?: number;
    igniteAfterSeconds?: number;
    damageProfileIdentifier?: string;
}

export interface DeployableDefinition {
    kind: 'turret' | 'spider' | 'wall' | 'dome' | 'elevator' | 'ravine' | 'storm' | 'marker' | 'airstrike' |
    'scanner' | 'tornado';
    modelIdentifier?: string;
    effectProfileIdentifier: string;
    delaySeconds?: number;
    durationSeconds?: number;
    intervalSeconds?: number;
    shotCount?: number;
    projectileIdentifier?: string;
    damageProfileIdentifier?: string;
    terrainProfileIdentifier?: string;
    rangeInVoxels?: number;
    widthInVoxels?: number;
    heightInVoxels?: number;
    thicknessInVoxels?: number;
    spacingInVoxels?: number;
    radiusInVoxels?: number;
    lengthInVoxels?: number;
    speedInVoxelsPerSecond?: number;
    dropSpeedInVoxelsPerSecond?: number;
    liftInVoxels?: number;
    materialIdentifier?: string;
    embeddedDepthInVoxels?: number;
    coneDegrees?: number;
    persistTurns?: number;
    onFinish?: ReadonlyArray<WeaponAction>;
}

export type WeaponAction = LaunchAction | SpawnAction | TimedActions | RepeatedActions | ModeAction | VelocityAction |
RayAction | LiquidAction | (OffsetAction & ExplosionReferences & { action: 'explode' }) |
(OffsetAction & { action: 'applyTerrain'; terrainProfileIdentifier: string; terrainOverrides?: TerrainOverrides;
    centerOnTargetTank?: boolean }) |
(OffsetAction & { action: 'applyDamage'; damageProfileIdentifier: string; damageOverrides?: Partial<DamageProfile> }) |
(OffsetAction & { action: 'playEffect'; effectProfileIdentifier: string; durationSeconds?: number }) |
(OffsetAction & { action: 'igniteLiquidNear'; radiusInVoxels: number }) |
(OffsetAction & { action: 'boostOwner'; speedInVoxelsPerSecond: number; upwardBias?: number }) |
(OffsetAction & { action: 'repairTank'; hitPoints: number }) |
(OffsetAction & { action: 'teleportOwner'; effectProfileIdentifier: string }) |
(OffsetAction & { action: 'deployEntity'; definition: DeployableDefinition;
    /** Gives the deployable the point where the projectile is predicted to land. */
    atProjectedImpact?: boolean }) |
(OffsetAction & { action: 'liftColumn'; radiusInVoxels: number; thicknessInVoxels: number; liftInVoxels: number;
    speedInVoxelsPerSecond: number; }) | { action: 'destroySelf' };

export interface GuidanceDefinition {
    target: 'nearest' | 'above';
    acquisitionRangeInVoxels: number;
    speedInVoxelsPerSecond: number;
    turnRateInDegreesPerSecond?: number;
    delaySeconds?: number;
    requireLineOfSight?: boolean;
    onlyWhileInTerrain?: boolean;
}

export interface BounceDefinition {
    maximumCount: number;
    restitution: number;
    verticalSpeedInVoxelsPerSecond?: number;
    horizontalSpeedScale?: number;
    randomHeading?: boolean;
    horizontalSpeedInVoxelsPerSecond?: number;
    /** 0 is a fully random heading after each bounce, 1 is straight toward the nearest enemy tank. */
    nearestTankHeadingBias?: number;
    bouncesOffTanks?: boolean;
}

export interface GravityWellDefinition {
    radiusInVoxels: number;
    /** Pull on other projectiles at the centre, fading to nothing at the edge of the radius. */
    accelerationInVoxelsPerSecondSquared: number;
}

export interface ProjectileDefinition extends ProjectileMode {
    modelIdentifier: string;
    trailEffectIdentifier?: string;
    massClass?: number;
    speedScale?: number;
    tankContact?: 'explode' | 'pass';
    bounce?: BounceDefinition;
    guidance?: GuidanceDefinition;
    gravityWell?: GravityWellDefinition;
    hitOncePerBounce?: boolean;
    onLaunch?: ReadonlyArray<WeaponAction>;
    onFlightTick?: { everyTicks: number; actions: ReadonlyArray<WeaponAction> };
    onApex?: ReadonlyArray<WeaponAction>;
    onTerrainImpact?: ReadonlyArray<WeaponAction>;
    onTankImpact?: ReadonlyArray<WeaponAction>;
    onBounce?: ReadonlyArray<WeaponAction>;
    onTimer?: { afterSeconds: number; actions: ReadonlyArray<WeaponAction> };
    onExpire?: ReadonlyArray<WeaponAction>;
}

export interface WeaponDefinition {
    identifier: string;
    displayName: string;
    description: string;
    fireSoundIdentifier?: string;
    massClass: number | null;
    turretIdentifier: string;
    aimPreviewMode: PreviewMode;
    onFire: ReadonlyArray<WeaponAction>;
    projectiles: Readonly<Record<string, ProjectileDefinition>>;
}

export interface TurretDefinition {
    turretModelIdentifier: string;
    barrelModelIdentifier: string;
    turretPivot: VoxelTuple;
    barrelPivot: VoxelTuple;
    muzzleOffset: VoxelTuple;
    recoilDistanceInVoxels: number;
}

export interface WeaponDataFiles {
    weapons: ReadonlyArray<WeaponDefinition>;
    terrainProfiles: Readonly<Record<string, TerrainProfile>>;
    damageProfiles: Readonly<Record<string, DamageProfile>>;
    models: Readonly<Record<string, VoxelModelSpec>>;
    turrets: Readonly<Record<string, TurretDefinition>>;
}
