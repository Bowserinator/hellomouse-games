import type * as T from 'three';
import { CAM } from '../vars.js';
import { World } from '../sim/world/planet.js';
import { distance, V3 } from '../sim/math/vec3.js';

export function blueNoise(sample: number): number {
    let value = 0;
    let weight = 0;
    // Square-root spectral amplitudes give noise power proportional to frequency.
    for (let frequency = 1; frequency <= 16; frequency++) {
        const amplitude = Math.sqrt(frequency);
        value += amplitude * Math.cos(2 * Math.PI * frequency * sample / 64 +
            frequency * frequency * 2.399963229728653);
        weight += amplitude;
    }
    return value / weight;
}
export class CameraRig {
    camera = new THREE.PerspectiveCamera(CAM.FOV, 1, 0.1, 2200);
    viewFwd = new THREE.Vector3(0, 0, -1);
    right = new THREE.Vector3(1, 0, 0);
    overview = false;
    flying = false;
    distance: number = CAM.DIST_DEFAULT;
    yaw = 0;
    pitch = 0.7;
    private shakeAmount = 0;
    private shakeTime = 0;
    private ready = false;
    private desired = new THREE.Vector3();
    private look = new THREE.Vector3();
    private smoothLook = new THREE.Vector3();
    private up = new THREE.Vector3(0, 1, 0);
    private targetUp = new THREE.Vector3();
    private transport = new THREE.Quaternion();
    private jitter = new THREE.Vector3();
    private shakeUp = new THREE.Vector3();
    shake(amount: number, position: V3): void {
        const attenuation = Math.max(0, 1 - distance(this.look, position) / 40);
        this.shakeAmount = Math.max(this.shakeAmount, amount * attenuation);
    }
    zoom(delta: number): void {
        if (this.flying) return;
        this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(delta * 0.001), CAM.DIST_MIN, CAM.DIST_MAX);
    }
    rotate(angle: number): void {
        this.viewFwd.applyAxisAngle(this.up, angle);
    }
    update(dt: number, target: T.Object3D | undefined, world: World): void {
        const smooth = this.ready && !this.flying ? 1 - Math.exp(-CAM.SMOOTH * dt) : 1;
        if (!target || this.overview) {
            this.look.set(0, 0, 0);
            world.desc.planets.forEach(p => this.look.add(new THREE.Vector3(...p.center)));
            this.look.multiplyScalar(1 / world.desc.planets.length);
            const extent = Math.max(...world.desc.planets.map(p =>
                new THREE.Vector3(...p.center).distanceTo(this.look) + p.radius));
            const d = extent * 2.7 * this.distance / CAM.DIST_DEFAULT;
            this.desired.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch),
                Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(d).add(this.look);
            this.up.set(0, 1, 0);
        } else {
            this.targetUp.set(0, 1, 0).applyQuaternion(target.quaternion);
            this.transport.setFromUnitVectors(this.up, this.targetUp);
            this.viewFwd.applyQuaternion(this.transport);
            this.up.copy(this.targetUp);
            this.viewFwd.addScaledVector(this.up, -this.viewFwd.dot(this.up)).normalize();
            if (this.viewFwd.lengthSq() < 0.1) this.viewFwd.set(1, 0, 0).cross(this.up).normalize();
            this.right.crossVectors(this.viewFwd, this.up).normalize();
            this.look.copy(target.position);
            const pitch = CAM.PITCH_DEG * Math.PI / 180;
            const range = this.flying ? CAM.DIST_MAX * 2.5 : this.distance;
            this.desired.copy(target.position).addScaledVector(this.up, range * Math.sin(pitch))
                .addScaledVector(this.viewFwd, -range * Math.cos(pitch));
        }
        this.camera.position.lerp(this.desired, smooth);
        this.camera.up.lerp(this.up, smooth).normalize();
        this.smoothLook.lerp(this.look, smooth);
        this.jitter.copy(this.smoothLook);
        this.shakeTime += dt * 60;
        if (this.shakeAmount > 0.001) {
            const range = this.camera.position.distanceTo(this.smoothLook);
            this.shakeUp.subVectors(this.smoothLook, this.camera.position).crossVectors(this.right,
                this.shakeUp).normalize();
            const sample = Math.floor(this.shakeTime);
            this.jitter.addScaledVector(this.right, blueNoise(sample) * this.shakeAmount * range);
            this.jitter.addScaledVector(this.shakeUp, blueNoise(sample + 23) * this.shakeAmount * range);
        }
        this.camera.lookAt(this.jitter);
        this.shakeAmount *= Math.exp(-12 * dt);
        this.ready = true;
    }
    resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }
    reset(): void {
        this.ready = false;
        this.shakeAmount = 0;
    }
}
