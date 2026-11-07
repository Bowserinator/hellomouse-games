import type * as T from 'three';
import { AdaptiveResolution } from '../../../shared/ts/adaptive-resolution.js';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { cameraControlBindings, cameraShotFollowDistanceInVoxels, renderingQualityPresets, renderingMinimumScale,
    renderingMaximumDevicePixelRatio, renderingMaximumFrameDeltaInSeconds, teamPrimaryColours,
    teamSecondaryBrightnessFraction, explosionMaximumLightCount, explosionLightDurationInSeconds,
    explosionLightRadiusMultiplier, explosionLightDecayPerSecond, explosionLightMinimumGlow,
    scorchDurationInSeconds, wreckSmokeEmitter, terrainDebrisEmitter, liquidFlameEmitter,
    liquidRisingFlameChance, liquidRisingFlameEmitter, liquidMaximumEmittersPerTick, planningPreviewInterpolationRatePerSecond, planningPreviewOpacity,
    turretYawQuantizationSteps, turretPitchQuantizationSteps, timeOfDayPresets, powerCentipercentMaximum,
    powerDefaultCentipercent, worldHeightInVoxels, worldIndestructibleMaximumLayerIndex } from '../config.js';
import { LobbySeat, RemovedVoxelSample, SimulationEvent } from '../types.js';
import { Match } from '../sim/match.js';
import { decodePitch, decodeYaw, quantizeYaw } from '../sim/math/fixed-quantize.js';
import { Tank } from '../sim/tank.js';
import { Vector3 } from '../sim/math/vector3.js';
import { WeaponDataFiles } from '../sim/weapon-types.js';
import { AimPreview, AimPreviewInput } from './aim-preview.js';
import { BeamEffects } from './beam-effects.js';
import { CameraRig } from './camera-rig.js';
import { DamageNumbers } from './damage-numbers.js';
import { ChunkManager } from './chunk-manager.js';
import { HeadingArrow } from './heading-arrow.js';
import { HitboxOverlay } from './hitbox-overlay.js';
import { LiquidRenderer } from './liquid-renderer.js';
import { MeshingWorkerPool } from './meshing/meshing-worker-pool.js';
import { NameTags } from './name-tags.js';
import { EffectProfile } from './particle-emitter.js';
import { ParticleEffects } from './particle-effects.js';
import { PostProcess } from './post/post-process.js';
import { ProjectileRenderer } from './projectile-renderer.js';
import { RenderingQuality, SceneLighting } from './scene-lighting.js';
import { themedSkyPreset } from './sky.js';
import { TankRig } from './tank-rig.js';
import { VoxelMaterials } from './voxel-material.js';
import { VoxelModelBuilder } from './voxel-model-builder.js';
import { XrayGrid } from './xray-grid.js';

export interface ArtillerySceneOptions {
    canvas: HTMLCanvasElement;
    tagContainer: HTMLElement;
    match: Match;
    seed: number;
    seats: ReadonlyArray<LobbySeat>;
    data: WeaponDataFiles;
    effects: Readonly<Record<string, EffectProfile>>;
    viewerSeatIndex: number;
    quality?: RenderingQuality;
    onEvent?: (event: SimulationEvent) => void;
    onFire?: (seatIndex: number, weaponIdentifier: string) => void;
    onTurretClick?: (seatIndex: number) => void;
}

interface TankView {
    tank: Tank;
    rig: TankRig;
    previous: T.Vector3;
    position: T.Vector3;
    muzzle: T.Vector3;
    aim: AimPreviewInput;
    aimSnapshot: Float64Array;
    aimWeapon: string;
    shotsFired: number;
    preview: Tank;
    previewPose: Float64Array;
    previewWeapon: string | null;
    hasPreview: boolean;
}

