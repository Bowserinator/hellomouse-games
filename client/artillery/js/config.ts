// -----------------------------------------------------------------------------
// World size and layers
// -----------------------------------------------------------------------------
export const worldChunkEdgeLengthInVoxels = 32;
export const worldHeightInVoxels = 512;
/** Multiplier applied to the height of all generated terrain above the minimum height. */
export const terrainHeightScale = 1.2;
export const worldMapEdgeLengthOptionsInVoxels = [256, 512, 256 * 3] as const;
export const worldIndestructibleMaximumLayerIndex = 1;
export const worldWaterSurfaceHeightInVoxels = 2;
export const oceanRenderHeightInVoxels = 1.5;
export const oceanEdgeFadeWidthInVoxels = 32;
export const worldSeabedTransitionWidthInVoxels = 32;
export const worldBoundaryInsetInVoxels = 4;
export const worldDenseMemoryCeilingInBytes = 96 * 1024 * 1024;

// -----------------------------------------------------------------------------
// Simulation timing
// -----------------------------------------------------------------------------
export const simulationTicksPerSecond = 60;
export const resolveMaximumDurationInSeconds = 30;
export const resolveFastForwardTicksPerFrame = 30;
export const resolveMovementSpeedMultiplier = 3;

// -----------------------------------------------------------------------------
// World generation
// -----------------------------------------------------------------------------
export const islandRadiusFraction = 0.42;
export const worldNoiseOctaveCount = 4;
export const worldGenerationMaximumAttempts = 8;
export const decorationCellEdgeLengthInVoxels = 16;
export const worldTreeProbability = 0.35;
export const worldCaveProbability = 0.12;
export const worldFloatingIslandProbability = 0.035;
export const spawnMinimumSeparationInVoxels = 16;
export const spawnWalkabilityGridSpacingInVoxels = 4;
export const spawnMinimumDryHeightInVoxels = 4;
export const spawnMaximumSurfaceSlope = 0.65;
export const worldFallbackDiscRadiusFraction = 0.3;
export const worldFallbackSurfaceHeightInVoxels = 12;
export const centerElevationBoostInVoxels = 30;

export const worldGenerationNoise = {
    terrainForkLabel: 1001,
    floatingIslandForkLabel: 2001,
    caveForkOffset: 3001,
    decorationForkLabel: 4001,
    themeForkLabel: 6001,
    offsetCount: 16,
    offsetMaximum: 10000,
    secondAxisStreamOffset: 5,
    thirdAxisStreamOffset: 11
} as const;

export const islandThemeIdentifiers = ['grassy', 'mesa', 'desert', 'snow', 'lava'] as const;
export const islandThemeNames = ['Grassy', 'Mesa', 'Desert', 'Snow', 'Lava'] as const;
/** Island theme setting value that picks a theme from the match seed. */
export const randomIslandTheme = 0;

export const worldTerrainSettings = {
    boundaryMinimumFraction: .08,
    boundaryMaximumFraction: .92,
    warpScale: 95,
    warpStrength: .2,
    coastNoiseScale: 53,
    coastNoiseStrength: .1,
    coastTransitionWidth: .22,
    hillAmplitude: 12,
    hillScale: 70,
    hillAmplitudeMultiplier: .5,
    hillFrequencyMultiplier: 2,
    regionScale: 170,
    ridgeScale: 44,
    ridgeHeight: 48,
    ridgeHillWeight: .2,
    terraceScale: 110,
    terraceCount: 4,
    terraceRiserStart: .35,
    terraceRiserWidth: .3,
    terraceHeight: 11,
    mesaScale: 80,
    mesaRiserStart: .42,
    mesaRiserMultiplier: 9,
    mesaBaseHeight: 8,
    mesaHeight: 44,
    chainScaleX: 40,
    chainScaleZ: 40,
    chainWarpStrength: .25,
    chainHeight: 66,
    duneBaseHeight: 5,
    duneFrequency: .25,
    duneNoiseScale: 65,
    duneNoiseStrength: 9,
    duneAmplitude: 3,
    gullyScale: 34,
    gullyBaseHeight: 20,
    gullyDepth: 24,
    hillBaseHeight: 6,
    coastalDuneWidth: .25,
    minimumHeight: 2,
    ceilingPadding: 20,
    moistureScale: 89,
    strataPeriod: 16,
    lightStrataThickness: 2,
    darkStrataTop: 4,
    darkStoneTop: 24
} as const;

