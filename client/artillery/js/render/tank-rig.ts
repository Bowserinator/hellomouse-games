import type * as T from 'three';
import { tankRecoilDecayPerSecond, tankTrackOffsetInVoxels, tankTreadFrameTravelInVoxels,
    tankWreckSmokeIntervalInSeconds, tankWreckTint, turretSwapDurationInSeconds, turretSwapOvershoot } from '../config.js';
import { decodePitch, decodeYaw } from '../sim/math/fixed-quantize.js';
import { Vector3 } from '../sim/math/vector3.js';
import { Tank } from '../sim/tank.js';
import { TurretDefinition } from '../sim/weapon-types.js';
import { VoxelMaterials } from './voxel-material.js';
import { VoxelModelBuilder } from './voxel-model-builder.js';

export class TankRig {
    readonly group = new THREE.Group();
    readonly hull = new THREE.Group();
    readonly turret = new THREE.Group();
    readonly material: T.MeshLambertMaterial;
    private readonly treads: Array<readonly [T.Group, T.Group]> = [];
    private readonly previousPosition = new THREE.Vector3();
    private readonly smokePosition = { x: 0, y: 0, z: 0 };
    private previousYaw = 0;
    private initialized = false;
    private readonly treadTravel = [0, 0];
    private turretMount = new THREE.Group();
    private barrel = new THREE.Group();
    private barrelVisual = new THREE.Group();
    private definition: TurretDefinition | null = null;
    private identifier: string | null = null;
    private pending: { identifier: string; definition: TurretDefinition } | null = null;
    private swapAge = turretSwapDurationInSeconds;
    private swapStartScale = 1;
    private recoil = 0;
    private smokeAge = 0;
    private disposed = false;

    constructor(private readonly models: VoxelModelBuilder, materials: VoxelMaterials,
        primaryColour: number, secondaryColour: number, private readonly onTurretClick: () => void,
        private readonly onWreckSmoke: (position: Vector3) => void) {
        this.material = materials.create(false, primaryColour, secondaryColour);
        this.hull.add(models.create('tank_body', this.material));
        for (let side = 0; side < 2; side++) {
            const first = models.create('tank_tread_0', this.material);
            const second = models.create('tank_tread_1', this.material);
            first.position.x = second.position.x = side === 0 ? -tankTrackOffsetInVoxels : tankTrackOffsetInVoxels;
            second.visible = false;
            this.hull.add(first, second);
            this.treads.push([first, second]);
        }
        this.group.add(this.hull, this.turret);
    }

    setTurret(identifier: string, definition: TurretDefinition): void {
        if (this.disposed || this.pending?.identifier === identifier ||
            this.pending === null && this.identifier === identifier) return;
        if (this.identifier === null) {
            this.installTurret(identifier, definition);
            return;
        }
        this.pending = { identifier, definition };
        this.swapAge = 0;
        this.swapStartScale = this.turretMount.scale.x;
    }

    fire(): void {
        this.recoil = 1;
    }

    update(tank: Tank, position: Vector3, deltaSeconds: number): void {
        if (this.disposed) return;
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Invalid tank animation interval');
        this.group.position.set(position.x, position.y, position.z);
        this.hull.rotation.y = tank.hullYawInRadians;
        this.turret.rotation.y = decodeYaw(tank.turretYawQuantized);
        if (this.initialized) {
            const forward = (position.x - this.previousPosition.x) * Math.sin(tank.hullYawInRadians) +
                (position.z - this.previousPosition.z) * Math.cos(tank.hullYawInRadians);
            const yawChange = Math.atan2(Math.sin(tank.hullYawInRadians - this.previousYaw),
                Math.cos(tank.hullYawInRadians - this.previousYaw));
            this.treadTravel[0] += forward + yawChange * tankTrackOffsetInVoxels;
            this.treadTravel[1] += forward - yawChange * tankTrackOffsetInVoxels;
        }
        this.previousPosition.set(position.x, position.y, position.z);
        this.previousYaw = tank.hullYawInRadians;
        this.initialized = true;
        for (let side = 0; side < 2; side++) {
            const frame = Math.floor(Math.abs(this.treadTravel[side]) / tankTreadFrameTravelInVoxels) % 2;
            this.treads[side][0].visible = frame === 0;
            this.treads[side][1].visible = frame === 1;
        }
        const previousSwapAge = this.swapAge;
        this.swapAge = Math.min(turretSwapDurationInSeconds, this.swapAge + deltaSeconds);
        if (this.pending && this.swapAge >= turretSwapDurationInSeconds / 2) {
            this.installTurret(this.pending.identifier, this.pending.definition);
            this.pending = null;
        }
        if (this.swapAge < turretSwapDurationInSeconds / 2)
            this.turretMount.scale.setScalar(this.swapStartScale *
                (1 - this.swapAge * 2 / turretSwapDurationInSeconds));
        else {
            const progress = this.swapAge * 2 / turretSwapDurationInSeconds - 2;
            const scale = 1 + (turretSwapOvershoot + 1) * progress ** 3 + turretSwapOvershoot * progress ** 2;
            this.turretMount.scale.setScalar(scale);
        }
        if (previousSwapAge < turretSwapDurationInSeconds && this.swapAge === turretSwapDurationInSeconds &&
            !tank.isWreck)
            this.onTurretClick();
        this.barrel.rotation.x = -decodePitch(tank.turretPitchQuantized);
        this.recoil *= Math.exp(-tankRecoilDecayPerSecond * deltaSeconds);
        this.barrelVisual.position.z = -this.recoil * (this.definition?.recoilDistanceInVoxels ?? 0);
        this.material.color.setHex(tank.isWreck ? tankWreckTint : 0xffffff);
        if (tank.isWreck) {
            this.smokeAge += deltaSeconds;
            if (this.smokeAge >= tankWreckSmokeIntervalInSeconds) {
                this.smokeAge %= tankWreckSmokeIntervalInSeconds;
                this.smokePosition.x = position.x;
                this.smokePosition.y = position.y + (this.definition?.turretPivot[1] ?? 0);
                this.smokePosition.z = position.z;
                this.onWreckSmoke(this.smokePosition);
            }
        } else this.smokeAge = 0;
    }

    muzzlePosition(target: T.Vector3): T.Vector3 {
        if (!this.definition) throw new Error('Tank turret is not selected');
        this.group.updateMatrixWorld(true);
        target.set(...this.definition.muzzleOffset);
        return this.barrel.localToWorld(target);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.group.parent?.remove(this.group);
        this.material.dispose();
    }

    private installTurret(identifier: string, definition: TurretDefinition): void {
        this.turret.remove(this.turretMount);
        this.turretMount = new THREE.Group();
        this.turret.position.set(...definition.turretPivot);
        this.turretMount.add(this.models.create(definition.turretModelIdentifier, this.material));
        this.barrel = new THREE.Group();
        this.barrel.position.set(...definition.barrelPivot);
        this.barrelVisual = this.models.create(definition.barrelModelIdentifier, this.material);
        this.barrel.add(this.barrelVisual);
        this.turretMount.add(this.barrel);
        this.turret.add(this.turretMount);
        this.identifier = identifier;
        this.definition = definition;
    }
}
