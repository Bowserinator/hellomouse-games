import type * as T from 'three';
import type { Point, World } from '../mapx.js';
import { MAP_FOG_COLOR, MapGeometry } from '../map-geometry.js';
import { elevation } from './world.js';
import { ZombieView } from './zombie-view.js';
import { DefenseSession } from '../game/defense-session.js';
import { checkWebGPU } from '../webgpu.js';
import { SimulationControls } from '../game/ui/simulation-controls.js';
import { ConstructionOverlay, type ConstructionCircle } from '../render/construction-overlay.js';
import { BALANCE } from '../sim/balance.js';
import type { DriverOptions } from '../sim/driver.js';

export class Preview {
    renderer: T.WebGLRenderer;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.5, 100000);
    target = new THREE.Vector3();
    distance = 1000;
    yaw = Math.PI / 4;
    pitch = Math.PI / 3;
    details = true;
    overlays = true;
    private geometry = new MapGeometry();
    private objectiveFallStart?: number;
    private objectiveFall = 0;
    private construction = new ConstructionOverlay();
    private objectiveCircles: Array<ConstructionCircle> = [];
    private sun = new THREE.DirectionalLight(0xffffff, 0.35);
    private shadowBounds = new THREE.Box3();
    private shadowRegion = '';
    private queued = false;
    private simulation?: ZombieView;
    private pendingSimulation?: AbortController;
    private defense?: DefenseSession;
    private simulationControls?: SimulationControls;
    onSimulationChange?: () => void;
    onStats?: (fps: number, frameMs: number, tickMs?: number) => void;
    private statsSince = 0;
    private statsLast = 0;
    private statsFrames = 0;
    private statsCpu = 0;
    get simulating() {
        return !!(this.simulation || this.pendingSimulation);
    }
    get driver() {
        return this.simulation?.driver;
    }
    get simulationReady() {
        return !!this.simulation;
    }
    get defending() {
        return !!this.defense;
    }
    get runtimeStats() {
        return this.defense?.runtimeStats;
    }
    get enemyCount() {
        return this.simulation?.enemyCount;
    }
    async startSimulation(world: World, notify: (message: string) => void, defense = false, continuousSpawn = false,
        skipPreparation = false, options: DriverOptions = {}) {
        if (this.simulating) return;
        if (skipPreparation && world.rules) {
            world = structuredClone(world);
            const waves = Object.values(world.rules!.waves).flat();
            const offset = waves.length ? Math.min(...waves.map(wave => wave.time)) : 0;
            for (const wave of waves) wave.time -= offset;
            world.rules!.winTime = Math.max(1, world.rules!.winTime - offset);
        }
        if (!await checkWebGPU()) throw Error('WebGPU is unavailable. Check browser compatibility and graphics settings.');
        const controller = new AbortController();
        this.pendingSimulation = controller; this.onSimulationChange?.();
        let view: ZombieView | undefined;
        try {
            view = await ZombieView.start(navigator.gpu, world, this.scene, () => this.render(), notify,
                () => {
                    if (this.simulation === view) {
                        this.defense?.destroy(); this.defense = undefined;
                        this.simulationControls?.destroy(); this.simulationControls = undefined;
                        this.simulation = undefined;
                    }
                    this.onSimulationChange?.();
                }, controller.signal, defense, continuousSpawn, options);
            if (controller.signal.aborted) view.stop();
            else {
                this.simulation = view;
                this.simulationControls = new SimulationControls(view.driver, this.host);
                if (defense)
                    this.defense = new DefenseSession(view.driver, this.camera, this.scene, this.host, world, notify);
            }
        } catch (error) {
            view?.stop();
            if (!controller.signal.aborted) throw error;
        } finally {
            if (this.pendingSimulation === controller) this.pendingSimulation = undefined;
            this.onSimulationChange?.();
        }
    }
    stopSimulation() {
        const running = this.simulating;
        this.pendingSimulation?.abort(); this.pendingSimulation = undefined;
        this.defense?.destroy(); this.defense = undefined;
        this.simulationControls?.destroy(); this.simulationControls = undefined;
        this.simulation?.stop(); this.simulation = undefined;
        if (running) {
            this.objectiveFallStart = undefined;
            this.objectiveFall = 0;
            this.geometry.setObjectiveFall(0);
            this.renderer.shadowMap.needsUpdate = true;
            this.renderer.renderLists.dispose();
            this.renderer.getContext().finish();
        }
        this.onSimulationChange?.();
        return running;
    }
    showFlow(show: boolean) {
        this.simulation?.showFlow(show);
    }
    private drag?: { x: number; y: number; button: number };
    constructor(private host: HTMLElement) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setClearColor(MAP_FOG_COLOR);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        host.append(this.renderer.domElement);
        this.scene.add(this.geometry.group);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 0.65));
        this.sun.castShadow = true;
        const shadowSize = Math.min(4096, this.renderer.capabilities.maxTextureSize);
        this.sun.shadow.mapSize.set(shadowSize, shadowSize);
        this.sun.shadow.bias = -0.00001;
        this.sun.shadow.normalBias = 0.05;
        this.scene.add(this.sun, this.sun.target);
        const canvas = this.renderer.domElement;
        host.addEventListener('contextmenu', event => {
            event.preventDefault(); event.stopPropagation();
        }, { capture: true, passive: false });
        host.addEventListener('mousedown', event => {
            if (event.button === 2) event.preventDefault();
        }, { capture: true, passive: false });
        canvas.onpointerdown = event => {
            if (this.defense) return;
            canvas.setPointerCapture(event.pointerId);
            this.drag = { x: event.clientX, y: event.clientY, button: event.button };
        };
        canvas.onpointermove = event => {
            if (this.defense || !this.drag) return;
            const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
            if (this.drag.button !== 0 || event.shiftKey) {
                const scale = this.distance / Math.max(host.clientHeight, 1);
                this.target.x -= (Math.cos(this.yaw) * dx + Math.sin(this.yaw) * dy) * scale;
                this.target.z += (Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dy) * scale;
            } else {
                this.yaw -= dx * 0.006;
                this.pitch = Math.max(0.08, Math.min(Math.PI / 2 - 0.02, this.pitch + dy * 0.006));
            }
            this.drag.x = event.clientX;
            this.drag.y = event.clientY;
            this.render();
        };
        canvas.onpointerup = canvas.onpointercancel = () => {
            this.drag = undefined;
        };
        canvas.onwheel = event => {
            if (this.defense) return;
            event.preventDefault();
            this.distance = Math.max(5, Math.min(50000, this.distance * Math.exp(event.deltaY * 0.001)));
            this.render();
        };
        new ResizeObserver(() => this.render()).observe(host);
    }
    focus(world: World, point: Point, visibleWidth: number) {
        this.target.set(point.x, elevation(world, point), point.z);
        this.distance = Math.max(20, visibleWidth * 1.2);
        this.render();
    }
    render() {
        if (this.queued || this.host.hidden) return;
        this.queued = true;
        requestAnimationFrame(() => {
            this.queued = false;
            if (this.host.hidden) return;
            const start = performance.now();
            const w = this.host.clientWidth, h = this.host.clientHeight;
            if (!w || !h) return;
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            if (this.defense) {
                this.defense.update(start); this.target.copy(this.defense.camera.target);
                this.distance = this.defense.camera.distance;
                this.simulation?.strategicFade(this.defense.camera.zombieFade);
            } else {
                this.camera.position.set(
                    this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance,
                    this.target.y + Math.sin(this.pitch) * this.distance,
                    this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance
                );
                this.camera.lookAt(this.target);
            }
            if (this.defense && this.driver?.result?.outcome === 'defeat' && this.objectiveFall < 1) {
                this.objectiveFallStart ??= start;
                this.objectiveFall = Math.min(1, (start - this.objectiveFallStart) / 1000);
                this.geometry.setObjectiveFall(this.objectiveFall);
                this.renderer.shadowMap.needsUpdate = true;
            }
            this.construction.setCircles(this.defense?.constructionCircles() ?? this.objectiveCircles);
            this.fitShadows();
            this.renderer.render(this.scene, this.camera);
            this.defense?.view.renderRefraction(this.renderer);
            if (!this.statsSince || start - this.statsLast > 1000) {
                this.statsSince = start; this.statsFrames = 0; this.statsCpu = 0;
            }
            this.statsLast = start;
            this.statsFrames++; this.statsCpu += performance.now() - start;
            const elapsed = start - this.statsSince;
            if (elapsed >= 500) {
                this.onStats?.(this.statsFrames * 1000 / elapsed, this.statsCpu / this.statsFrames,
                    this.simulation?.tickMilliseconds);
                this.statsSince = start; this.statsFrames = 0; this.statsCpu = 0;
            }
            this.render();
        });
    }
    private fitShadows() {
        if (this.shadowBounds.isEmpty()) return;
        const center = this.shadowBounds.clampPoint(this.target, new THREE.Vector3());
        const radius = Math.max(20, this.distance * 0.8);
        const region = this.shadowBounds.clone();
        region.min.x = Math.max(region.min.x, center.x - radius);
        region.max.x = Math.min(region.max.x, center.x + radius);
        region.min.z = Math.max(region.min.z, center.z - radius);
        region.max.z = Math.min(region.max.z, center.z + radius);
        const signature = JSON.stringify([region.min.toArray(), region.max.toArray()]);
        if (signature === this.shadowRegion) return;
        this.shadowRegion = signature;
        region.getCenter(center);
        const offset = new THREE.Vector3(-1, 1.8, 0.5).normalize()
            .multiplyScalar(region.getSize(new THREE.Vector3()).length() + 10);
        this.sun.target.position.copy(center);
        this.sun.position.copy(center).add(offset);
        this.sun.updateMatrixWorld(true);
        this.sun.target.updateMatrixWorld(true);
        this.sun.shadow.updateMatrices(this.sun);
        const camera = this.sun.shadow.camera;
        const lightBounds = region.applyMatrix4(camera.matrixWorldInverse);
        const margin = 2;
        Object.assign(camera, {
            left: lightBounds.min.x - margin, right: lightBounds.max.x + margin,
            bottom: lightBounds.min.y - margin, top: lightBounds.max.y + margin,
            near: Math.max(0.5, -lightBounds.max.z - margin), far: -lightBounds.min.z + margin
        });
        camera.updateProjectionMatrix();
        this.renderer.shadowMap.needsUpdate = true;
    }
    sync(world: World) {
        this.geometry.details = this.details;
        this.geometry.overlays = this.overlays;
        const previous = this.geometry.group.children.at(-1);
        this.geometry.sync(world);
        this.geometry.setObjectiveFall(this.objectiveFall);
        this.objectiveCircles = world.objects.filter(object => object.kind === 'objective')
            .map(object => ({ x: object.x, z: object.z, radius: BALANCE.construction.objective }));
        this.construction.apply(this.geometry.group);
        this.construction.setCircles(this.objectiveCircles);
        if (this.geometry.group.children.at(-1) !== previous) {
            this.shadowBounds.setFromObject(this.geometry.group);
            this.renderer.shadowMap.needsUpdate = true;
        }
        this.render();
    }
}