export const worldCaveSettings = {
    minimumHeight: 6,
    activationCellEdge: 16,
    warpScale: 29,
    warpStrength: 5,
    firstHorizontalScale: 13,
    firstVerticalScale: 11,
    secondHorizontalScale: 15,
    secondVerticalScale: 12,
    cavityHorizontalScale: 18,
    cavityVerticalScale: 13,
    tubeHalfWidth: .13,
    cavityRoofDepth: 3,
    cavityThreshold: .72
} as const;

export const worldFloatingIslandSettings = {
    minimumSurfaceHeight: 5,
    surfaceCeilingPadding: 52,
    minimumRadius: 6,
    maximumRadius: 14,
    separationPadding: 8,
    ceilingPadding: 12,
    minimumElevation: 40,
    maximumElevation: 100,
    minimumDepth: 9,
    maximumDepth: 22,
    treeProbability: .5,
    upperBoundsPadding: 3,
    lowerBoundsPadding: 8,
    topNoiseScale: 6,
    topNoiseHeight: 3,
    topHeightOffset: 1,
    stalactiteFrequency: .6,
    stalactiteThreshold: .7,
    stalactiteLength: 7,
    soilDepth: 2,
    treeHeight: 6
} as const;

export const worldDecorationSettings = {
    chunkPadding: 7,
    treeMinimumHeight: 7,
    treeMaximumHeight: 78,
    treeMaximumSlope: 1.6,
    treeMinimumMoisture: .28,
    leaflessMinimumHeight: 50,
    pineMinimumHeight: 34,
    multiTrunkMinimumMoisture: .66,
    treeMinimumTrunkHeight: 5,
    treeMaximumTrunkHeight: 9,
    boulderMinimumHeight: 6,
    boulderMaximumSlope: 2,
    boulderProbability: .12,
    boulderMinimumRadius: 1,
    boulderMaximumRadius: 3,
    boulderVerticalScale: 1.4,
    treeBoundsRadius: 6,
    treeBoundsTopPadding: 4,
    multiTrunkCount: 3,
    multiTrunkOffsetX: 2,
    multiTrunkOffsetZ: 1,
    treeTopPadding: 3,
    treeCanopyRadius: 4,
    leaflessBranchBelowTop: 2,
    leaflessBranchReach: 2,
    pineTopPadding: 2,
    pineRadiusPerHeight: .45,
    pineMinimumFoliageHeight: 2,
    canopyCentreBelowTop: 1,
    canopyVerticalScale: .8,
    canopyRadiusSquared: 12
} as const;

// -----------------------------------------------------------------------------
// Terrain palette bands
// -----------------------------------------------------------------------------
export const terrainSandMaximumHeightInVoxels = 6;
export const terrainRockMinimumHeightInVoxels = 48;
export const terrainSnowMinimumHeightInVoxels = 76;
export const terrainSoilDepthInVoxels = 3;
export const terrainUnderwaterVariationMultiplier = 3;
export const terrainRemovedVoxelSampleLimit = 64;
// When enabled every material is carved equally easily and per-material blast resistance is ignored
export const terrainUsesUniformBlastResistance = true;
export const terrainUniformBlastResistance = 0;
export const terrainRavineMinimumWidthFraction = 4 / 7;
export const terrainRavineWidthNoiseFrequency = .15;

// -----------------------------------------------------------------------------
// Tanks
// -----------------------------------------------------------------------------
export const tankHullLengthInVoxels = 7;
export const tankHullWidthInVoxels = 5;
export const tankHullHeightInVoxels = 3;
export const tankDefaultHitPoints = 100;
export const tankWaterDamagePerTurn = 10;
export const tankMass = 10;
export const tankBuriedSnapMaximumInVoxels = 6;
export const tankFallDamagePerVoxelBeyondSafeHeight = 0;
export const tankFallDamageSafeHeightInVoxels = 999;
export const tankSettledHeightToleranceInVoxels = 1e-7;

