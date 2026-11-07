import type * as T from 'three';
import { lobbyMaximumPlayerCount, weaponMaximumSpawnsPerFire } from '../config.js';
import { Deployable } from '../sim/deployable.js';
import { Vector3 } from '../sim/math/vector3.js';
import { Projectile } from '../sim/projectile.js';
import { VoxelMaterials } from './voxel-material.js';
import { VoxelModelBuilder } from './voxel-model-builder.js';

interface ModelBatch {
    mesh: T.InstancedMesh;
    colours: T.InstancedBufferAttribute;
    geometry: T.BufferGeometry;
    material: T.MeshLambertMaterial;
}

export class ProjectileRenderer {
    readonly group = new THREE.Group();
    private readonly batches = new Map<string, ModelBatch>();
    private readonly previous = new Map<number, { position: T.Vector3; capture: number }>();
    private captureIndex = 0;
    private readonly transform = new THREE.Object3D();
    private readonly pivot = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private disposed = false;

    constructor(private readonly models: VoxelModelBuilder, private readonly materials: VoxelMaterials,
        private readonly seatColours: ReadonlyMap<number, readonly [number, number]>) {}

    capture(projectiles: ReadonlyArray<Projectile>): void {
        if (this.disposed) return;
        this.captureIndex++;
        for (const projectile of projectiles) {
            if (!projectile.isAlive) continue;
            let previous = this.previous.get(projectile.serial);
            if (!previous) {
                previous = { position: new THREE.Vector3(), capture: this.captureIndex };
                this.previous.set(projectile.serial, previous);
            }
            previous.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
            previous.capture = this.captureIndex;
        }
        for (const [serial, previous] of this.previous)
            if (previous.capture !== this.captureIndex) this.previous.delete(serial);
    }

    /** Where a projectile was at the start of the latest tick. */
    previousPosition(serial: number): T.Vector3 | undefined {
        return this.previous.get(serial)?.position;
    }

    update(projectiles: ReadonlyArray<Projectile>, deployables: ReadonlyArray<Deployable>,
        interpolation: number): void {
        if (this.disposed) return;
        if (!Number.isFinite(interpolation) || interpolation < 0 || interpolation > 1)
            throw new Error('Invalid projectile interpolation');
        for (const batch of this.batches.values()) batch.mesh.count = 0;
        for (const projectile of projectiles) {
            if (!projectile.isAlive) continue;
            const previous = this.previous.get(projectile.serial)?.position;
            this.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
            if (previous) this.position.lerpVectors(previous, this.position, interpolation);
            const yaw = Math.atan2(projectile.velocity.x, projectile.velocity.z);
            const pitch = Math.atan2(projectile.velocity.y, Math.hypot(projectile.velocity.x, projectile.velocity.z));
            this.place(projectile.definition.modelIdentifier, this.position, yaw, pitch, projectile.ownerSeatIndex);
        }
        for (const deployable of deployables)
            if (deployable.isAlive && deployable.definition.modelIdentifier)
                this.place(deployable.definition.modelIdentifier, deployable.visualPosition(interpolation),
                    deployable.context.yawInRadians, 0, deployable.context.ownerSeatIndex);
        for (const batch of this.batches.values()) {
            batch.mesh.visible = batch.mesh.count > 0;
            if (!batch.mesh.visible) continue;
            batch.mesh.instanceMatrix.updateRange.count = batch.mesh.count * 16;
            batch.mesh.instanceMatrix.needsUpdate = true;
            batch.colours.updateRange.count = batch.mesh.count * 2;
            batch.colours.needsUpdate = true;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.group.parent?.remove(this.group);
        for (const batch of this.batches.values()) {
            batch.mesh.dispose();
            batch.geometry.dispose();
            batch.material.dispose();
        }
        this.batches.clear();
        this.previous.clear();
    }

    private place(identifier: string, position: Vector3, yaw: number, pitch: number, seatIndex: number): void {
        let batch = this.batches.get(identifier);
        if (!batch) {
            const capacity = lobbyMaximumPlayerCount * weaponMaximumSpawnsPerFire;
            const geometry = this.models.geometry(identifier).clone();
            const colours = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
            colours.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('voxelInstanceColours', colours);
            const material = this.materials.create(false);
            material.defines = { ...material.defines, VOXEL_INSTANCE_COLOURS: 1 };
            const mesh = new THREE.InstancedMesh(geometry, material, capacity);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.castShadow = mesh.receiveShadow = true;
            mesh.count = 0;
            batch = { mesh, colours, geometry, material };
            this.batches.set(identifier, batch);
            this.group.add(mesh);
        }
        const index = batch.mesh.count;
        if (index >= batch.mesh.instanceMatrix.count) throw new Error('Projectile render capacity exceeded');
        const pivot = this.models.specification(identifier).pivot;
        this.transform.position.set(position.x, position.y, position.z);
        this.transform.rotation.set(-pitch, yaw, 0, 'YXZ');
        this.transform.updateMatrix();
        this.pivot.makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
        this.transform.matrix.multiply(this.pivot);
        batch.mesh.setMatrixAt(index, this.transform.matrix);
        const colours = this.seatColours.get(seatIndex);
        batch.colours.setXY(index, colours?.[0] ?? 0xffffff, colours?.[1] ?? 0x888888);
        batch.mesh.count++;
    }
}