export class ArtilleryScene {
    readonly scene = new THREE.Scene();
    readonly renderer: T.WebGLRenderer;
    readonly camera: CameraRig;
    private readonly materials = new VoxelMaterials();
    private readonly workers = new MeshingWorkerPool();
    private readonly models: VoxelModelBuilder;
    private readonly lighting: SceneLighting;
    private readonly terrain: ChunkManager;
    private readonly projectiles: ProjectileRenderer;
    private readonly beams: BeamEffects;
    private readonly damageNumbers: DamageNumbers;
    private readonly liquids = new LiquidRenderer();
    private readonly aim: AimPreview;
    private readonly names: NameTags;
    private readonly xray: XrayGrid;
    private readonly hitboxes = new HitboxOverlay();
    private readonly arrow: HeadingArrow | null;
    private readonly post: PostProcess;
    private particles: ParticleEffects;
    private resolution: AdaptiveResolution;
    private isResolutionChangePending = false;
    private readonly views: Array<TankView> = [];
    private readonly displayTanks: Array<Tank> = [];
    private readonly aimInputs: Array<AimPreviewInput> = [];
    private readonly focusPoints: Array<Vector3> = [];
    private readonly removedSamples = new Map<number, ReadonlyArray<RemovedVoxelSample>>();
    private readonly random: Rng;
    private readonly upward = new THREE.Vector3(0, 1, 0);
    private readonly emissionPosition = new THREE.Vector3();
    private readonly bufferSize = new THREE.Vector2();
    private readonly lightAges = new Float32Array(explosionMaximumLightCount).fill(Infinity);
    private readonly scorchAges = new Float32Array(explosionMaximumLightCount).fill(Infinity);
    private lightIndex = 0;
    private scorchIndex = 0;
    private liquidEmissionIndex = 0;
    private explosionPosition: T.Vector3 | null = null;
    private readonly lastExplosion = new THREE.Vector3();
    private quality: RenderingQuality;
    private width = 1;
    private height = 1;
    private elapsedSeconds = 0;
    private planning = false;
    private focusedSeatIndex = -1;
    private readonly craterPosition = new THREE.Vector3();
    private followingOwnShots = false;
    private hadOwnShots = false;
    private shotEffectsUntilInSeconds = 0;
    private aimDirty = true;
    private xrayEnabled = false;
    private arrowEnabled = false;
    private hitboxesVisible = false;
    private pointerId: number | null = null;
    private pointerX = 0;
    private pointerY = 0;
    private pointerPans = false;
    private disposed = false;