// -----------------------------------------------------------------------------
// Movement
// -----------------------------------------------------------------------------
export const tankMovementSpeedInVoxelsPerSecond = 7;
export const tankMaximumClimbSlopeInDegrees = 60;
export const tankMaximumClimbSlopeTangent = 1.7320508075688772;
export const tankHullTurnRateInDegreesPerSecond = 90;
export const tankMovementTimeBudgetPerTurnInSeconds = 10;
export const tankStepUpMaximumInVoxels = 2;
export const tankCollisionInsetInVoxels = .25;
export const tankStepDownMaximumInVoxels = 2;
export const tankSlopeBaselineInVoxels = 1;
export const tankClimbSpeedInVoxelsPerSecond = 8;
export const tankGravityInVoxelsPerSecondSquared = 30;
export const tankAirborneHorizontalDrag = 0.99;

// -----------------------------------------------------------------------------
// Turret limits
// -----------------------------------------------------------------------------
export const turretYawQuantizationSteps = 4096;
export const turretDefaultPitchInDegrees = 45;
export const turretPitchMinimumDegrees = -10;
export const turretPitchMaximumDegrees = 89;
export const turretPitchQuantizationSteps = 4096;
export const powerCentipercentMaximum = 10000;
export const powerDefaultCentipercent = 5000;
export const turretBarrelLengthInVoxels = 4;
export const modelMaximumDimensionInVoxels = 64;
export const modelMaximumPrimitiveCount = 128;

// -----------------------------------------------------------------------------
// Projectile physics
// -----------------------------------------------------------------------------
export const projectileGravityInVoxelsPerSecondSquared = 30;
export const projectileMaximumMuzzleSpeedInVoxelsPerSecond = 80;
export const projectileFiringSpeedMultiplier = 2;
export const gravityWellMinimumDistanceInVoxels = 4;
export const practiceSettings = {
    playerCount: 4, mapEdgeLengthInVoxels: 256, hitPointsPerTank: 1000, targetHitPoints: 100
} as const;
export const projectileReferenceMass = 1;
export const projectileMaximumSubstepDistanceInVoxels = 1;
export const projectileDefaultLifetimeInSeconds = 15;
export const weaponMaximumSpawnsPerFire = 512;
export const weaponMaximumActionDepth = 16;
export const weaponDeckShuffleForkLabel = 6001;
export const weaponRoundShuffleForkLabel = 7001;
export const weaponRayContactSearchIterations = 32;
export const airstrikeLineSegmentLengthInVoxels = 8;
export const airstrikeLineHoverInVoxels = 1.5;

// -----------------------------------------------------------------------------
// Explosion defaults
// -----------------------------------------------------------------------------
export const explosionDefaultKnockbackImpulse = 100;
export const explosionDefaultUpwardBias = 0.35;
export const explosionDefaultIrregularityFraction = 0.12;
export const liquidStepIntervalInTicks = 4;
export const liquidMaximumCellCount = 4000;
export const fireDurationInSeconds = 10;
export const fireSplashRadiusInVoxels = 3;
export const fireIgnitionHopDelayInSeconds = .1;
export const fireDefaultDamagePerSecond = 2;

// -----------------------------------------------------------------------------
// Match rules
// -----------------------------------------------------------------------------
export const protocolVersion = 10;
export const teamNames = ['Red', 'Blue', 'Green', 'Yellow'] as const;
export const teamGlyphs = ['◆', '●', '▲', '■'] as const;
export const teamPrimaryColours = [0xe35a58, 0x5c9de0, 0x75b968, 0xe0bc4c] as const;
export const teamSecondaryBrightnessFraction = .55;
export const planningPreviewInterpolationRatePerSecond = 20;
export const planningPreviewOpacity = .45;
export const headingArrowOffsetInVoxels = 1.5;
export const headingArrowHeightInVoxels = 2;
export const headingArrowShaftLengthInVoxels = 2;
export const headingArrowShaftRadiusInVoxels = .25;
export const headingArrowHeadLengthInVoxels = 1.6;
export const headingArrowHeadRadiusInVoxels = .75;
export const hitboxOpacity = .9;
export const weaponUsesPerDealtWeapon = 1;
export const stalemateRotationsWithoutShots = 2;
export const defaultMovePlanTimeLimitInSeconds = 30;
export const defaultFirePlanTimeLimitInSeconds = 90;

