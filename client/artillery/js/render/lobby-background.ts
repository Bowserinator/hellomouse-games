import type * as T from 'three';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { cameraFieldOfViewInDegrees, cameraPerspectiveNearPlane, cameraPerspectiveFarPlane,
    lobbyBackgroundMapEdgeLengthInVoxels, lobbyBackgroundSettings, renderingMaximumFrameDeltaInSeconds,
    skyCubeFaceResolution, skyPresets, wreckSmokeEmitter } from '../config.js';
import { loadWorld } from '../loading.js';
import { StateHash } from '../sim/math/hash.js';
import { BiomeRule } from '../sim/world/biomes.js';
import { VoxelWorld } from '../sim/world/voxel-world.js';
import { WorldGenerator } from '../sim/world/world-generator.js';
import { ChunkManager } from './chunk-manager.js';
import { MeshingWorkerPool } from './meshing/meshing-worker-pool.js';
import { ParticleEffects } from './particle-effects.js';
import { ParticleEmitterSpec } from './particle-emitter.js';
import { PostProcess } from './post/post-process.js';
import { SceneLighting } from './scene-lighting.js';
import { createSkyCube } from './sky.js';
import { VoxelMaterials } from './voxel-material.js';

const settings = lobbyBackgroundSettings;

export class LobbyBackground {
    readonly seed: number;
    readonly ready: Promise<void>;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(cameraFieldOfViewInDegrees, 1,
        cameraPerspectiveNearPlane, cameraPerspectiveFarPlane);
    private readonly focus = new THREE.Vector3(lobbyBackgroundMapEdgeLengthInVoxels / 2,
        settings.cameraFocusHeightInVoxels, lobbyBackgroundMapEdgeLengthInVoxels / 2);
    private readonly upward = new THREE.Vector3(0, 1, 0);
    private readonly duskSunColour = new THREE.Color(skyPresets[2].sunColour);
    private readonly shellOrigin = new THREE.Vector3();
    private readonly shellDirection = new THREE.Vector3();
    private readonly pixels: Array<{ target: Uint8ClampedArray; day: Uint8ClampedArray; dusk: Uint8ClampedArray }> = [];
    private renderer!: T.WebGLRenderer;
    private lighting!: SceneLighting;
    private materials!: VoxelMaterials;
    private workers!: MeshingWorkerPool;
    private post!: PostProcess;
    private particles!: ParticleEffects;
    private shell!: T.Mesh<T.BoxGeometry, T.MeshBasicMaterial>;
    private random!: Rng;
    private chunks: ChunkManager | null = null;
    private world: VoxelWorld | null = null;
    private elapsed = 0;
    private skyAge = Infinity;
    private shellAge = Infinity;
    private shellWait = settings.shellIntervalInSeconds;
    private smokeAge = 0;
    private disposed = false;
    private readonly puff: ParticleEmitterSpec = { ...wreckSmokeEmitter, count: settings.shellPuffCount,
        size: [settings.shellPuffStartSizeInVoxels, settings.shellPuffEndSizeInVoxels] };