    constructor(private readonly options: ArtillerySceneOptions) {
        this.quality = options.quality ?? 'high';
        const world = options.match.battlefield.world;
        this.random = new Rng(options.seed).fork(8005);
        this.materials.setWorldBounds(world.mapEdgeLengthInVoxels);
        this.renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: false,
            powerPreference: 'high-performance' });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.camera = new CameraRig(world);
        this.lighting = new SceneLighting(this.scene, options.seed, world.mapEdgeLengthInVoxels, this.quality,
            themedSkyPreset(timeOfDayPresets[options.match.settings.timeOfDay], options.match.theme.sky));
        try {
            this.post = new PostProcess(this.renderer, this.lighting.sky, this.lighting.preset, this.quality,
                world.mapEdgeLengthInVoxels, options.match.theme.liquid);
        } catch (error) {
            this.lighting.dispose(); this.renderer.dispose(); this.materials.dispose();
            this.workers.dispose(); this.liquids.dispose(); throw error;
        }
        this.models = new VoxelModelBuilder(options.data.models, this.materials);
        this.terrain = new ChunkManager(world, this.workers, this.materials.create());
        this.particles = new ParticleEffects(options.seed, this.quality);
        this.particles.setSunDirection(this.lighting.preset.sunDirection);
        this.particles.setLightLevel(this.lighting.preset.lightLevel ?? 1);
        this.beams = new BeamEffects(options.seed);
        this.damageNumbers = new DamageNumbers(new Rng(options.seed).fork(8006));
        this.aim = new AimPreview(world);
        const colours = new Map<number, number>(), paints = new Map<number, readonly [number, number]>();
        for (const tank of options.match.runtime.tanks) {
            const primary = teamPrimaryColours[tank.teamIndex];
            const secondary = new THREE.Color(primary).multiplyScalar(teamSecondaryBrightnessFraction).getHex();
            colours.set(tank.seatIndex, primary); paints.set(tank.seatIndex, [primary, secondary]);
            const rig = new TankRig(this.models, this.materials, primary, secondary,
                () => options.onTurretClick?.(tank.seatIndex), position => this.particles.emitBurst(wreckSmokeEmitter,
                    position, this.upward, this.random));
            const position = new THREE.Vector3(tank.position.x, tank.position.y, tank.position.z);
            const muzzle = new THREE.Vector3();
            const weapon = options.data.weapons[0];
            rig.setTurret(weapon.turretIdentifier, options.data.turrets[weapon.turretIdentifier]);
            this.views.push({ tank, rig, position, muzzle, previous: position.clone(),
                aim: { seatIndex: tank.seatIndex, teamIndex: tank.teamIndex, colour: primary,
                    position, origin: muzzle, yawInRadians: 0, pitchInRadians: 0, powerCentipercent: powerDefaultCentipercent, weapon },
                aimSnapshot: new Float64Array(9).fill(NaN), aimWeapon: '', shotsFired: tank.statistics.shotsFired,
                preview: new Tank(tank.seatIndex, tank.teamIndex, tank.position, tank.hitPoints),
                previewPose: new Float64Array(6), previewWeapon: null, hasPreview: false });
            this.displayTanks.push(tank);
            this.scene.add(rig.group);
        }
        this.projectiles = new ProjectileRenderer(this.models, this.materials, paints);
        this.names = new NameTags(world, options.tagContainer, options.seats, colours);
        this.xray = new XrayGrid(colours);
        const viewerColour = colours.get(options.viewerSeatIndex);
        this.arrow = viewerColour === undefined ? null : new HeadingArrow(viewerColour);
        this.scene.add(this.terrain.group, this.particles.group, this.beams.mesh, this.damageNumbers.group,
            this.projectiles.group,
            this.liquids.mesh, this.aim.group, this.xray.group, this.hitboxes.group);
        if (this.arrow) this.scene.add(this.arrow.group);
        const maximum = renderingQualityPresets[this.quality].maximumRenderScale;
        this.resolution = new AdaptiveResolution(maximum, renderingMinimumScale, maximum);
        this.focusPlayer(options.viewerSeatIndex);
        this.camera.update(0);
        this.resize(Math.max(1, options.canvas.clientWidth), Math.max(1, options.canvas.clientHeight));
        const canvas = options.canvas;
        canvas.addEventListener('pointerdown', this.pointerDown);
        canvas.addEventListener('pointermove', this.pointerMove);
        canvas.addEventListener('pointerup', this.pointerUp);
        canvas.addEventListener('pointercancel', this.pointerUp);
        canvas.addEventListener('lostpointercapture', this.pointerUp);
        canvas.addEventListener('wheel', this.wheel, { passive: false });
        canvas.addEventListener('contextmenu', this.contextMenu);
        options.match.runtime.events.length = 0;
    }

    get pendingChunkCount(): number {
        return this.terrain.pendingMeshCount;
    }
    get isXrayEnabled(): boolean {
        return this.xrayEnabled;
    }

    captureTick(): void {
        for (const view of this.views)
            view.previous.set(view.tank.position.x, view.tank.position.y, view.tank.position.z);
        this.projectiles.capture(this.options.match.runtime.projectiles);
    }

    consumeTick(): void {
        if (this.disposed) return;
        const runtime = this.options.match.runtime;
        const damageHits = new Map<string, { position: Vector3; amount: number; count: number }>();
        for (let index = 0; index < runtime.events.length; index++) {
            const event = runtime.events[index], profile = event.effectProfileIdentifier
                ? this.options.effects[event.effectProfileIdentifier] : undefined;
            if (this.followingOwnShots && event.seatIndex === this.options.viewerSeatIndex && event.type !== 'line') {
                let duration = event.removedVoxelSamples?.length ? terrainDebrisEmitter.lifetime[1] : 0;
                if (profile) {
                    duration = Math.max(duration, profile.durationSeconds);
                    for (const emitter of profile.emitters)
                        duration = Math.max(duration, (emitter.delaySeconds ?? 0) + emitter.lifetime[1]);
                }
                this.shotEffectsUntilInSeconds = Math.max(this.shotEffectsUntilInSeconds,
                    this.elapsedSeconds + duration);
            }
            if (event.type === 'terrainAdded') {
                this.aimDirty = true;
                if (event.removedVoxelSamples?.length) {
                    this.removedSamples.set(event.serial, event.removedVoxelSamples);
                    const next = runtime.events[index + 1];
                    if (next?.type !== 'explosion' || next.serial !== event.serial)
                        this.particles.emitBurst(terrainDebrisEmitter, event.position, this.upward, this.random,
                            this.particles.qualityMultiplier, event.removedVoxelSamples);
                }
            }
            if (event.type === 'beam' && this.followingOwnShots &&
                event.seatIndex === this.options.viewerSeatIndex && event.endpoint) {
                this.camera.moveTo(event.position.y >= worldHeightInVoxels ? [event.endpoint]
                    : [event.position, event.endpoint], cameraShotFollowDistanceInVoxels);
                this.hadOwnShots = true;
            }
            if ((event.type === 'tankDamaged' || event.type === 'tankKilled') && event.amount) {
                const key = `${event.seatIndex}:${Math.max(1, Math.round(event.amount))}`;
                const hit = damageHits.get(key);
                if (hit) hit.count++;
                else damageHits.set(key, { position: event.position, amount: event.amount, count: 1 });
            }
            if (event.type === 'lineEnd') this.beams.clearTagged(event.serial);
            if ((event.type === 'beam' || event.type === 'line') && profile) this.beams.play(event, profile);
            else if (profile) this.particles.play(profile, profile.kind === 'mushroom' ? this.craterFloor(event)
                : event.position, this.upward, this.removedSamples.get(event.serial));
            if (event.type === 'explosion') {
                const radius = event.radiusInVoxels ?? 0, glow = profile?.glowIntensity ?? 0;
                this.camera.addExplosion(event.position, radius, profile?.shakeStrength ?? 0);
                this.post.addExplosion(event.position, radius, profile?.shakeStrength ?? 0);
                this.lastExplosion.set(event.position.x, event.position.y, event.position.z);
                this.explosionPosition = this.lastExplosion;
                const light = this.lightIndex++ % explosionMaximumLightCount;
                this.materials.explosionLights[light].set(event.position.x, event.position.y, event.position.z,
                    radius * explosionLightRadiusMultiplier);
                this.materials.explosionColours[light].set(profile?.colour ?? '#ffb040').convertSRGBToLinear()
                    .multiplyScalar(Math.max(explosionLightMinimumGlow, glow));
                this.lightAges[light] = 0;
                if (event.weaponIdentifier === 'fireball') {
                    const scorch = this.scorchIndex++ % explosionMaximumLightCount;
                    this.materials.scorchRegions[scorch].set(event.position.x, event.position.y,
                        event.position.z, radius);
                    this.scorchAges[scorch] = 0;
                }
            }
            this.options.onEvent?.(event);
        }
        for (const hit of damageHits.values()) this.damageNumbers.spawn(hit.position, hit.amount, hit.count);
        runtime.events.length = 0; this.removedSamples.clear();
        for (const view of this.views)
            if (view.shotsFired !== view.tank.statistics.shotsFired) {
                view.rig.fire();
                const identifier = runtime.selectedWeapons.get(view.tank.seatIndex);
                if (identifier) this.options.onFire?.(view.tank.seatIndex, identifier);
                view.shotsFired = view.tank.statistics.shotsFired;
            }

        for (const projectile of runtime.projectiles) {
            const identifier = projectile.definition.trailEffectIdentifier;
            if (!projectile.isAlive || !identifier || !this.options.effects[identifier]) continue;
            const trail = this.options.effects[identifier];
            this.particles.play(trail, projectile.position, projectile.velocity);
            const previous = this.projectiles.previousPosition(projectile.serial);
            if (trail.streakWidthInVoxels && previous)
                this.beams.addStreak(previous, projectile.position, trail.streakWidthInVoxels,
                    trail.durationSeconds, Number.parseInt(trail.colour.slice(1), 16), trail.glowIntensity);
        }
        let cellIndex = 0, emitted = 0;
        for (const cell of runtime.liquids.cells.values()) {
            if (cellIndex++ < this.liquidEmissionIndex || cell.kind === 'oil') continue;
            this.emissionPosition.set(cell.x + .5, cell.y + .5, cell.z + .5);
            this.particles.emitBurst(liquidFlameEmitter, this.emissionPosition, this.upward, this.random);
            if (cell.kind === 'fire' && this.random.float() < liquidRisingFlameChance)
                this.particles.emitBurst(liquidRisingFlameEmitter, this.emissionPosition, this.upward, this.random);
            if (++emitted >= liquidMaximumEmittersPerTick) break;
        }
        this.liquidEmissionIndex = cellIndex >= runtime.liquids.cells.size ? 0 : cellIndex;
    }

    private craterFloor(event: SimulationEvent): THREE.Vector3 {
        const floor = Math.max(event.position.y - (event.radiusInVoxels ?? 0), worldIndestructibleMaximumLayerIndex + 1);
        return this.craterPosition.set(event.position.x, Math.min(floor, event.position.y), event.position.z);
    }

    setFogDensity(density: number): void {
        this.post.setFogDensity(density);
    }

    setPlanning(enabled: boolean): void {
        this.planning = enabled; this.aimDirty = true;
        if (!enabled) for (const view of this.views) {
            view.hasPreview = false;
            view.previous.set(view.tank.position.x, view.tank.position.y, view.tank.position.z);
            view.position.copy(view.previous);
        }
        this.updateFocus();
    }

    setPlanningPreview(seatIndex: number, pose: ReadonlyArray<number>, powerCentipercent: number,
        weaponIdentifier: string | null): boolean {
        const view = this.views.find(candidate => candidate.tank.seatIndex === seatIndex);
        const viewer = this.views.find(candidate => candidate.tank.seatIndex === this.options.viewerSeatIndex);
        if (!this.planning || !view || !viewer || view === viewer || view.tank.isWreck ||
            view.tank.teamIndex !== viewer.tank.teamIndex || view.tank.teamIndex !== this.options.match.teamIndex ||
            pose.length !== 6 || !pose.every(Number.isFinite) || !Number.isInteger(powerCentipercent) ||
            powerCentipercent < 0 || powerCentipercent > powerCentipercentMaximum || pose.slice(3).some((value, index) =>
            !Number.isInteger(value) || value < 0 || value >= (index === 2 ? turretPitchQuantizationSteps
                : turretYawQuantizationSteps)) || weaponIdentifier !== null &&
            !((view.tank.ammunition.get(weaponIdentifier) ?? 0) > 0)) return false;
        if (!view.hasPreview) {
            view.preview.hullYawInRadians = view.tank.hullYawInRadians;
            view.preview.turretYawQuantized = view.tank.turretYawQuantized;
            view.preview.turretPitchQuantized = view.tank.turretPitchQuantized;
        }
        view.previewPose.set(pose); view.previewWeapon = weaponIdentifier;
        view.preview.powerCentipercent = powerCentipercent; view.hasPreview = true;
        this.aimDirty = true;
        return true;
    }

    setXray(enabled: boolean): void {
        this.xrayEnabled = enabled; this.xray.setEnabled(enabled);
    }

    setMoveArrowEnabled(enabled: boolean): void {
        this.arrowEnabled = enabled;
    }

    setHitboxesVisible(visible: boolean): void {
        this.hitboxesVisible = visible; this.hitboxes.setEnabled(visible);
    }

    setAmbientOcclusion(enabled: boolean): void {
        if (this.terrain.includeAmbientOcclusion === enabled) return;
        this.terrain.includeAmbientOcclusion = enabled;
        this.terrain.invalidateAll();
    }

    setUsername(seatIndex: number, username: string): void {
        this.names.setUsername(seatIndex, username);
    }

    setQuality(quality: RenderingQuality): void {
        if (quality === this.quality) return;
        this.quality = quality;
        this.lighting.setQuality(quality); this.post.setQuality(quality);
        this.particles.dispose(); this.particles = new ParticleEffects(this.options.seed, quality);
        this.particles.setSunDirection(this.lighting.preset.sunDirection);
        this.particles.setLightLevel(this.lighting.preset.lightLevel ?? 1); this.scene.add(this.particles.group);
        const maximum = renderingQualityPresets[quality].maximumRenderScale;
        this.resolution = new AdaptiveResolution(maximum, renderingMinimumScale, maximum);
        this.resize(this.width, this.height);
    }

    resize(width: number, height: number): void {
        if (!Number.isFinite(width + height) || width < 1 || height < 1) throw new Error('Invalid scene size');
        this.width = Math.floor(width); this.height = Math.floor(height);
        this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, renderingMaximumDevicePixelRatio) *
            this.resolution.ratio);
        this.renderer.setSize(this.width, this.height, false);
        this.renderer.getDrawingBufferSize(this.bufferSize);
        this.post.setSize(this.bufferSize.x, this.bufferSize.y);
        this.camera.resize(this.width, this.height);
    }

    compile(): void {
        this.particles.warmUp();
        this.renderer.compile(this.scene, this.camera.camera); this.resolution.settle();
    }

    render(interpolation: number, deltaSeconds: number): void {
        if (this.disposed) return;
        if (!Number.isFinite(interpolation + deltaSeconds) || interpolation < 0 || interpolation > 1 ||
            deltaSeconds < 0) throw new Error('Invalid scene frame');
        if (this.isResolutionChangePending) {
            this.isResolutionChangePending = false;
            this.resize(this.width, this.height);
        }
        const delta = Math.min(deltaSeconds, renderingMaximumFrameDeltaInSeconds), runtime = this.options.match.runtime;
        this.elapsedSeconds += delta;
        const previewFraction = 1 - Math.exp(-planningPreviewInterpolationRatePerSecond * delta);
        for (let index = 0; index < this.views.length; index++) {
            const view = this.views[index], previewing = this.planning && view.hasPreview;
            const tank = previewing ? view.preview : view.tank;
            if (previewing) {
                const pose = view.previewPose;
                view.position.x += (pose[0] - view.position.x) * previewFraction;
                view.position.y += (pose[1] - view.position.y) * previewFraction;
                view.position.z += (pose[2] - view.position.z) * previewFraction;
                tank.position.x = view.position.x; tank.position.y = view.position.y; tank.position.z = view.position.z;
                const hullDelta = decodeYaw(pose[3]) - tank.hullYawInRadians;
                tank.hullYawInRadians += Math.atan2(Math.sin(hullDelta), Math.cos(hullDelta)) * previewFraction;
                const turretYaw = decodeYaw(tank.turretYawQuantized), turretDelta = decodeYaw(pose[4]) - turretYaw;
                tank.turretYawQuantized = quantizeYaw(turretYaw +
                    Math.atan2(Math.sin(turretDelta), Math.cos(turretDelta)) * previewFraction);
                tank.turretPitchQuantized = Math.round(tank.turretPitchQuantized +
                    (pose[5] - tank.turretPitchQuantized) * previewFraction);
                tank.hitPoints = view.tank.hitPoints; tank.maximumHitPoints = view.tank.maximumHitPoints;
                tank.isWreck = view.tank.isWreck;
            } else view.position.set(tank.position.x, tank.position.y, tank.position.z)
                .lerp(view.previous, 1 - interpolation);
            this.displayTanks[index] = tank;
            view.rig.material.opacity = previewing ? planningPreviewOpacity : 1;
            view.rig.material.transparent = previewing; view.rig.material.depthWrite = !previewing;
            const identifier = previewing ? view.previewWeapon : runtime.selectedWeapons.get(tank.seatIndex);
            const weapon = this.options.data.weapons.find(candidate => candidate.identifier === identifier);
            if (weapon) view.rig.setTurret(weapon.turretIdentifier, this.options.data.turrets[weapon.turretIdentifier]);
            view.rig.update(tank, view.position, delta); view.rig.muzzlePosition(view.muzzle);
        }
        const own = this.views.find(view => view.tank.seatIndex === this.options.viewerSeatIndex);
        if (this.arrow && own) this.arrow.update(this.arrowEnabled && !own.tank.isWreck, own.position,
            own.tank.hullYawInRadians);
        if (this.hitboxesVisible) this.hitboxes.update(runtime.collisionTargets());
        this.updateAim(); this.updateFocus(); this.camera.update(delta);
        this.xray.update(this.displayTanks, this.camera.targetPoint, delta);
        this.materials.setXray(this.xray.amount); this.post.setXray(this.xray.amount);
        for (let index = 0; index < explosionMaximumLightCount; index++) {
            this.lightAges[index] += delta; this.scorchAges[index] += delta;
            this.materials.explosionColours[index].multiplyScalar(Math.exp(-explosionLightDecayPerSecond * delta));
            if (this.lightAges[index] >= explosionLightDurationInSeconds) this.materials.explosionLights[index].setW(0);
            if (this.scorchAges[index] >= scorchDurationInSeconds) this.materials.scorchRegions[index].setW(0);
        }
        this.terrain.update(this.camera.camera.position, renderingQualityPresets[this.quality].drawDistance,
            this.explosionPosition);
        this.explosionPosition = null;
        this.projectiles.update(runtime.projectiles, runtime.deployables, interpolation);
        this.liquids.update(runtime.liquids.cells); this.particles.update(delta, this.options.match.battlefield.world);
        this.beams.update(delta);
        this.damageNumbers.update(delta, this.camera.camera.position);
        this.names.update(this.displayTanks, this.camera.camera, this.width, this.height, delta);
        this.names.updateProjectiles(runtime.projectiles, runtime.deployables, this.camera.camera, this.width, this.height);
        this.post.render(this.scene, this.camera.camera, this.elapsedSeconds, delta);
        if (this.resolution.update(deltaSeconds * 1000) !== undefined) this.isResolutionChangePending = true;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        const canvas = this.options.canvas;
        canvas.removeEventListener('pointerdown', this.pointerDown); canvas.removeEventListener('pointermove', this.pointerMove);
        canvas.removeEventListener('pointerup', this.pointerUp); canvas.removeEventListener('pointercancel', this.pointerUp);
        canvas.removeEventListener('lostpointercapture', this.pointerUp); canvas.removeEventListener('wheel', this.wheel);
        canvas.removeEventListener('contextmenu', this.contextMenu);
        if (this.pointerId !== null && canvas.hasPointerCapture(this.pointerId))
            canvas.releasePointerCapture(this.pointerId);
        this.terrain.dispose(); this.workers.dispose();
        for (const view of this.views) view.rig.dispose();
        this.projectiles.dispose(); this.particles.dispose(); this.beams.dispose(); this.damageNumbers.dispose();
        this.liquids.dispose();
        this.aim.dispose(); this.names.dispose(); this.xray.dispose(); this.post.dispose();
        this.hitboxes.dispose(); this.arrow?.dispose();
        this.lighting.dispose(); this.models.dispose(); this.materials.dispose(); this.renderer.dispose();
        this.scene.clear();
    }

    focusPlayer(seatIndex: number): void {
        const view = this.views.find(candidate => candidate.tank.seatIndex === seatIndex);
        if (!view) return;
        this.focusedSeatIndex = seatIndex;
        this.followingOwnShots = false;
        this.camera.moveTo([view.position]);
    }

    followOwnShots(): void {
        this.followingOwnShots = true;
        this.hadOwnShots = false;
    }

    private updateFocus(): void {
        this.focusPoints.length = 0;
        if (this.followingOwnShots) {
            for (const projectile of this.options.match.runtime.projectiles)
                if (projectile.isAlive && projectile.ownerSeatIndex === this.options.viewerSeatIndex)
                    this.focusPoints.push(projectile.position);
            for (const deployable of this.options.match.runtime.deployables)
                if (deployable.isAlive && deployable.definition.kind === 'airstrike' &&
                    deployable.context.ownerSeatIndex === this.options.viewerSeatIndex)
                    this.focusPoints.push(deployable.visualPosition(1));
            for (const cell of this.options.match.runtime.liquids.cells.values())
                if (cell.ownerSeatIndex === this.options.viewerSeatIndex &&
                    (cell.kind !== 'oil' || cell.igniteAtTick !== Infinity)) this.focusPoints.push(cell);
            if (this.focusPoints.length) {
                if (!this.hadOwnShots) this.camera.moveTo(this.focusPoints, cameraShotFollowDistanceInVoxels);
                else this.camera.focus(this.focusPoints, cameraShotFollowDistanceInVoxels);
                this.hadOwnShots = true;
                return;
            }
            if (this.elapsedSeconds < this.shotEffectsUntilInSeconds ||
                this.hadOwnShots && this.options.match.isResolving) return;
            if (this.hadOwnShots) {
                this.followingOwnShots = false;
                this.focusedSeatIndex = -1;
                return;
            }
        }
        const view = this.views.find(candidate => candidate.tank.seatIndex === this.focusedSeatIndex);
        if (view) this.camera.focus([view.position]);
    }

    private updateAim(): void {
        const match = this.options.match;
        const viewer = this.views.find(view => view.tank.seatIndex === this.options.viewerSeatIndex);
        this.aim.group.visible = this.planning && !match.isResolving && viewer?.tank.teamIndex === match.teamIndex;
        if (!this.aim.group.visible || !viewer) return;
        const previousCount = this.aimInputs.length;
        this.aimInputs.length = 0;
        let changed = this.aimDirty;
        for (const view of this.views) {
            const tank = view.hasPreview ? view.preview : view.tank;
            const identifier = view.hasPreview ? view.previewWeapon : match.runtime.selectedWeapons.get(tank.seatIndex);
            const weapon = this.options.data.weapons.find(candidate => candidate.identifier === identifier);
            if (tank.isWreck || tank.teamIndex !== viewer.tank.teamIndex || !weapon ||
                (view.tank.ammunition.get(weapon.identifier) ?? 0) === 0) continue;
            const snapshot = view.aimSnapshot, position = view.position, muzzle = view.muzzle;
            const aim = view.aim;
            if (view.aimWeapon !== weapon.identifier || snapshot[0] !== position.x || snapshot[1] !== position.y ||
                snapshot[2] !== position.z || snapshot[3] !== muzzle.x || snapshot[4] !== muzzle.y ||
                snapshot[5] !== muzzle.z || snapshot[6] !== tank.turretYawQuantized ||
                snapshot[7] !== tank.turretPitchQuantized || snapshot[8] !== tank.powerCentipercent) changed = true;
            snapshot[0] = position.x; snapshot[1] = position.y; snapshot[2] = position.z;
            snapshot[3] = muzzle.x; snapshot[4] = muzzle.y; snapshot[5] = muzzle.z;
            snapshot[6] = tank.turretYawQuantized; snapshot[7] = tank.turretPitchQuantized;
            snapshot[8] = tank.powerCentipercent; view.aimWeapon = weapon.identifier;
            aim.yawInRadians = decodeYaw(tank.turretYawQuantized);
            aim.pitchInRadians = decodePitch(tank.turretPitchQuantized);
            aim.powerCentipercent = tank.powerCentipercent; aim.weapon = weapon;
            this.aimInputs.push(aim);
        }
        if (changed || previousCount !== this.aimInputs.length)
            this.aim.update(this.aimInputs, viewer.tank.teamIndex, viewer.tank.seatIndex);
        this.aimDirty = false;
    }

    private readonly pointerDown = (event: PointerEvent): void => {
        if (this.pointerId !== null || event.button !== cameraControlBindings.orbitButton &&
            event.button !== cameraControlBindings.panButton) return;
        event.preventDefault();
        this.pointerId = event.pointerId; this.pointerX = event.clientX; this.pointerY = event.clientY;
        this.pointerPans = event.button === cameraControlBindings.panButton ||
            cameraControlBindings.shiftOrbitsAsPan && event.shiftKey;
        this.options.canvas.setPointerCapture(event.pointerId);
    };

    private readonly pointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.pointerId) return;
        const deltaX = event.clientX - this.pointerX, deltaY = event.clientY - this.pointerY;
        this.pointerX = event.clientX; this.pointerY = event.clientY;
        if (this.pointerPans) this.camera.pan(deltaX, deltaY);
        else this.camera.orbit(deltaX, deltaY);
    };

    private readonly pointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== this.pointerId) return;
        this.pointerId = null;
        if (this.options.canvas.hasPointerCapture(event.pointerId))
            this.options.canvas.releasePointerCapture(event.pointerId);
    };

    private readonly wheel = (event: WheelEvent): void => {
        event.preventDefault(); this.camera.zoom(event.deltaY);
    };
    private readonly contextMenu = (event: Event): void => {
        event.preventDefault();
    };
}