export interface MatchSettings {
    teamCount: number;
    hitPointsPerTank: number;
    weaponsPerPlayer: number;
    movementTimePerTurnInSeconds: number;
    movePlanningTimeLimitInSeconds: number;
    firePlanningTimeLimitInSeconds: number;
    mapEdgeLengthInVoxels: number;
    timeOfDay: number;
    islandTheme: number;
    isSandbox: boolean;
    isFriendlyFireEnabled: boolean;
    isInfiniteRounds: boolean;
    roundCount: number;
    scoreMode: number;
}

export const matchSettingKeys: ReadonlyArray<keyof MatchSettings> = [
    'teamCount', 'hitPointsPerTank', 'weaponsPerPlayer', 'movementTimePerTurnInSeconds',
    'movePlanningTimeLimitInSeconds', 'firePlanningTimeLimitInSeconds', 'mapEdgeLengthInVoxels', 'timeOfDay', 'islandTheme', 'isSandbox', 'isFriendlyFireEnabled',
    'isInfiniteRounds', 'roundCount', 'scoreMode'
];

export const defaultMatchSettings: Readonly<MatchSettings> = Object.freeze({
    teamCount: 2,
    hitPointsPerTank: tankDefaultHitPoints,
    weaponsPerPlayer: 20,
    movementTimePerTurnInSeconds: tankMovementTimeBudgetPerTurnInSeconds,
    movePlanningTimeLimitInSeconds: defaultMovePlanTimeLimitInSeconds,
    firePlanningTimeLimitInSeconds: defaultFirePlanTimeLimitInSeconds,
    mapEdgeLengthInVoxels: 512,
    timeOfDay: 0,
    islandTheme: randomIslandTheme,
    isSandbox: false,
    isFriendlyFireEnabled: true,
    isInfiniteRounds: true,
    roundCount: 10,
    scoreMode: 0
});

export const matchSettingIntegerRanges = {
    teamCount: [2, 4, 1],
    hitPointsPerTank: [50, 1000, 50],
    weaponsPerPlayer: [1, 40, 1],
    movementTimePerTurnInSeconds: [2, 15, 1],
    movePlanningTimeLimitInSeconds: [5, 600, 1],
    firePlanningTimeLimitInSeconds: [15, 600, 1],
    timeOfDay: [0, 2, 1],
    islandTheme: [0, islandThemeIdentifiers.length, 1],
    roundCount: [1, 100, 1],
    scoreMode: [0, 2, 1]
} as const;

export const scoreModeNames = ['Damage dealt', 'HP remaining', 'Elimination order'] as const;

export function isMatchSettingValid(key: string, value: unknown): key is keyof MatchSettings {
    if (key === 'isSandbox' || key === 'isFriendlyFireEnabled' || key === 'isInfiniteRounds')
        return typeof value === 'boolean';
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return false;
    if (key === 'mapEdgeLengthInVoxels')
        return worldMapEdgeLengthOptionsInVoxels.some(option => option === value);
    if (!Object.prototype.hasOwnProperty.call(matchSettingIntegerRanges, key)) return false;
    const [minimum, maximum, increment] = matchSettingIntegerRanges[key as keyof typeof matchSettingIntegerRanges];
    return value >= minimum && value <= maximum && (value - minimum) % increment === 0;
}

// -----------------------------------------------------------------------------
// Lobby limits
// -----------------------------------------------------------------------------
export const lobbyMaximumPlayerCount = 16;
export const lobbyMinimumPlayerCount = 2;
export const lobbyMaximumRoomCount = 10;
export const usernameMaximumLength = 16;
export const lobbyBackgroundMapEdgeLengthInVoxels = 192;
export const lobbyBackgroundSettings = Object.freeze({
    resolutionScale: .5,
    orbitRadiansPerSecond: .025,
    cameraRadiusInVoxels: 220,
    cameraHeightInVoxels: 110,
    cameraFocusHeightInVoxels: 24,
    dayDuskCycleInSeconds: 120,
    skyRefreshIntervalInSeconds: .25,
    shellIntervalInSeconds: 12,
    shellIntervalVariationInSeconds: 8,
    shellFlightInSeconds: 4,
    shellDistanceInVoxels: 160,
    shellHeightInVoxels: 42,
    shellArcHeightInVoxels: 60,
    shellHorizonRadiusInVoxels: 145,
    shellSizeInVoxels: .8,
    shellColour: 0xffdc9b,
    shellGlow: 3,
    shellSmokeIntervalInSeconds: .1,
    shellPuffCount: 16,
    shellPuffStartSizeInVoxels: 2,
    shellPuffEndSizeInVoxels: 7
});

