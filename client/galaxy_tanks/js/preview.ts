import { Sky } from './render/sky.js';
import { disposeTree } from './render/geometry.js';
import { PlanetView } from './render/planet/planet-view.js';
import { PostProcess } from './render/post/post-process.js';
import { makeTextures, STONE_TEXTURE } from './render/planet/surface-styles.js';
import { generateMap } from './sim/mapgen/index.js';
import { MapDesc, PlanetDesc } from './sim/mapgen/map-desc.js';
import { HoleStyle, ObstacleStrategyType, SkyType, SurfaceType } from './types.js';

const el = (id: string): HTMLElement => document.getElementById(id)!;
const MAX_PIXEL_RATIO = 1.5;
const AUTO_ROTATE_RATE = 0.12;

const titleCase = (name: string): string => name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, ' ');
const enumEntries = (kind: Record<string, string | number>): Array<[string, number]> =>
    Object.entries(kind).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        .map(([name, value]) => [titleCase(name), value]);

const settings: Array<{ id: string; entries: Array<[string, number]> }> = [
    { id: 'surface', entries: enumEntries(SurfaceType) },
    { id: 'strategy', entries: enumEntries(ObstacleStrategyType) },
    { id: 'hole-style', entries: enumEntries(HoleStyle).map(([name, value]): [string, number] =>
        [value === HoleStyle.RANDOM ? 'Irregular' : name, value]) },
    { id: 'sky', entries: enumEntries(SkyType) }
];
for (const { id, entries } of settings) {
    const select = el(id) as HTMLSelectElement;
    select.add(new Option('Random', ''));
    for (const [name, value] of entries) select.add(new Option(name, String(value)));
    select.onchange = generate;
}
function choice(id: string): number | undefined {
    const value = (el(id) as HTMLSelectElement).value;
    return value === '' ? undefined : Number(value);
}

const canvas = el('board') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x030610);
const post = new PostProcess(renderer, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 1, 3000);
const sky = new Sky(false);
scene.add(sky.points);
scene.add(new THREE.HemisphereLight(0xb8d6ff, 0x252033, 0.8));
const sun = new THREE.DirectionalLight(0xffefd4, 0.8);
sun.position.set(-0.4, 0.8, 0.5);
scene.add(sun);

const textures = new Map<number, ReturnType<typeof makeTextures>>();
const preserved = new Set<import('three').Texture>(sky.cubes);
function texturesFor(kind: number): ReturnType<typeof makeTextures> {
    let found = textures.get(kind);
    if (!found) {
        found = makeTextures(kind, 512);
        textures.set(kind, found);
        preserved.add(found.albedo);
        preserved.add(found.bump);
    }
    return found;
}

const orbit = { yaw: 0.6, pitch: 0.35, distance: 80, min: 20, max: 200 };
let view: PlanetView | undefined;
let dragging = false;
let lastX = 0;
let lastY = 0;

function describe(map: MapDesc, planet: PlanetDesc): string {
    const holes = planet.holes?.length
        ? `${planet.holes.length} ${planet.holes[0].harmonics.length ? 'irregular' : 'circular'}`
        : 'none';
    return [
        `Seed: ${map.seed}`,
        `Radius: ${planet.radius.toFixed(1)}`,
        `Surface: ${titleCase(SurfaceType[planet.surface])}`,
        `Obstacles: ${titleCase(ObstacleStrategyType[planet.strategy])} (${planet.obstacles.length})`,
        `Holes: ${holes}`,
        `Sky: ${titleCase(SkyType[map.sky ?? SkyType.STARS])}`
    ].join('\n');
}
function generate(): void {
    const options = {
        surface: choice('surface') as SurfaceType | undefined,
        strategy: choice('strategy') as ObstacleStrategyType | undefined,
        holeStyle: choice('hole-style') as HoleStyle | undefined,
        sky: choice('sky') as SkyType | undefined
    };
    // A fixed hole shape only shows up on planets that have holes
    if (options.holeStyle !== undefined && options.strategy === undefined)
        options.strategy = ObstacleStrategyType.HOLES;
    let map: MapDesc | undefined;
    for (let attempt = 0; attempt < 20 && !map; attempt++)
        try {
            map = generateMap(Math.floor(Math.random() * 0x7fffffff), options);
        } catch {
            map = undefined;
        }

    if (!map) {
        el('info').textContent = 'Could not generate a planet, try again';
        return;
    }
    const planet = { ...map.planets[0], center: [0, 0, 0] as [number, number, number] };
    if (view) {
        scene.remove(view.root);
        disposeTree(view.root, preserved);
    }
    sky.setKind(map.sky ?? SkyType.STARS);
    scene.background = sky.background;
    post.setPlanets([planet]);
    setSlider(post.atmosphere(0));
    view = new PlanetView(planet, sky.cube, false, texturesFor(planet.surface), texturesFor(STONE_TEXTURE));
    scene.add(view.root);
    orbit.distance = planet.radius * 3.2;
    orbit.min = planet.radius * 1.4;
    orbit.max = planet.radius * 8;
    el('info').textContent = describe(map, planet);
}
el('generate').onclick = generate;

const atmosphere = el('atmosphere') as HTMLInputElement;
function setSlider(fraction: number): void {
    atmosphere.value = String(Math.round(fraction * 100));
    el('atmosphere-value').textContent = `${atmosphere.value}%`;
}
atmosphere.oninput = () => {
    post.setAtmosphere(0, Number(atmosphere.value) / 100);
    setSlider(post.atmosphere(0));
};

function resize(): void {
    const ratio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    renderer.setDrawingBufferSize(width, height, ratio);
    post.resize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
canvas.addEventListener('pointerdown', e => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    orbit.yaw -= (e.clientX - lastX) * 0.006;
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - lastY) * 0.006, -1.45, 1.45);
    lastX = e.clientX;
    lastY = e.clientY;
});
window.addEventListener('pointerup', () => {
    dragging = false;
});
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.distance = THREE.MathUtils.clamp(orbit.distance * Math.exp(e.deltaY * 0.001), orbit.min, orbit.max);
}, { passive: false });

const frustum = new THREE.Frustum();
const matrix = new THREE.Matrix4();
let previous = 0;
function draw(time: number): void {
    const dt = Math.min(0.05, (time - previous) / 1000 || 0.016);
    previous = time;
    if (!dragging && (el('auto-rotate') as HTMLInputElement).checked) orbit.yaw += AUTO_ROTATE_RATE * dt;
    camera.position.set(Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch),
        Math.cos(orbit.yaw) * Math.cos(orbit.pitch)).multiplyScalar(orbit.distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    view?.update(time / 1000, frustum);
    sky.update(time / 1000, renderer.getPixelRatio(), camera);
    post.render(scene, camera);
    requestAnimationFrame(draw);
}
resize();
generate();
requestAnimationFrame(draw);
