import type * as T from 'three';
import { instanceOpacity } from './instance-opacity.js';
import { type Rig } from './model-loader.js';
import type { ModelSpec } from './model-registry.js';

export interface Fall {
    axis?: number;
    roll: number;
    sink: number;
    shade: number;
}
export class RigBatch {
    private meshes: Array<T.InstancedMesh> = [];
    private worlds: Array<T.Matrix4>;
    private capacity = 64;
    private count = 0;
    private root = new THREE.Matrix4();
    private local = new THREE.Matrix4();
    private motion = new THREE.Matrix4();
    private rotation = new THREE.Quaternion();
    private point = new THREE.Vector3();
    private tint = new THREE.Color();
    constructor(readonly rig: Rig, readonly spec: ModelSpec, private group: T.Group) {
        this.worlds = rig.parts.map(() => new THREE.Matrix4());
        this.create();
    }
    private create() {
        this.meshes = this.rig.parts.map((part, index) => {
            const mesh = new THREE.InstancedMesh(part.geometry, this.rig.material, this.capacity);
            mesh.count = this.count; mesh.frustumCulled = false;
            mesh.visible = !!part.geometry.getAttribute('position');
            mesh.receiveShadow = true;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            const previous = this.meshes[index];
            // r128 setColorAt allocates from the draw count, not the instance capacity.
            mesh.instanceColor = new THREE.InstancedBufferAttribute(
                new Float32Array(this.capacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
            instanceOpacity(mesh, previous);
            if (previous) {
                mesh.instanceMatrix.copyArray(previous.instanceMatrix.array);
                if (previous.instanceColor) mesh.instanceColor?.copyArray(previous.instanceColor.array);
                this.group.remove(previous); previous.dispose(); previous.geometry.dispose();
            }
            this.group.add(mesh); return mesh;
        });
    }
    begin(fade: number) {
        this.count = 0;
        this.rig.material.transparent = true; this.rig.material.opacity = 1 - fade;
    }
    pose(id: number, x: number, y: number, z: number, facing: number, aims: Float32Array,
        kicks: Float32Array, odometer: number, time: number, attacking: boolean,
        muzzles?: Float32Array, fall?: Fall, opacity = 1, color = '#ffffff') {
        if (this.count === this.capacity) {
            this.capacity *= 2; this.create();
        }
        this.root.makeRotationY(-facing + this.spec.yaw);
        if (fall) {
            const axis = fall.axis ?? facing;
            this.rotation.setFromAxisAngle(this.point.set(Math.cos(axis), 0, Math.sin(axis)), fall.roll);
            this.root.premultiply(this.local.makeRotationFromQuaternion(this.rotation));
        }
        this.root.setPosition(x, y - (fall?.sink ?? 0), z);
        this.tint.set(color).multiplyScalar(fall?.shade ?? 1);
        for (let i = 0; i < this.rig.parts.length; i++) {
            const part = this.rig.parts[i]; this.local.copy(part.rest); this.motion.identity();
            if (part.kind === 'aim') this.motion.makeRotationY(-(aims[part.mount] - facing));
            if (part.kind === 'recoil') this.motion.makeTranslation(-kicks[part.mount] * part.travel, 0, 0);
            if (part.kind === 'spin') {
                const spinning = part.name !== 'spin_x_gatling' || attacking;
                this.rotation.setFromAxisAngle(part.axis, (spinning ? time * part.rate : 0) + id * 0.73);
                this.motion.makeRotationFromQuaternion(this.rotation);
            }
            if (part.kind === 'roll') this.motion.makeRotationZ(odometer / 0.4);
            if (part.kind === 'walk') this.motion.makeRotationZ(Math.sin(odometer * 2.2) * 0.6 * part.sign);
            this.local.multiply(this.motion);
            this.worlds[i].multiplyMatrices(part.parent < 0 ? this.root : this.worlds[part.parent], this.local);
            this.meshes[i].setMatrixAt(this.count, this.worlds[i]);
            this.meshes[i].setColorAt(this.count, this.tint);
            this.meshes[i].geometry.getAttribute('constructionAlpha').setX(this.count, opacity);
        }
        if (muzzles) for (const muzzle of this.rig.muzzles) {
            this.point.copy(muzzle.position).applyMatrix4(this.worlds[muzzle.part]);
            const at = (id * 4 + muzzle.mount) * 3;
            muzzles[at] = this.point.x; muzzles[at + 1] = this.point.y; muzzles[at + 2] = this.point.z;
        }
        this.count++;
    }
    end() {
        for (const mesh of this.meshes) {
            mesh.count = this.count; mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.geometry.getAttribute('constructionAlpha').needsUpdate = true;
        }
    }
    destroy() {
        for (const mesh of this.meshes) {
            this.group.remove(mesh); mesh.dispose(); mesh.geometry.dispose();
        }
        this.meshes.length = 0; this.rig.dispose();
    }
}
