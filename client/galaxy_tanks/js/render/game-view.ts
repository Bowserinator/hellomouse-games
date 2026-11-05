import type * as T from 'three';
import { World } from '../sim/world/planet.js';
import { Tank } from '../sim/tank.js';
import { Bullet, PowerupItem, isStrike, strikeAltitude } from '../sim/bullet.js';
import { BulletType, SkyType, SurfaceType, TankState } from '../types.js';
import { Sky } from './sky.js';
import { CameraRig } from './camera-rig.js';
import { PlanetView } from './planet/planet-view.js';
import { makeTextures, STONE_TEXTURE } from './planet/surface-styles.js';
import { STAR_HOLD_MS, TANK_COLORS } from '../vars.js';
import { TankRig, makePalette, disposeTankGeometries } from './tank/tank-rig.js';
import { DEFAULT_TANK_STYLE } from './tank/tank-style.js';
import { TreadTrails } from './tank/tread-trails.js';
import { LaunchStars } from './launch-stars.js';
import { Entities } from './entities.js';
import { Effects } from './effects.js';
import { disposeTree, mergeGeometry } from './geometry.js';
import { AimPreview } from './aim-preview.js';
import { PostProcess } from './post/post-process.js';
import { AdaptiveResolution } from './adaptive-resolution.js';