// -----------------------------------------------------------------------------
// Networking
// -----------------------------------------------------------------------------
export const planningPreviewUpdatesPerSecond = 15;
export const loadTimeoutInSeconds = 90;
export const resolveReportTimeoutInSeconds = 45;
export const serverDeadlineCheckIntervalInMilliseconds = 100;
export const planAutoSubmitGraceInMilliseconds = 2000;
export const defaultWeaponIdentifier = 'single_shot';
export const reconnectAuthenticationTimeoutInSeconds = 10;
export const pingIntervalInMilliseconds = 2000;
export const weaponIdentifierMaximumLength = 64;

// -----------------------------------------------------------------------------
// Camera
// -----------------------------------------------------------------------------
export const cameraControlBindings = Object.freeze({ orbitButton: 0, panButton: 2, shiftOrbitsAsPan: true });
export const keyboardBindings = Object.freeze({
    forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD',
    projection: 'KeyO', xray: 'KeyX', fastForward: 'Space', lock: 'Enter'
});
export const cameraMinimumDistanceInVoxels = 12;
export const cameraMaximumDistanceInVoxels = 1400;
export const cameraDefaultDistanceInVoxels = 180;
export const cameraShotFollowDistanceInVoxels = 260;
export const cameraFieldOfViewInDegrees = 50;
export const cameraAutoFollowResumeDelayInSeconds = 5;
export const cameraShakeEnabled = true;
export const cameraDefaultPitchInRadians = .65;
export const cameraMinimumPitchInRadians = .05;
export const cameraMaximumPitchInRadians = Math.PI / 2 - .03;
export const cameraOrbitSensitivity = .005;
export const cameraZoomSensitivity = .001;
export const cameraTargetEasePerSecond = 5;
export const cameraFrameMargin = 1.4;
export const cameraCollisionPaddingInVoxels = .5;
export const cameraPerspectiveNearPlane = .1;
export const cameraPerspectiveFarPlane = 4096;
export const cameraOrthographicNearPlane = .05;
export const cameraOrthographicFarPlane = 3072;
export const cameraExplosionFocusBias = 12;
export const cameraExplosionFocusDecayPerSecond = 1.5;
export const cameraShakeDecayPerSecond = 8;
export const cameraShakeNoiseFrequency = 28;
export const cameraShakeRadiusScale = .15;

