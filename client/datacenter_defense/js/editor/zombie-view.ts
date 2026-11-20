import type * as T from 'three';
import type { World } from '../mapx.js';
import { MAX_ZOMBIES, Q } from '../sim/fixed.js';
import type { RenderSnapshot, SimCore } from '../sim/core.js';
import { SimDriver, type DriverOptions } from '../sim/driver.js';
import { CommandType } from '../sim/commands.js';
import { VARIANTS } from '../sim/variants.js';
import { RENDER_ZOMBIE_STATE_SHIFT } from '../sim/layout.js';
import { elevation } from './world.js';

// Append ?profile to the page URL to time every simulation kernel with GPU timestamp queries.
// Profiling splits each tick into one compute pass per dispatch, so it slows the sim down.
const PROFILE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('profile');
const PROFILE_LOG_TICKS = 200;
let profileHook: object | undefined;
function logProfile(core: SimCore | undefined) {
    const report = core?.profileReport();
    if (!report) return;
    console.info(`Sim profile over ${report.ticks} ticks: CPU encode ${report.cpuEncode.meanMilliseconds.toFixed(2)} ms/tick` +
        (report.gpuMillisecondsPerTick === null ? ' · GPU timestamps unavailable'
            : ` · GPU ${report.gpuMillisecondsPerTick.toFixed(2)} ms/tick`));
    console.table(report.kernels.slice(0, 10).map(kernel => ({
        kernel: kernel.entry, millisecondsPerTick: +kernel.millisecondsPerTick.toFixed(3),
        meanMilliseconds: +kernel.meanMilliseconds.toFixed(3), maxMilliseconds: +kernel.maxMilliseconds.toFixed(3),
        sharePercent: +kernel.sharePercent.toFixed(1)
    })));
}