    constructor(canvas: HTMLCanvasElement, room: string, biomes: ReadonlyArray<Readonly<BiomeRule>>) {
        this.seed = new StateHash().string(room).value;
        try {
            this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
            this.renderer.setPixelRatio(settings.resolutionScale);
            this.renderer.outputEncoding = THREE.LinearEncoding;
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.lighting = new SceneLighting(this.scene, this.seed, lobbyBackgroundMapEdgeLengthInVoxels, 'low', skyPresets[0]);
            this.materials = new VoxelMaterials();
            this.materials.setWorldBounds(lobbyBackgroundMapEdgeLengthInVoxels);
            this.workers = new MeshingWorkerPool();
            this.particles = new ParticleEffects(this.seed, 'low');
            this.random = new Rng(this.seed).fork(8008);
            this.shell = new THREE.Mesh(new THREE.BoxGeometry(settings.shellSizeInVoxels,
                settings.shellSizeInVoxels, settings.shellSizeInVoxels * 2),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(settings.shellColour).convertSRGBToLinear()
                .multiplyScalar(settings.shellGlow), toneMapped: false }));
            this.shell.visible = false;
            this.scene.add(this.shell, this.particles.group);
            const dusk = createSkyCube(this.seed, skyCubeFaceResolution, skyPresets[2]);
            try {
                for (let face = 0; face < 6; face++) {
                    const dayFace = this.lighting.sky.images[face], duskFace = dusk.images[face];
                    if (!(dayFace instanceof THREE.DataTexture) || !(duskFace instanceof THREE.DataTexture))
                        throw new Error('Lobby sky requires generated pixel faces');
                    this.pixels.push({ target: dayFace.image.data, day: dayFace.image.data.slice(),
                        dusk: duskFace.image.data.slice() });
                }
            } finally {
                dusk.dispose();
            }
            this.post = new PostProcess(this.renderer, this.lighting.sky, this.lighting.preset, 'low',
                lobbyBackgroundMapEdgeLengthInVoxels);
            this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
            this.ready = loadWorld(new WorldGenerator(this.seed, lobbyBackgroundMapEdgeLengthInVoxels, biomes),
                biomes, this.workers, () => {}).then(world => {
                if (this.disposed) return;
                this.world = world;
                this.chunks = new ChunkManager(world, this.workers, this.materials.create());
                this.scene.add(this.chunks.group);
            }).catch(error => {
                if (!this.disposed) throw error;
            });
        } catch (error) {
            this.dispose(); throw error;
        }
    }

    setFogDensity(density: number): void {
        this.post.setFogDensity(density);
    }

    resize(width: number, height: number): void {
        if (this.disposed) return;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
            throw new RangeError('Invalid lobby view size');
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
        this.post.setSize(Math.max(1, Math.floor(width * settings.resolutionScale)),
            Math.max(1, Math.floor(height * settings.resolutionScale)));
    }

    render(deltaSeconds: number, hidden = false): void {
        if (this.disposed || hidden) return;
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Invalid lobby timestep');
        const delta = Math.min(renderingMaximumFrameDeltaInSeconds, deltaSeconds);
        this.elapsed += delta; this.skyAge += delta;
        const angle = this.elapsed * settings.orbitRadiansPerSecond;
        this.camera.position.set(this.focus.x + Math.sin(angle) * settings.cameraRadiusInVoxels,
            settings.cameraHeightInVoxels, this.focus.z + Math.cos(angle) * settings.cameraRadiusInVoxels);
        this.camera.lookAt(this.focus); this.camera.updateMatrixWorld();
        if (this.skyAge >= settings.skyRefreshIntervalInSeconds) {
            this.skyAge = 0;
            const dusk = (1 - Math.cos(this.elapsed / settings.dayDuskCycleInSeconds * Math.PI * 2)) / 2;
            for (const face of this.pixels) for (let index = 0; index < face.target.length; index += 4)
                for (let channel = 0; channel < 3; channel++)
                    face.target[index + channel] = Math.round(face.day[index + channel] * (1 - dusk) +
                        face.dusk[index + channel] * dusk);
            this.lighting.sky.needsUpdate = true;
            this.lighting.sun.color.set(skyPresets[0].sunColour).lerp(this.duskSunColour, dusk);
            this.lighting.sun.intensity = skyPresets[0].sunIntensity * (1 - dusk) + skyPresets[2].sunIntensity * dusk;
            this.lighting.ambient.intensity = skyPresets[0].ambientIntensity * (1 - dusk) +
                skyPresets[2].ambientIntensity * dusk;
        }
        if (this.chunks) this.chunks.update(this.camera.position, cameraPerspectiveFarPlane);
        else this.workers.runFallbackBudget();
        this.updateShell(delta, angle);
        this.particles.update(delta, this.world ?? undefined);
        this.post.render(this.scene, this.camera, this.elapsed, delta);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.chunks?.dispose(); this.workers?.dispose(); this.particles?.dispose(); this.post?.dispose();
        this.shell?.geometry.dispose(); this.shell?.material.dispose(); this.materials?.dispose();
        this.lighting?.dispose(); this.renderer?.dispose(); this.pixels.length = 0;
        this.scene.clear();
    }

    private updateShell(delta: number, angle: number): void {
        if (this.shellAge > settings.shellFlightInSeconds) {
            this.shellWait -= delta;
            if (this.shellWait > 0) return;
            this.shellWait = settings.shellIntervalInSeconds +
                this.random.range(0, settings.shellIntervalVariationInSeconds);
            this.shellAge = 0; this.smokeAge = 0;
            this.shellOrigin.set(this.focus.x - Math.sin(angle) * settings.shellHorizonRadiusInVoxels,
                settings.shellHeightInVoxels, this.focus.z - Math.cos(angle) * settings.shellHorizonRadiusInVoxels);
            this.shellDirection.set(Math.cos(angle), 0, -Math.sin(angle));
        }
        this.shellAge += delta;
        const progress = Math.min(1, this.shellAge / settings.shellFlightInSeconds);
        this.shell.position.copy(this.shellDirection).multiplyScalar((progress - .5) * settings.shellDistanceInVoxels)
            .add(this.shellOrigin);
        this.shell.position.y += 4 * settings.shellArcHeightInVoxels * progress * (1 - progress);
        this.shell.rotation.set(-Math.atan2(4 * settings.shellArcHeightInVoxels * (1 - 2 * progress),
            settings.shellDistanceInVoxels), Math.atan2(this.shellDirection.x, this.shellDirection.z), 0);
        this.shell.visible = progress < 1; this.smokeAge += delta;
        if (this.smokeAge >= settings.shellSmokeIntervalInSeconds) {
            this.smokeAge = 0;
            this.particles.emitBurst(wreckSmokeEmitter, this.shell.position, this.upward, this.random);
        }
        if (progress === 1) {
            this.particles.emitBurst(this.puff, this.shell.position, this.upward, this.random);
            this.shellAge = Infinity;
        }
    }
}