// -----------------------------------------------------------------------------
// Rendering quality presets
// -----------------------------------------------------------------------------
export const renderingQualityPresets = {
    low: { maximumRenderScale: 0.6, shadowMapSize: 0, bloomMipCount: 3, bloomScale: .25,
        shockwaveCount: 1, particleMultiplier: 0.4, drawDistance: 400 },
    medium: {
        maximumRenderScale: 0.85, shadowMapSize: 1024, bloomMipCount: 4, bloomScale: .375,
        shockwaveCount: 2, particleMultiplier: 0.7, drawDistance: 700
    },
    high: { maximumRenderScale: 1, shadowMapSize: 2048, bloomMipCount: 5, bloomScale: .5,
        shockwaveCount: 4, particleMultiplier: 1, drawDistance: 1200 }
} as const;
export const chunkRemeshJobsPerFrame = 4;
export const renderingMaximumWorkerCount = 4;
export const renderingMainThreadMeshingBudgetInMilliseconds = 3;
export const renderingMinimumScale = 0.35;
export const renderingMaximumDevicePixelRatio = 2;
export const renderingMaximumFrameDeltaInSeconds = .1;
export const explosionLightDurationInSeconds = .6;
export const explosionLightRadiusMultiplier = 2;
export const explosionLightDecayPerSecond = 8;
export const explosionLightMinimumGlow = 2;
export const scorchDurationInSeconds = 20;
export const liquidSurfaceThicknessInVoxels = .15;
export const liquidSurfaceInsetInVoxels = .02;
export const liquidOilColour = 0x252228;
export const liquidLavaColour = 0xff6c12;
export const liquidLavaGlow = 3;
export const liquidFireColour = 0xff8a22;
export const liquidFireGlow = 2.2;
export const liquidFireFadeSeconds = 1;
export const liquidMaximumEmittersPerTick = 128;
export const liquidRisingFlameChance = .06;
export const liquidRisingFlameEmitter = {
    pool: 'fire',
    count: 1,
    shape: 'cone',
    speed: [5, 10],
    lifetime: [.8, 1.6],
    size: [.8, .15],
    colours: ['#ffd27a', '#e0451a'],
    drag: .3,
    gravityScale: 0,
    spin: [-2, 2],
    glow: 3,
    coneAngleInDegrees: 12
} as const;
export const wreckSmokeEmitter = {
    pool: 'smoke',
    count: 2,
    shape: 'cone',
    speed: [.6, 1.4],
    lifetime: [1.5, 2.5],
    size: [.6, 2],
    colours: ['#38332e', '#171715'],
    drag: .4,
    gravityScale: 0,
    spin: [-1, 1],
    glow: 0,
    coneAngleInDegrees: 20
} as const;
export const terrainDebrisEmitter = {
    pool: 'debris',
    count: 24,
    shape: 'cone',
    speed: [3, 10],
    lifetime: [.5, 1.5],
    size: [.35, .15],
    colours: ['#b58d60', '#66533d'],
    drag: .2,
    gravityScale: 1,
    spin: [-4, 4],
    glow: 0,
    coneAngleInDegrees: 65
} as const;
export const liquidFlameEmitter = {
    pool: 'fire',
    count: 2,
    shape: 'cone',
    speed: [.4, 1.5],
    lifetime: [.6, 1.2],
    size: [1, .3],
    colours: ['#ffcf69', '#dd3612'],
    drag: .5,
    gravityScale: 0,
    spin: [-2, 2],
    glow: 3,
    coneAngleInDegrees: 25
} as const;
export const skyCubeFaceResolution = 128;
export const skyZenithColour = 0x6c9ed4;
export const skyHorizonColour = 0xc4e2ef;
export const skyCloudColour = 0xfaf7ee;
export const skyCloudThreshold = .5;
export const skyCloudSoftness = .15;
export const skySunAngularRadiusInDegrees = .9;
export const sunlightDirection = Object.freeze({ x: -.5, y: .85, z: .3 });
export const sunlightIntensity = 0.75;
export const skyAmbientIntensity = .65;
export const sunlightShadowBias = -.0003;
export interface SkyPreset {
    name: string;
    zenithColour: number;
    horizonColour: number;
    cloudColour: number;
    cloudThreshold: number;
    sunDirection: Readonly<{ x: number; y: number; z: number }>;
    sunColour: number;
    sunIntensity: number;
    ambientIntensity: number;
    sunDiscColour?: number;
    groundColour?: number;
    starDensity?: number;
    lightLevel?: number;
}
export const skyPresets: ReadonlyArray<Readonly<SkyPreset>> = [
    { name: 'clear_day', zenithColour: skyZenithColour, horizonColour: skyHorizonColour,
        cloudColour: skyCloudColour, cloudThreshold: skyCloudThreshold, sunDirection: sunlightDirection,
        sunColour: 0xfff5df, sunIntensity: sunlightIntensity, ambientIntensity: skyAmbientIntensity },
    { name: 'golden_hour', zenithColour: 0x777da8, horizonColour: 0xf4b889,
        cloudColour: 0xffd8ac, cloudThreshold: .52, sunDirection: { x: -.7, y: .35, z: .5 },
        sunColour: 0xffbf78, sunIntensity: .95, ambientIntensity: .5 },
    { name: 'overcast', zenithColour: 0x8b9aa8, horizonColour: 0xc7d2d9,
        cloudColour: 0xe3e6e5, cloudThreshold: .32, sunDirection: { x: -.3, y: .9, z: .4 },
        sunColour: 0xe4ecf4, sunIntensity: .4, ambientIntensity: .8 }
];
export const timeOfDayNames = ['Day', 'Sunset', 'Night'] as const;
export const timeOfDayPresets: ReadonlyArray<Readonly<SkyPreset>> = [
    { name: 'noon', zenithColour: 0x3a78c8, horizonColour: 0xb4d4ee, cloudColour: 0xffffff,
        cloudThreshold: skyCloudThreshold, sunDirection: { x: -.12, y: .98, z: .1 },
        sunColour: 0xfffaf0, sunIntensity: 1.15, ambientIntensity: .7 },
    skyPresets[1],
    { name: 'moonlit_night', zenithColour: 0x02040c, horizonColour: 0x080d1c, cloudColour: 0x141a2c,
        cloudThreshold: .5, sunDirection: { x: .45, y: .6, z: -.4 }, sunColour: 0x9fb6ff,
        sunIntensity: .18, ambientIntensity: .12, sunDiscColour: 0xeef3ff, groundColour: 0x080b16,
        starDensity: .003, lightLevel: .08 }
];
export const modelPaintColours: Readonly<Record<string, number>> = Object.freeze({
    black: 0x050508, blue: 0x507ed0, brown: 0x795037, cyan: 0x59d5dd, dark: 0x252c35, glass: 0x8ebdca,
    gold: 0xd9b54d, green: 0x6caa54, grey: 0x858d97, ice: 0xb9e7f0, lime: 0xa2db5c,
    metal: 0xadb7c2, oil: 0x302839, orange: 0xf09235, pink: 0xdc75a8, purple: 0x8f5fd0, red: 0xc95348,
    string: 0xc5b9a1, track: 0x343a43, white: 0xeeeeea, yellow: 0xf5d451
});