export class ZombieView {
    readonly group = new THREE.Group();
    enemyCount = 0;
    get tickMilliseconds() {
        return this.driver.tickMilliseconds;
    }
    get core() {
        return this.driver.core;
    }
    private mesh: T.Mesh;
    private shieldMesh: T.Mesh;
    private flow?: T.LineSegments;
    private heightTexture: T.DataTexture;
    private previous: T.InstancedBufferAttribute;
    private current: T.InstancedBufferAttribute;
    private alive: T.InstancedBufferAttribute;
    private hitAge: T.InstancedBufferAttribute;
    private variant: T.InstancedBufferAttribute;
    private plates: {
        previous: T.InstancedBufferAttribute; current: T.InstancedBufferAttribute; alive: T.InstancedBufferAttribute;
        hitAge: T.InstancedBufferAttribute; variant: T.InstancedBufferAttribute; heading: T.InstancedBufferAttribute;
    };
    private headings: Float32Array;
    private shielded = VARIANTS.map(variant => !!variant.shield);
    private effectTime = { value: 0 };
    private resultTime?: number;
    private clock = { value: 0 };
    private alpha = { value: 1 };
    private snapshotTick = 0;
    private previousTick = 0;
    private frame = 0;
    private stopped = false;
    private constructor(readonly driver: SimDriver, private render: () => void, private onStop: () => void) {
        const core = driver.core, nav = core.nav;
        this.heightTexture = new THREE.DataTexture(Float32Array.from(nav.heights, h => (h + nav.baseDm) / 10),
            nav.terrainColumns, nav.terrainRows, THREE.RedFormat, THREE.FloatType);
        this.heightTexture.minFilter = this.heightTexture.magFilter = THREE.NearestFilter;
        this.heightTexture.needsUpdate = true;
        const box = new THREE.BoxGeometry(0.7, 2, 0.7);
        box.translate(0, 1, 0);
        const geometry = new THREE.InstancedBufferGeometry().copy(box);
        geometry.instanceCount = core.count;
        this.previous = new THREE.InstancedBufferAttribute(new Float32Array(core.count * 2), 2);
        this.current = new THREE.InstancedBufferAttribute(new Float32Array(core.count * 2), 2);
        this.alive = new THREE.InstancedBufferAttribute(new Float32Array(core.count), 1);
        this.hitAge = new THREE.InstancedBufferAttribute(new Float32Array(core.count), 1);
        this.variant = new THREE.InstancedBufferAttribute(new Float32Array(core.count), 1);
        for (const attribute of [this.previous, this.current, this.alive, this.hitAge, this.variant])
            attribute.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('simPrevious', this.previous); geometry.setAttribute('simCurrent', this.current);
        geometry.setAttribute('simAlive', this.alive); geometry.setAttribute('simHitAge', this.hitAge);
        geometry.setAttribute('simVariant', this.variant);
        this.mesh = new THREE.Mesh(geometry, this.material(false));
        this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
        this.group.add(this.mesh);
        const plate = new THREE.BoxGeometry(0.1, 1.1, 0.9);
        plate.translate(0.5, 1.1, 0);
        const shieldGeometry = new THREE.InstancedBufferGeometry().copy(plate);
        shieldGeometry.instanceCount = 0;
        const attribute = (size: number) => new THREE.InstancedBufferAttribute(
            new Float32Array(core.count * size), size).setUsage(THREE.DynamicDrawUsage);
        this.plates = { previous: attribute(2), current: attribute(2), alive: attribute(1), hitAge: attribute(1),
            variant: attribute(1), heading: attribute(1) };
        this.headings = new Float32Array(core.count);
        shieldGeometry.setAttribute('simPrevious', this.plates.previous);
        shieldGeometry.setAttribute('simCurrent', this.plates.current);
        shieldGeometry.setAttribute('simAlive', this.plates.alive);
        shieldGeometry.setAttribute('simHitAge', this.plates.hitAge);
        shieldGeometry.setAttribute('simVariant', this.plates.variant);
        shieldGeometry.setAttribute('simHeading', this.plates.heading);
        this.shieldMesh = new THREE.Mesh(shieldGeometry, this.material(true));
        this.shieldMesh.frustumCulled = false; this.shieldMesh.receiveShadow = true;
        this.group.add(this.shieldMesh);
    }
    private material(shield: boolean): T.MeshToonMaterial {
        const nav = this.driver.core.nav;
        const material = new THREE.MeshToonMaterial({ color: '#ffffff' });
        material.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, { simAlpha: this.alpha, simEffectTime: this.effectTime, simClock: this.clock,
                simPalette: { value: VARIANTS.map(variant => new THREE.Color(variant.color ?? 0xd43b3b)) },
                simAlternate: { value: VARIANTS.map(variant => {
                    const colour = new THREE.Color(variant.flashColor ?? 0);
                    return new THREE.Vector4(colour.r, colour.g, colour.b, variant.flashColor === undefined ? 0 : 1);
                }) },
                simScale: { value: VARIANTS.map(variant => new THREE.Vector3(
                    variant.radius / VARIANTS[0].radius, variant.height / VARIANTS[0].height,
                    variant.radius / VARIANTS[0].radius)) },
                simHeights: { value: this.heightTexture },
                simGrid: { value: new THREE.Vector2(nav.terrainColumns, nav.terrainRows) },
                simExtent: { value: new THREE.Vector2(nav.widthCm / 100, nav.depthCm / 100) } });
            shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 simPrevious;
attribute vec2 simCurrent;
attribute float simAlive;
attribute float simHitAge;
attribute float simVariant;
${shield ? 'attribute float simHeading;' : ''}
uniform vec3 simPalette[${VARIANTS.length}];
uniform vec4 simAlternate[${VARIANTS.length}];
uniform float simClock;
uniform vec3 simScale[${VARIANTS.length}];
varying vec3 simTint;
uniform float simEffectTime;
varying vec2 simEffect;
uniform float simAlpha;
uniform sampler2D simHeights;
uniform vec2 simGrid;
uniform vec2 simExtent;
float simHeight(vec2 xz) {
    vec2 grid = clamp(xz / simExtent, 0.0, 1.0) * (simGrid - 1.0);
    vec2 cell = min(floor(grid), simGrid - 2.0);
    vec2 fraction = grid - cell;
    float a = texture2D(simHeights, (cell + vec2(0.5)) / simGrid).r;
    float b = texture2D(simHeights, (cell + vec2(1.5, 0.5)) / simGrid).r;
    float c = texture2D(simHeights, (cell + vec2(0.5, 1.5)) / simGrid).r;
    float d = texture2D(simHeights, (cell + vec2(1.5)) / simGrid).r;
    if (fraction.x + fraction.y <= 1.0) return a + (b-a)*fraction.x + (c-a)*fraction.y;
    return d + (b-d)*(1.0-fraction.y) + (c-d)*(1.0-fraction.x);
}`);
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
int simKind = int(clamp(simVariant,0.0,${VARIANTS.length - 1}.0));
simTint = simPalette[simKind];
if (simAlternate[simKind].w > 0.5) simTint = mix(simTint, simAlternate[simKind].rgb, step(0.5, fract(simClock * 3.0)));
transformed *= simScale[simKind];
${shield ? `simTint = vec3(0.52, 0.55, 0.6);
transformed = vec3(transformed.x * cos(simHeading) - transformed.z * sin(simHeading), transformed.y,
    transformed.x * sin(simHeading) + transformed.z * cos(simHeading));` : ''}
float dying = step(1.5, simAlive);
vec2 simXZ = mix(simPrevious, simCurrent, mix(simAlpha, 1.0, dying));
float age = simHitAge + simEffectTime;
transformed += vec3(simXZ.x, simHeight(simXZ) - dying * 2.1 * simScale[simKind].y * clamp(age / 0.4, 0.0, 1.0), simXZ.y);
simEffect = vec2((1.0 - dying) * (1.0 - smoothstep(1.0, 1.2, age)), dying);
if (simAlive < 0.5 || (dying > 0.5 && age >= 0.4)) transformed = vec3(0.0, -100000.0, 0.0);`);
            if (shield) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
                `#include <beginnormal_vertex>
objectNormal = vec3(objectNormal.x * cos(simHeading) - objectNormal.z * sin(simHeading), objectNormal.y,
    objectNormal.x * sin(simHeading) + objectNormal.z * cos(simHeading));`);
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
                '#include <common>\nvarying vec2 simEffect;\nvarying vec3 simTint;');
            shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `gl_FragColor.rgb *= simTint;
#include <fog_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), simEffect.x);
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.0), simEffect.y);`);
        };
        material.customProgramCacheKey = () => `Datacenter zombie terrain effects v8${shield ? ' shield' : ''}`;
        return material;
    }
    static async start(gpu: GPU, world: World, scene: T.Scene, render: () => void,
        notify: (message: string) => void, onStop: () => void, signal: AbortSignal,
        defense = false, continuousSpawn = false, options: DriverOptions = {}): Promise<ZombieView> {
        let view: ZombieView | undefined;
        const driver = await SimDriver.create(gpu, world, {
            ...options, signal, defense, continuousSpawn, testMode: !defense, profile: PROFILE, onProgress: notify,
            onSnapshot: snapshot => view?.accept(snapshot),
            onHash: (tick, hash) => {
                console.info(`Simulation tick ${tick}: hash ${hash.toString(16).padStart(8, '0')}`);
                if (PROFILE && tick % PROFILE_LOG_TICKS === 0) logProfile(view?.core);
            },
            onError: error => {
                view?.stop(); notify(error.message);
            }
        });
        try {
            const core = driver.core;
            view = new ZombieView(driver, render, onStop);
            view.buildFlow(await core.flowData(), world);
            if (signal.aborted) throw Error('Simulation stopped');
            scene.add(view.group);
            if (driver.local) driver.submit({ type: CommandType.Ready, payload: [] });
            console.info(`Simulation map hash ${core.nav.hash.toString(16)}; variant hash ${core.handshake.variants.toString(16)}`);
            const wave = Math.min(MAX_ZOMBIES, core.nav.spawns.length * (defense ? 1000 : 10000));
            if (!defense) notify([`${wave.toLocaleString('en-US')} zombies per wave${continuousSpawn ? ' · Every 60 s' : ''}` +
                ` · Map ${core.nav.hash.toString(16)}`, ...core.notices].join(' · '));
            if (PROFILE) {
                // Console helpers: datacenterProfile.report(), .reset() and .memory().
                profileHook = {
                    report: () => core.profileReport(), reset: () => core.resetProfile(),
                    memory: () => core.memoryUsage
                };
                Object.assign(window, { datacenterProfile: profileHook });
                console.info(`Simulation profiling enabled; logging every ${PROFILE_LOG_TICKS} ticks. ` +
                    'Use datacenterProfile.report() / .reset() / .memory() in the console.');
            }
            driver.start(); view.frame = requestAnimationFrame(() => view?.animate());
            return view;
        } catch (error) {
            view?.stop(); driver.stop(); throw error;
        }
    }
    strategicFade(value: number) {
        this.mesh.visible = this.shieldMesh.visible = value < 0.99;
    }
    private accept(snapshot: RenderSnapshot) {
        if (this.stopped || snapshot.tick <= this.snapshotTick) return;
        this.previousTick = this.snapshotTick || snapshot.tick;
        const previous = this.previous.array as Float32Array, current = this.current.array as Float32Array;
        const alive = this.alive.array as Float32Array, hitAge = this.hitAge.array as Float32Array;
        previous.set(current); this.enemyCount = 0;
        const plates = this.plates, objective = this.core.nav.objective;
        const plateAlive = plates.alive.array as Float32Array, plateHit = plates.hitAge.array as Float32Array;
        const platePrevious = plates.previous.array as Float32Array;
        const plateCurrent = plates.current.array as Float32Array;
        const plateVariant = plates.variant.array as Float32Array;
        const plateHeading = plates.heading.array as Float32Array;
        let plateCount = 0;
        for (let i = 0; i < this.core.count; i++) {
            const wasAlive = alive[i] === 1;
            current[i * 2] = snapshot.words[i * 3] / Q; current[i * 2 + 1] = snapshot.words[i * 3 + 1] / Q;
            const packed = snapshot.words[i * 3 + 2], state = packed >>> RENDER_ZOMBIE_STATE_SHIFT & 3;
            alive[i] = state === 3 ? 2 : state ? 1 : 0;
            if (state === 1 || state === 2) {
                this.enemyCount++;
                if (!wasAlive) {
                    previous[i * 2] = current[i * 2]; previous[i * 2 + 1] = current[i * 2 + 1];
                }
            }
            hitAge[i] = (packed >>> 24) / 20;
            (this.variant.array as Float32Array)[i] = packed & 255;
            if (!this.shielded[packed & 255] || !state || (state === 3 && hitAge[i] > 0.45)) continue;
            const dx = current[i * 2] - previous[i * 2], dz = current[i * 2 + 1] - previous[i * 2 + 1];
            if (state !== 3 && !wasAlive) this.headings[i] = Math.atan2(objective.z / Q - current[i * 2 + 1],
                objective.x / Q - current[i * 2]);
            else if (state === 1 && Math.hypot(dx, dz) > 0.02) {
                const turn = Math.atan2(dz, dx) - this.headings[i];
                this.headings[i] += Math.atan2(Math.sin(turn), Math.cos(turn)) * 0.4;
            }
            platePrevious.set([previous[i * 2], previous[i * 2 + 1]], plateCount * 2);
            plateCurrent.set([current[i * 2], current[i * 2 + 1]], plateCount * 2);
            plateAlive[plateCount] = alive[i]; plateHit[plateCount] = hitAge[i];
            plateVariant[plateCount] = packed & 255; plateHeading[plateCount++] = this.headings[i];
        }
        (this.shieldMesh.geometry as T.InstancedBufferGeometry).instanceCount = plateCount;
        for (const attribute of Object.values(plates)) {
            attribute.updateRange.offset = 0; attribute.updateRange.count = plateCount * attribute.itemSize;
            attribute.needsUpdate = plateCount > 0;
        }
        if (!this.snapshotTick) previous.set(current);
        this.snapshotTick = snapshot.tick;
        this.previous.needsUpdate = this.current.needsUpdate = this.alive.needsUpdate =
            this.hitAge.needsUpdate = this.variant.needsUpdate = true;
    }
    private animate() {
        if (this.stopped) return;
        this.alpha.value = Math.max(0, Math.min(1, (this.driver.renderTick - this.previousTick) /
            Math.max(1, this.snapshotTick - this.previousTick)));
        this.clock.value = performance.now() / 1000;
        if (this.driver.result) this.resultTime ??= this.clock.value;
        this.effectTime.value = this.resultTime === undefined
            ? Math.max(0, (this.driver.renderTick - this.snapshotTick) / 20)
            : this.clock.value - this.resultTime;
        this.render(); this.frame = requestAnimationFrame(() => this.animate());
    }
    private buildFlow(data: Uint32Array, world: World) {
        const nav = this.core.flowGrid, count = nav.columns * nav.rows;
        const stride = Math.max(1, Math.ceil(Math.sqrt(count / 4096))), cell = nav.cellCm / 100;
        const positions: Array<number> = [];
        const vectors = [[-1, 0], [0, -1], [1, 0], [0, 1], [-0.7071, -0.7071],
            [0.7071, -0.7071], [0.7071, 0.7071], [-0.7071, 0.7071]];
        for (let z = 0; z < nav.rows; z += stride) for (let x = 0; x < nav.columns; x += stride) {
            const i = z * nav.columns + x, dir = data[count + (i >>> 2)] >>> ((i & 3) * 8) & 255;
            if (dir >= 8) continue;
            const px = Math.min(world.width, (x + 0.5) * cell), pz = Math.min(world.depth, (z + 0.5) * cell);
            const py = elevation(world, { x: px, z: pz }) + 0.4;
            const length = Math.min(20, cell * stride * 0.7);
            const dx = vectors[dir][0] * length, dz = vectors[dir][1] * length;
            positions.push(px, py, pz, px + dx, py, pz + dz);
            for (const sign of [-1, 1]) positions.push(px + dx, py, pz + dz,
                px + dx * 0.65 - dz * sign * 0.25, py, pz + dz * 0.65 + dx * sign * 0.25);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.flow = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#3b7048' }));
        this.flow.visible = false; this.group.add(this.flow);
    }
    showFlow(show: boolean) {
        if (this.flow) this.flow.visible = show; this.render();
    }
    stop() {
        if (this.stopped) return;
        this.stopped = true; cancelAnimationFrame(this.frame); this.driver.stop();
        if (PROFILE && profileHook &&
            (window as Window & { datacenterProfile?: object }).datacenterProfile === profileHook) {
            delete (window as Window & { datacenterProfile?: object }).datacenterProfile; profileHook = undefined;
        }
        this.group.parent?.remove(this.group);
        this.mesh.geometry.dispose(); this.shieldMesh.geometry.dispose();
        (this.mesh.material as T.Material).dispose(); (this.shieldMesh.material as T.Material).dispose();
        this.heightTexture.dispose();
        if (this.flow) {
            this.flow.geometry.dispose(); (this.flow.material as T.Material).dispose();
        }
        this.group.clear();
        this.render(); this.onStop();
    }
}