const MAX_PIXEL_RATIO: Record<string, number> = { LOW: 0.8, MED: 1.1, HIGH: 1.5 };
const MIN_PIXEL_RATIO = 0.55;
export class GameView {
    renderer: T.WebGLRenderer;
    scene = new THREE.Scene();
    camera = new CameraRig();
    rigs = new Map<number, TankRig>();
    effects: Effects;
    private sky: Sky;
    private post: PostProcess;
    private planets: Array<PlanetView> = [];
    private stars?: LaunchStars;
    private entities = new Entities();
    private trails: TreadTrails;
    private textures = new Map<SurfaceType, ReturnType<typeof makeTextures>>();
    private stoneTextures: ReturnType<typeof makeTextures>;
    private preserved = new Set<T.Texture>();
    private frustum = new THREE.Frustum();
    private matrix = new THREE.Matrix4();
    private pixel = 1;
    private resolution: AdaptiveResolution;
    private resizePending = true;
    private flightStars = new Set<number>();
    preview = new AimPreview();
    private previewTime = 0;
    private occlusionRay = new THREE.Raycaster();
    private occlusionSphere = new THREE.Sphere();
    private occlusionPoint = new THREE.Vector3();
    private beams: Array<{ mesh: T.Mesh; until: number }> = [];
    private lastStates = new Map<number, { state: TankState; pounding: boolean }>();
    private effectPos = new THREE.Vector3();
    private effectUp = new THREE.Vector3();
    private dust = new THREE.Color(0xb8a58c);
    private colors = TANK_COLORS.map((_, index) => makePalette(index)[0]);
    private thrusters = [DEFAULT_TANK_STYLE.anchors.thrusterL, DEFAULT_TANK_STYLE.anchors.thrusterR];
    quality: string;
    constructor(canvas: HTMLCanvasElement) {
        this.quality = localStorage.getItem('galaxy-quality') ?? 'MED';
        const low = this.quality === 'LOW';
        this.trails = new TreadTrails(low ? 1 : 10);
        // Scenes are drawn offscreen, so the canvas only needs a plain color buffer for the final full-screen pass.
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false,
            powerPreference: 'high-performance' });
        this.renderer.setClearColor(0x030610);
        this.renderer.shadowMap.enabled = false;
        this.post = new PostProcess(this.renderer, low);
        this.sky = new Sky(low);
        this.effects = new Effects(low);
        this.scene.add(this.preview.root);
        this.scene.add(this.sky.points, this.entities.root, this.effects.root, this.trails.mesh);
        this.scene.add(new THREE.HemisphereLight(0xb8d6ff, 0x252033, 0.8));
        const sun = new THREE.DirectionalLight(0xffefd4, 0.8);
        sun.position.set(-0.4, 0.8, 0.5);
        this.scene.add(sun);
        for (const surface of Object.values(SurfaceType).filter((s): s is SurfaceType => typeof s === 'number')) {
            const tex = makeTextures(surface, low ? 256 : 512);
            this.textures.set(surface, tex);
            this.preserved.add(tex.albedo);
            this.preserved.add(tex.bump);
        }
        this.stoneTextures = makeTextures(STONE_TEXTURE, low ? 256 : 512);
        this.preserved.add(this.stoneTextures.albedo);
        this.preserved.add(this.stoneTextures.bump);
        this.sky.cubes.forEach(cube => this.preserved.add(cube));
        const maxPixel = MAX_PIXEL_RATIO[this.quality] ?? MAX_PIXEL_RATIO.MED;
        this.pixel = Math.min(devicePixelRatio, maxPixel);
        this.resolution = new AdaptiveResolution(this.pixel, MIN_PIXEL_RATIO, maxPixel);
        this.resize();
    }
    setWorld(world: World): void {
        this.planets.forEach(p => {
            this.scene.remove(p.root);
            disposeTree(p.root, this.preserved);
        });
        if (this.stars) {
            this.scene.remove(this.stars.root);
            this.stars.dispose(this.sky.cube);
        }
        this.resolution.settle();
        this.sky.setKind(world.desc.sky ?? SkyType.STARS);
        this.scene.background = this.sky.background;
        this.planets = world.desc.planets.map(p => new PlanetView(p, this.sky.cube,
            this.quality === 'LOW', this.textures.get(p.surface)!, this.stoneTextures));
        this.planets.forEach(p => this.scene.add(p.root));
        this.post.setPlanets(world.desc.planets);
        this.stars = new LaunchStars(world, this.sky.cube);
        this.scene.add(this.stars.root);
        this.effects.clear();
        this.trails.clear();
        this.camera.reset();
        this.lastStates.clear();
    }
    isOccluded(point: T.Vector3): boolean {
        const ray = this.occlusionRay;
        ray.ray.origin.copy(this.camera.camera.position);
        ray.ray.direction.copy(point).sub(ray.ray.origin).normalize();
        ray.far = point.distanceTo(ray.ray.origin) - .5;
        for (const planet of this.planets) {
            this.occlusionSphere.center.fromArray(planet.desc.center);
            this.occlusionSphere.radius = planet.desc.radius;
            const hit = ray.ray.intersectSphere(this.occlusionSphere, this.occlusionPoint);
            if (hit && hit.distanceTo(ray.ray.origin) < ray.far) return true;
            if (ray.intersectObjects(planet.occluders, false).length) return true;
        }
        return false;
    }
    resize(): void {
        this.resizePending = true;
    }
    beam(points: Array<T.Vector3>, now: number): void {
        const segments: Array<T.BufferGeometry> = [];
        for (let i = 1; i < points.length; i++) {
            if (points[i - 1].distanceToSquared(points[i]) < 1e-10) continue;
            segments.push(new THREE.TubeGeometry(new THREE.LineCurve3(points[i - 1], points[i]), 1, 0.22, 6, false));
        }
        if (!segments.length) return;
        const mesh = new THREE.Mesh(mergeGeometry(segments),
            new THREE.MeshBasicMaterial({ color: 0xff1616, transparent: true, opacity: 0.95,
                blending: THREE.AdditiveBlending, depthWrite: false }));
        this.scene.add(mesh);
        this.beams.push({ mesh, until: now + 120 });
    }
    render(world: World, tanks: Array<Tank>, bullets: Array<Bullet>, items: Array<PowerupItem>,
        own: number, target: number, now: number, dt: number): void {
        const pixel = this.resolution.update(dt * 1000);
        if (pixel !== undefined) {
            this.pixel = pixel;
            this.resize();
        }
        if (this.resizePending) {
            const canvas = this.renderer.domElement;
            const w = Math.max(1, canvas.clientWidth);
            const h = Math.max(1, canvas.clientHeight);
            if (canvas.width !== Math.floor(w * this.pixel) || canvas.height !== Math.floor(h * this.pixel) ||
                this.renderer.getPixelRatio() !== this.pixel)
                this.renderer.setDrawingBufferSize(w, h, this.pixel);
            this.post.resize();
            this.camera.resize(w, h);
            this.entities.setViewport(w, h);
            this.resizePending = false;
        }
        for (const [id, rig] of this.rigs)
            if (!tanks.some(t => t.id === id)) {
                this.scene.remove(rig.root);
                rig.dispose();
                this.rigs.delete(id);
            }
        for (const tank of tanks) {
            let rig = this.rigs.get(tank.id);
            if (!rig) {
                rig = new TankRig();
                this.rigs.set(tank.id, rig);
                this.scene.add(rig.root);
            }
            rig.sync(tank, world, tank.id === own, now);
            const previous = this.lastStates.get(tank.id);
            if (tank.state === TankState.GROUNDED && previous?.state === TankState.AIRBORNE) {
                world.position(tank.planet, tank.dir, tank.h + .15, this.effectPos);
                this.effects.sparks(this.effectPos, tank.dir, this.dust, now,
                    previous.pounding ? 40 : 18, previous.pounding ? 2 : .8);
                if (previous.pounding) this.effects.shockwave(this.effectPos, tank.dir, this.dust, now);
            }
            if (previous) {
                previous.state = tank.state;
                previous.pounding = tank.pounding;
            } else this.lastStates.set(tank.id, { state: tank.state, pounding: tank.pounding });
            if ((tank.state === TankState.AIRBORNE && (tank.vy > 0 || tank.pounding)) ||
                tank.state === TankState.FLYING)
                for (const anchor of this.thrusters) {
                    if (Math.random() >= dt * 45) continue;
                    rig.root.updateMatrixWorld();
                    this.effectPos.fromArray(anchor).applyMatrix4(rig.root.matrixWorld);
                    this.effectUp.set(0, 1, 0).applyQuaternion(rig.root.quaternion);
                    this.effects.emit(this.effectPos, this.effectUp, now, tank.pounding ? 1.5 : 1);
                }
        }
        const tank = tanks.find(t => t.id === target), rig = this.rigs.get(target);
        this.camera.flying = tank?.state === TankState.FLYING && now >= tank.flightStart + STAR_HOLD_MS;
        this.camera.update(dt, rig?.root, world);
        this.matrix.multiplyMatrices(this.camera.camera.projectionMatrix, this.camera.camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.matrix);
        this.planets.forEach(p => p.update(now / 1000, this.frustum));
        if (this.stars) {
            this.flightStars.clear();
            for (const t of tanks)
                if (t.state === TankState.FLYING && now < t.flightStart + STAR_HOLD_MS)
                    this.flightStars.add(t.flightStar);
            this.stars.update(now, rig?.root.position, this.flightStars);
        }
        this.sky.update(now / 1000, this.pixel, this.camera.camera);
        this.entities.update(bullets, items, tanks, world, now);
        if (now - this.previewTime > 50) {
            this.preview.update(tanks.find(t => t.id === own), tanks, world, now);
            this.previewTime = now;
        }
        for (const bullet of bullets) {
            if (bullet.type !== BulletType.FAST && !isStrike(bullet.type)) continue;
            if (Math.random() >= dt * 55) continue;
            const height = isStrike(bullet.type) ? strikeAltitude(bullet) : bullet.altitude;
            world.position(bullet.planet, bullet.dir, height, this.effectPos);
            this.effects.sparks(this.effectPos, bullet.dir, this.colors[bullet.color], now, 1, .6);
        }
        this.trails.update(tanks, this.rigs, world, now);
        this.effects.update(dt, now);
        for (let i = this.beams.length - 1; i >= 0; i--) {
            const b = this.beams[i];
            if (now < b.until) continue;
            this.scene.remove(b.mesh);
            disposeTree(b.mesh);
            this.beams[i] = this.beams[this.beams.length - 1];
            this.beams.pop();
        }
        this.post.explosions = this.effects.exploding;
        this.post.render(this.scene, this.camera.camera);
    }
    dispose(): void {
        this.beams.forEach(b => disposeTree(b.mesh));
        this.beams.length = 0;
        this.rigs.forEach(r => r.dispose());
        disposeTankGeometries();
        this.stars?.dispose(this.sky.cube);
        this.planets.forEach(p => disposeTree(p.root, this.preserved));
        this.preview.dispose();
        this.effects.dispose();
        this.entities.dispose();
        this.trails.dispose();
        this.sky.dispose();
        this.post.dispose();
        this.textures.forEach(t => {
            t.albedo.dispose();
            t.bump.dispose();
        });
        this.renderer.dispose();
    }
}