// -----------------------------------------------------------------------------
// Bloom
// -----------------------------------------------------------------------------
export const bloomThreshold = 1;
export const bloomSoftKnee = 0.5;
export const bloomIntensity = 0.65;
export const bloomBoostMaximum = 2.5;
export const bloomBoostDecayPerSecond = 3;
export const skyDriftRadiansPerSecond = .0015;
export const oceanMaximumFogDensity = .0017;
export const oceanDefaultFogFraction = .2;
export const oceanFogDensity = oceanMaximumFogDensity * oceanDefaultFogFraction;
export const oceanReflectionBrightnessBoost = .2;
export const oceanReflectionBandCount = 3;
export const oceanDepthBandWidthInVoxels = 2;
export const oceanFoamRadiusInVoxels = 6;
export const oceanFoamReachDepthInVoxels = 12;
export const oceanFoamWaveCount = 2;
export const oceanFoamWaveSpeed = .12;
export const oceanWaterLiquid = Object.freeze({
    absorption: [.13, .047, .027] as const,
    scatter: [.014, .105, .17] as const,
    foam: [.85, .96, 1] as const,
    emissive: 0
});
export const shockwaveDurationInSeconds = .8;
export const shockwaveThicknessFraction = .12;
export const ditherTextureSize = 64;
export const shockwaveMaximumCount = 4;
export const explosionMaximumLightCount = 8;

// -----------------------------------------------------------------------------
// Particles
// -----------------------------------------------------------------------------
export const particlePoolCapacities = { debris: 6000, smoke: 3000, fire: 3000, sparks: 3000 } as const;
export const particleMaximumScheduledEmitters = 512;
export const beamMaximumSegmentCount = 512;
export const beamMinimumThicknessInVoxels = .12;
export const beamGlowIntensity = 4;
export const beamPillarExtensionInVoxels = 16384;
export const beamPillarHoldFraction = .67;
export const shotTrailLifetimeInSeconds = 5;
export const shotTrailMaximumSegmentCount = 32768;
export const shotTrailGlowIntensity = 4;
export const accretionDiskRingRadiiInVoxels = [1.7, 2.4, 3.1] as const;
export const accretionDiskRingParticleCounts = [8, 12, 16] as const;
export const accretionDiskParticleSizeInVoxels = .45;
export const accretionDiskTiltInRadians = .45;
export const accretionDiskSpinRadiansPerSecond = 9;
export const accretionDiskGlowIntensity = 2.5;
export const lightningSegmentCount = 8;
export const lightningJitterFraction = .04;
export const lightningBranchLengthFraction = .22;
export const lightningBranchThicknessFraction = .45;
export const lightningBranchLifetimeFraction = .65;
export const lightningBranchStride = 2;
export const lightningMaximumDurationInSeconds = .2;
export const particleGravityInVoxelsPerSecondSquared = 30;
export const particleBounceRestitution = .35;
export const particleBounceFriction = .65;

