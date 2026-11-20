import { MODELS } from './model-registry.js';
import { loadModel } from './model-loader.js';
import { RigBatch } from './rig.js';
import { Sonic } from './sonic.js';
import { blankWorld } from '../editor/world.js';
import { SONIC_SMALL } from '../sim/content/index.js';
import { ENTITY as E, MAX_ENTITIES, RENDER_ENTITY_WORDS } from '../sim/layout.js';

const host = document.getElementById('model-canvas')!;
const select = document.getElementById('model') as HTMLSelectElement;
const scale = document.getElementById('scale') as HTMLInputElement;
const yaw = document.getElementById('yaw') as HTMLInputElement;
const aim = document.getElementById('aim') as HTMLInputElement;
const fire = document.getElementById('fire') as HTMLInputElement;
const sonicToggle = document.getElementById('sonic') as HTMLInputElement;
const power = document.getElementById('power') as HTMLInputElement;
const message = document.getElementById('message')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio); renderer.setClearColor('#dce0d8');
host.append(renderer.domElement);
const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 0.5); sun.position.set(5, 10, 4); scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshToonMaterial({ color: '#9eae83' }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; scene.add(floor);
scene.add(new THREE.GridHelper(40, 40));
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
const sonic = new Sonic(blankWorld(40, 40), scene);
const sonicRows = new Int32Array(MAX_ENTITIES * RENDER_ENTITY_WORDS);
sonicRows[E.def] = SONIC_SMALL; sonicRows[E.flags] = 256;
const axes = new THREE.AxesHelper(2); scene.add(axes);
const aims = new Float32Array(4), kicks = new Float32Array(4), muzzles = new Float32Array(12);
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3030' }));
scene.add(marker);
let batch: RigBatch | undefined, generation = 0, distance = 8, azimuth = 0.7, pitch = 0.5;
let pointer: { x: number; y: number } | undefined;
for (const name of MODELS.keys()) {
    const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option);
}
async function choose() {
    const version = ++generation; batch?.destroy(); batch = undefined;
    const spec = MODELS.get(select.value)!; message.textContent = 'Loading';
    try {
        const rig = await loadModel(spec);
        if (version !== generation) {
            rig.dispose(); return;
        }
        batch = new RigBatch(rig, { ...spec }, group); scale.value = '1';
        yaw.value = String(spec.yaw * 180 / Math.PI);
        message.textContent = `${rig.parts.length} parts`;
    } catch (error) {
        if (version === generation) message.textContent = String(error);
    }
}
select.addEventListener('change', () => {
    void choose();
}); void choose();
renderer.domElement.addEventListener('pointerdown', event => {
    pointer = { x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', event => {
    if (!pointer) return;
    azimuth -= (event.clientX - pointer.x) * 0.01;
    pitch = Math.max(0.05, Math.min(1.5, pitch + (event.clientY - pointer.y) * 0.01));
    pointer = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', () => {
    pointer = undefined;
});
renderer.domElement.addEventListener('wheel', event => {
    event.preventDefault(); distance = Math.max(2, Math.min(50, distance * Math.exp(event.deltaY * 0.001)));
}, { passive: false });
document.getElementById('copy')!.addEventListener('click', () => {
    const spec = MODELS.get(select.value)!;
    void navigator.clipboard.writeText(JSON.stringify({ ...spec, scale: spec.scale * Number(scale.value),
        yaw: Number(yaw.value) * Math.PI / 180 }, null, 4)).then(() => {
        message.textContent = 'Copied';
    });
});
function frame(now: number) {
    const width = host.clientWidth, height = host.clientHeight;
    if (renderer.domElement.width !== Math.round(width * renderer.getPixelRatio()) ||
        renderer.domElement.height !== Math.round(height * renderer.getPixelRatio())) {
        renderer.setSize(width, height); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
    }
    camera.position.set(Math.cos(azimuth) * Math.cos(pitch) * distance, Math.sin(pitch) * distance + 0.8,
        Math.sin(azimuth) * Math.cos(pitch) * distance); camera.lookAt(0, 0.8, 0);
    aims.fill(Number(aim.value) * Math.PI / 180);
    kicks.fill(fire.checked ? Math.max(0, 1 - now % 160 / 100) : 0);
    if (batch) {
        group.scale.setScalar(Math.max(0.001, Number(scale.value)));
        batch.spec.yaw = Number(yaw.value) * Math.PI / 180;
        batch.begin(0); batch.pose(0, 0, 0, 0, 0,
            aims, kicks, now / 1000, now / 1000, fire.checked, muzzles); batch.end();
        marker.position.set(muzzles[0], muzzles[1], muzzles[2]).multiplyScalar(group.scale.x);
    }
    sonicRows[E.state] = sonicToggle.checked ? 1 : 0; sonicRows[E.power] = Number(power.value) * 24;
    camera.updateMatrixWorld(); sonic.update(sonicRows, camera, now / 1000, 0);
    renderer.render(scene, camera); sonic.render(renderer, camera); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
