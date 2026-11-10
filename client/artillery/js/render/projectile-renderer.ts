import type * as T from 'three';
import { accretionDiskGlowIntensity, accretionDiskParticleSizeInVoxels, accretionDiskRingParticleCounts,
    accretionDiskRingRadiiInVoxels, accretionDiskSpinRadiansPerSecond, accretionDiskTiltInRadians,
    lobbyMaximumPlayerCount, tornadoAscentInVoxels, tornadoOpacity, tornadoSpinInRadiansPerSecond,
    weaponMaximumSpawnsPerFire } from '../config.js';
import { Deployable } from '../sim/deployable.js';
import { Vector3 } from '../sim/math/vector3.js';
import { Projectile } from '../sim/projectile.js';
import { additiveEffectBlending, transparentEffectsLayer } from './effects-layer.js';
import { VoxelMaterials } from './voxel-material.js';
import { VoxelModelBuilder } from './voxel-model-builder.js';

interface ModelBatch {
    mesh: T.InstancedMesh;
    colours: T.InstancedBufferAttribute;
    geometry: T.BufferGeometry;
    material: T.MeshLambertMaterial;
}

const diskParticlesPerWell = accretionDiskRingParticleCounts.reduce((total, count) => total + count, 0);

export class ProjectileRenderer {
    readonly group = new THREE.Group();
    private readonly batches = new Map<string, ModelBatch>();
    private readonly previous = new Map<number, { position: T.Vector3; capture: number }>();
    private captureIndex = 0;
    private readonly transform = new THREE.Object3D();
    private readonly pivot = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly disk: T.InstancedMesh;
    private readonly diskColour = new THREE.Color();
    private diskCount = 0;
    private disposed = false;

    constructor(private readonly models: VoxelModelBuilder, private readonly materials: VoxelMaterials,
        private readonly seatColours: ReadonlyMap<number, readonly [number, number]>) {
        const capacity = lobbyMaximumPlayerCount * diskParticlesPerWell;
        const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false,
            ...additiveEffectBlending() });
        this.disk = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, capacity);
        this.disk.layers.set(transparentEffectsLayer);
        this.disk.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.disk.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this.disk.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.disk.frustumCulled = false;
        this.disk.count = 0;
        this.group.add(this.disk);
    }

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
        interpolation: number, elapsedSeconds = 0): void {
        if (this.disposed) return;
        if (!Number.isFinite(interpolation) || interpolation < 0 || interpolation > 1)
            throw new Error('Invalid projectile interpolation');
        for (const batch of this.batches.values()) batch.mesh.count = 0;
        this.diskCount = 0;
        for (const projectile of projectiles) {
            if (!projectile.isAlive) continue;
            const previous = this.previous.get(projectile.serial)?.position;
            this.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
            if (previous) this.position.lerpVectors(previous, this.position, interpolation);
            const yaw = Math.atan2(projectile.velocity.x, projectile.velocity.z);
            const pitch = Math.atan2(projectile.velocity.y, Math.hypot(projectile.velocity.x, projectile.velocity.z));
            this.place(projectile.definition.modelIdentifier, this.position, yaw, pitch, projectile.ownerSeatIndex);
            if (projectile.definition.gravityWell) this.placeDisk(this.position, elapsedSeconds);
        }
        let tornadoSlot = 0;
        for (const deployable of deployables) {
            if (!deployable.isAlive || !deployable.definition.modelIdentifier) continue;
            const position = deployable.visualPosition(interpolation);
            if (deployable.definition.kind !== 'tornado') {
                this.place(deployable.definition.modelIdentifier, position, deployable.context.yawInRadians, 0,
                    deployable.context.ownerSeatIndex);
                continue;
            }
            const fade = deployable.fadeProgress(interpolation);
            this.position.set(position.x, position.y + fade * tornadoAscentInVoxels, position.z);
            this.place(deployable.definition.modelIdentifier, this.position,
                elapsedSeconds * tornadoSpinInRadiansPerSecond, 0, deployable.context.ownerSeatIndex,
                { slot: tornadoSlot++, opacity: tornadoOpacity * (1 - fade) });
        }
        this.disk.count = this.diskCount; this.disk.visible = this.diskCount > 0;
        if (this.diskCount > 0) {
            this.disk.instanceMatrix.updateRange.count = this.diskCount * 16;
            this.disk.instanceMatrix.needsUpdate = true;
            this.disk.instanceColor!.updateRange.count = this.diskCount * 3;
            this.disk.instanceColor!.needsUpdate = true;
        }
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
        this.disk.dispose();
        this.disk.geometry.dispose();
        (this.disk.material as T.MeshBasicMaterial).dispose();
    }

    /** Places the spinning, tilted accretion disk of a black hole, inner rings turning fastest. */
    private placeDisk(center: T.Vector3, elapsedSeconds: number): void {
        const tilt = Math.cos(accretionDiskTiltInRadians), lift = Math.sin(accretionDiskTiltInRadians);
        accretionDiskRingRadiiInVoxels.forEach((radius, ring) => {
            const spin = accretionDiskSpinRadiansPerSecond / Math.pow(radius, 1.5);
            const heat = 1 - ring / accretionDiskRingRadiiInVoxels.length;
            for (let index = 0; index < accretionDiskRingParticleCounts[ring]; index++) {
                if (this.diskCount >= this.disk.instanceMatrix.count) return;
                const angle = index / accretionDiskRingParticleCounts[ring] * Math.PI * 2 + elapsedSeconds * spin;
                const across = Math.cos(angle) * radius, along = Math.sin(angle) * radius;
                this.transform.position.set(center.x + across, center.y + along * lift, center.z + along * tilt);
                this.transform.rotation.set(0, 0, 0);
                this.transform.scale.setScalar(accretionDiskParticleSizeInVoxels);
                this.transform.updateMatrix();
                this.disk.setMatrixAt(this.diskCount, this.transform.matrix);
                // The side turning toward the viewer is brighter and hotter than the receding side.
                const brightness = .65 + .35 * Math.sin(angle);
                this.diskColour.setRGB(1, .35 + .6 * heat, .08 + .75 * heat * heat).convertSRGBToLinear()
                    .multiplyScalar(accretionDiskGlowIntensity * brightness);
                this.disk.setColorAt(this.diskCount, this.diskColour);
                this.diskCount++;
            }
        });
        this.transform.scale.setScalar(1);
    }

    /** A translucent model gets a batch of its own, so that each one can fade independently. */
    private place(identifier: string, position: Vector3, yaw: number, pitch: number, seatIndex: number,
        translucent?: { slot: number; opacity: number }): void {
        const key = translucent ? `${identifier}:${translucent.slot}` : identifier;
        let batch = this.batches.get(key);
        if (!batch) {
            const capacity = translucent ? 1 : lobbyMaximumPlayerCount * weaponMaximumSpawnsPerFire;
            const geometry = this.models.geometry(identifier).clone();
            const colours = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
            colours.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('voxelInstanceColours', colours);
            const material = this.materials.create(false);
            material.defines = { ...material.defines, VOXEL_INSTANCE_COLOURS: 1 };
            if (translucent) {
                material.transparent = true;
                material.depthWrite = false;
            }
            const mesh = new THREE.InstancedMesh(geometry, material, capacity);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;
            mesh.castShadow = mesh.receiveShadow = !translucent;
            mesh.count = 0;
            batch = { mesh, colours, geometry, material };
            this.batches.set(key, batch);
            this.group.add(mesh);
        }
        if (translucent) batch.material.opacity = translucent.opacity;
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