// -----------------------------------------------------------------------------
// Aim preview
// -----------------------------------------------------------------------------
export const projectilePresentationSettings = {
    drillRevolutionsPerSecond: 4,
    fleaCyclesPerSecond: 4,
    fleaStretchFraction: .3,
    spiderUnfoldDurationInSeconds: .6,
    spiderLegCyclesPerSecond: 3,
    spiderFoldFraction: .8,
    spiderFoldHeightInVoxels: 2,
    spiderLegLiftInVoxels: .25,
    spiderRowPhaseInRadians: Math.PI / 2
} as const;

export const aimPreviewDotSpacingInVoxels = 5;
export const aimPreviewMaximumDotCount = 20;
export const aimPreviewDotSizeInVoxels = 1;
export const aimPreviewDotOutlineScale = 1.5;
export const aimPreviewDotOutlineColour = 0xffffff;
export const aimPreviewMinimumBrightness = .2;
export const aimPreviewTeammateBrightness = .45;
export const aimPreviewImpactRadiusInVoxels = 1.5;
export const aimPreviewSelfRadiusInVoxels = 9;
export const aimPreviewRingWidthFraction = .08;
export const aimPreviewRingSegments = 32;
export const aimPreviewArrowLengthInVoxels = 8;
export const aimPreviewArrowWidthInVoxels = 3;

// -----------------------------------------------------------------------------
// Name tags
// -----------------------------------------------------------------------------
export const nameTagMinimumScale = 0.5;
export const nameTagMaximumScale = 1.2;
export const nameTagMaximumDistanceInVoxels = 1200;
export const nameTagOcclusionCheckIntervalInFrames = 12;
export const nameTagOccludedOpacity = 0.15;
export const nameTagScaleDistanceInVoxels = 200;
export const nameTagHeadClearanceInVoxels = 1;
export const nameTagOpacityEasePerSecond = 10;
export const xrayTerrainOpacity = 0.44;
export const xrayEasePerSecond = 10;
export const xrayEaseSnapThreshold = .001;
export const xrayGridSpacingInVoxels = 16;
export const xrayGridRadiusInVoxels = 512;
export const xrayGridColour = 0x000000;
export const xrayGridOpacity = .08;
export const xrayBackgroundColour = 0x808080;
export const xrayStemWidthInVoxels = .08;
export const xrayRingRadiusInVoxels = 2;
export const xrayRingWidthFraction = .08;
export const xrayRingSegments = 32;
export const xrayGlowIntensity = 2;

// -----------------------------------------------------------------------------
// Audio
// -----------------------------------------------------------------------------
export const audioDefaultVolume = 0.5;
export const audioMaximumConcurrentVoices = 24;
export const audioAttenuationPerVoxel = 0.995;
export const audioPanDistanceInVoxels = 80;
export const audioEngineMinimumSpeedInVoxelsPerSecond = .05;
export const audioEngineMinimumRate = .7;
export const audioEngineMaximumRate = 1.5;
export const audioGapSampleRate = 22050;
export const audioGapAttackInSeconds = .015;
export const audioGapProfiles = {
    splash: { durationSeconds: .4, filterCoefficient: .3, decayPerSecond: 8 },
    thunder: { durationSeconds: 1.5, filterCoefficient: .045, decayPerSecond: 4 }
} as const;

// -----------------------------------------------------------------------------
// UI timings
// -----------------------------------------------------------------------------
export const inviteFlashDurationInMilliseconds = 500;
export const turretSwapDurationInSeconds = 0.12;
export const turretSwapOvershoot = 1.70158;
export const tankTreadFrameTravelInVoxels = 0.75;
export const tankTrackOffsetInVoxels = 2;
export const tankWreckTint = 0x30302c;
export const tankWreckSmokeIntervalInSeconds = 0.3;
export const tankRecoilDecayPerSecond = 16;
export const uiTransitionDurationInSeconds = 0.2;
